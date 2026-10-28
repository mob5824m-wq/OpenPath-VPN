// Native full-tunnel WireGuard integration for the desktop shell.
// The imported configuration is validated and rewritten before any elevated
// command is run: wg-quick hooks and custom routing directives are forbidden.
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);

const NAME = 'opvpn0'; // wg-quick interface/tunnel name, at most 15 characters
const DNS = {
  unfiltered: ['1.1.1.1', '1.0.0.1'],
  malware: ['9.9.9.9', '149.112.112.112'], // Quad9
  ads: ['94.140.14.14', '94.140.15.15'], // AdGuard DNS default
};

function parseKey(value, name) {
  const bytes = Buffer.from(value, 'base64');
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value) || bytes.length !== 32 || bytes.toString('base64') !== value) {
    throw new Error(`${name} must be a valid 32-byte WireGuard key`);
  }
  return value;
}
function ipList(value, label) {
  const entries = value.split(',').map(s => s.trim()).filter(Boolean);
  if (!entries.length || entries.some(entry => !net.isIP(entry))) throw new Error(`${label} must contain IP addresses separated by commas`);
  return entries;
}
function addressList(value) {
  const entries = value.split(',').map(s => s.trim()).filter(Boolean);
  if (!entries.length || entries.some(entry => {
    const [address, prefix, ...rest] = entry.split('/');
    const family = net.isIP(address);
    return rest.length || !family || !/^\d{1,3}$/.test(prefix || '') || +prefix > (family === 4 ? 32 : 128);
  })) throw new Error('Address must contain valid IP addresses with CIDR prefixes');
  if (!entries.some(entry => net.isIP(entry.split('/')[0]) === 4)) throw new Error('The profile needs an IPv4 interface address');
  return entries;
}
function endpoint(value) {
  const match = /^(?:\[([0-9a-fA-F:]+)\]|([A-Za-z0-9.-]+)):(\d{1,5})$/.exec(value);
  if (!match || +match[3] < 1 || +match[3] > 65535) throw new Error('Endpoint must be a host or [IPv6 address] followed by a UDP port');
  if (match[1] && net.isIP(match[1]) !== 6) throw new Error('Endpoint IPv6 address is invalid');
  if (match[2] && !net.isIP(match[2]) && (match[2].length > 253 || match[2].split('.').some(part => !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(part)))) {
    throw new Error('Endpoint hostname is invalid');
  }
  return value;
}

function parseConfig(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 65536) throw new Error('WireGuard configuration is missing or too large');
  const sections = { interface: {}, peer: {} };
  const allowed = {
    interface: new Set(['privatekey', 'address', 'dns', 'mtu', 'listenport']),
    peer: new Set(['publickey', 'presharedkey', 'endpoint', 'allowedips', 'persistentkeepalive']),
  };
  let section = '', seenInterface = false, seenPeer = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split('#', 1)[0].trim();
    if (!line) continue;
    const header = /^\[(interface|peer)\]$/i.exec(line);
    if (header) {
      section = header[1].toLowerCase();
      if (section === 'interface') {
        if (seenInterface || seenPeer) throw new Error('A profile must have one Interface followed by one Peer');
        seenInterface = true;
      } else {
        if (!seenInterface || seenPeer) throw new Error('A profile must have one Interface followed by one Peer');
        seenPeer = true;
      }
      continue;
    }
    const pair = /^([A-Za-z]+)\s*=\s*(.+)$/.exec(line);
    if (!section || !pair) throw new Error('Invalid WireGuard configuration line');
    const key = pair[1].toLowerCase();
    if (!allowed[section].has(key)) throw new Error(`Unsupported or unsafe WireGuard directive: ${pair[1]}`);
    if (Object.hasOwn(sections[section], key)) throw new Error(`Duplicate WireGuard directive: ${pair[1]}`);
    sections[section][key] = pair[2].trim();
  }
  if (!seenInterface || !seenPeer) throw new Error('A WireGuard profile needs one Interface and one Peer');
  const i = sections.interface, p = sections.peer;
  if (!i.privatekey || !i.address || !p.publickey || !p.endpoint || !p.allowedips) throw new Error('Profile needs PrivateKey, Address, PublicKey, Endpoint and AllowedIPs');
  const routes = p.allowedips.split(',').map(s => s.trim());
  if (routes.length !== 2 || !routes.includes('0.0.0.0/0') || !routes.includes('::/0')) {
    throw new Error('A device-wide profile must route both 0.0.0.0/0 and ::/0 through the peer');
  }
  const intRange = (value, name, min, max) => {
    if (value !== undefined && (!/^\d+$/.test(value) || +value < min || +value > max)) throw new Error(`${name} is out of range`);
    return value;
  };
  return {
    privateKey: parseKey(i.privatekey, 'PrivateKey'),
    addresses: addressList(i.address),
    dns: i.dns ? ipList(i.dns, 'DNS') : [],
    mtu: intRange(i.mtu, 'MTU', 576, 9000),
    listenPort: intRange(i.listenport, 'ListenPort', 1, 65535),
    publicKey: parseKey(p.publickey, 'PublicKey'),
    presharedKey: p.presharedkey ? parseKey(p.presharedkey, 'PresharedKey') : undefined,
    endpoint: endpoint(p.endpoint),
    keepalive: intRange(p.persistentkeepalive, 'PersistentKeepalive', 0, 65535) ?? '25',
  };
}

function renderConfig(profile, options = {}) {
  const mode = options.dnsMode || 'unfiltered';
  if (!['unfiltered', 'malware', 'ads', 'custom'].includes(mode)) throw new Error('Select a valid DNS filter mode');
  const dns = mode === 'custom' ? ipList(String(options.customDns || ''), 'Custom DNS') :
    mode === 'unfiltered' && profile.dns.length ? profile.dns : DNS[mode];
  const lines = ['[Interface]', `PrivateKey = ${profile.privateKey}`, `Address = ${profile.addresses.join(', ')}`, `DNS = ${dns.join(', ')}`];
  if (profile.mtu) lines.push(`MTU = ${profile.mtu}`);
  if (profile.listenPort) lines.push(`ListenPort = ${profile.listenPort}`);
  lines.push('', '[Peer]', `PublicKey = ${profile.publicKey}`);
  if (profile.presharedKey) lines.push(`PresharedKey = ${profile.presharedKey}`);
  lines.push(`Endpoint = ${profile.endpoint}`, 'AllowedIPs = 0.0.0.0/0, ::/0', `PersistentKeepalive = ${profile.keepalive}`, '');
  return lines.join('\n');
}

function appleScriptCommand(tool, action, configPath) {
  const quote = value => `'${String(value).replace(/'/g, "'\\''")}'`;
  const searchPath = [path.dirname(tool), '/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':');
  const command = `/usr/bin/env ${quote(`PATH=${searchPath}`)} ${quote(tool)} ${quote(action)} ${quote(configPath)}`;
  // JSON's double-quoted string escaping is compatible with AppleScript here.
  return `do shell script ${JSON.stringify(command)} with administrator privileges`;
}

async function defaultRun(file, args, options = {}) {
  const result = await execFileAsync(file, args, {
    timeout: 120_000, maxBuffer: 256 * 1024, windowsHide: true,
    ...options, env: { ...process.env, LC_ALL:'C', ...(options.env || {}) },
  });
  return result.stdout.trim();
}
async function defaultFindTool(candidates) {
  for (const candidate of candidates) {
    try { await fs.access(candidate); return candidate; } catch {}
  }
  return null;
}
function cleanError(error) {
  const message = String(error?.stderr || error?.message || error || 'Unknown error')
    .replace(/[A-Za-z0-9+/]{43}=/g, '[key hidden]').trim();
  return message.slice(-500);
}

class DeviceVpn {
  constructor({storagePath, safeStorage, platform=process.platform, run=defaultRun, findTool=defaultFindTool, wireguardDir='/var/run/wireguard'}) {
    this.storagePath = storagePath;
    this.safeStorage = safeStorage;
    this.platform = platform;
    this.run = run;
    this.findTool = findTool;
    this.wireguardDir = wireguardDir;
    this.dir = path.join(storagePath, 'device-vpn');
    this.vault = path.join(this.dir, 'profile.enc');
    this.marker = path.join(this.dir, 'active.json');
    this.windowsConfig = path.join(this.dir, `${NAME}.conf`);
    this.busy = false;
  }
  async locked(action) {
    if (this.busy) throw new Error('Another device VPN operation is already in progress');
    this.busy = true;
    try { return await action(); } finally { this.busy = false; }
  }
  async initDir() {
    await fs.mkdir(this.dir, {recursive:true, mode:0o700});
    if (this.platform !== 'win32') { await fs.chmod(this.dir, 0o700); return; }
    // Replace the entire DACL, including any pre-existing explicit grants.
    // The service runs as SYSTEM; the current user needs to manage its files.
    const powershell = await this.windowsTool('powershell');
    const script = [
      "$ErrorActionPreference='Stop'",
      '$acl=New-Object System.Security.AccessControl.DirectorySecurity',
      '$acl.SetAccessRuleProtection($true,$false)',
      '$user=[System.Security.Principal.WindowsIdentity]::GetCurrent().User',
      "$system=New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')",
      "$inherit=[System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'",
      "$propagation=[System.Security.AccessControl.PropagationFlags]::None",
      "$type=[System.Security.AccessControl.AccessControlType]::Allow",
      "foreach($sid in @($user,$system)){ $rule=New-Object System.Security.AccessControl.FileSystemAccessRule($sid,'FullControl',$inherit,$propagation,$type); $acl.AddAccessRule($rule) }",
      '[System.IO.Directory]::SetAccessControl($env:OPVPN_DIRECTORY,$acl)',
    ].join('; ');
    await this.run(powershell, ['-NoProfile','-NonInteractive','-Command',script], {env:{OPVPN_DIRECTORY:this.dir}});
  }
  assertEncryption() {
    if (!this.safeStorage?.isEncryptionAvailable() ||
        (this.platform === 'linux' && this.safeStorage.getSelectedStorageBackend?.() === 'basic_text')) {
      throw new Error('A system keychain is required to save the WireGuard profile securely');
    }
  }
  async saveVault(data) {
    this.assertEncryption();
    await this.initDir();
    const encrypted = this.safeStorage.encryptString(JSON.stringify(data));
    const tmp = path.join(this.dir, `profile-${process.pid}-${Date.now()}.tmp`);
    try { await fs.writeFile(tmp, encrypted, {mode:0o600, flag:'wx'}); await fs.rename(tmp, this.vault); }
    finally { await fs.rm(tmp, {force:true}).catch(()=>{}); }
  }
  async readVault() {
    this.assertEncryption();
    let encrypted;
    try { encrypted = await fs.readFile(this.vault); }
    catch (error) { if (error.code === 'ENOENT') throw new Error('Import a WireGuard profile first'); throw error; }
    try {
      const data = JSON.parse(this.safeStorage.decryptString(encrypted));
      return {profile:parseConfig(data.config), options:data.options || {dnsMode:'unfiltered'}};
    } catch (error) { throw new Error(`Could not unlock the saved profile: ${cleanError(error)}`); }
  }
  async imported() { try { await fs.access(this.vault); return true; } catch { return false; } }
  async markerExists() { try { await fs.access(this.marker); return true; } catch { return false; } }
  async importFile(filename) {
    return this.locked(async()=>{
      const runtime = await this.runtimeStatus();
      if (runtime.state !== 'inactive') throw new Error('Disconnect the device VPN before replacing its profile');
      const stat = await fs.stat(filename);
      if (!stat.isFile() || stat.size > 65536) throw new Error('Select a WireGuard .conf file smaller than 64 KB');
      const profile = parseConfig(await fs.readFile(filename, 'utf8'));
      // Re-render before storing, so comments and unsafe fields never reach wg-quick.
      const config = renderConfig(profile, {dnsMode:'unfiltered'});
      await this.saveVault({config, options:{dnsMode:'unfiltered'}});
      return { configured:true, endpoint:profile.endpoint, hasIPv6Address:profile.addresses.some(a=>net.isIP(a.split('/')[0]) === 6) };
    });
  }
  async removeProfile() {
    return this.locked(async()=>{
      const runtime = await this.runtimeStatus();
      if (runtime.state !== 'inactive') throw new Error('Disconnect the device VPN before removing its profile');
      await Promise.all([fs.rm(this.vault, {force:true}), fs.rm(this.marker, {force:true}), fs.rm(this.windowsConfig, {force:true})]);
      return {ok:true};
    });
  }
  async windowsTool(name) {
    const root = process.env.SystemRoot || 'C:\\Windows';
    const candidates = name === 'wireguard' ? [path.win32.join(process.env.ProgramFiles || 'C:\\Program Files','WireGuard','wireguard.exe')] :
      name === 'powershell' ? [path.win32.join(root,'System32','WindowsPowerShell','v1.0','powershell.exe')] :
      [path.win32.join(root,'System32','icacls.exe')];
    const tool = await this.findTool(candidates);
    if (!tool) throw new Error(name === 'wireguard' ? 'Install the official WireGuard for Windows app first' : `${name} is not available on this Windows system`);
    return tool;
  }
  async wgQuick() {
    const candidates = this.platform === 'darwin' ? ['/opt/homebrew/bin/wg-quick','/usr/local/bin/wg-quick','/opt/local/bin/wg-quick'] : ['/usr/bin/wg-quick','/usr/local/bin/wg-quick','/bin/wg-quick'];
    const tool = await this.findTool(candidates);
    if (!tool) throw new Error('Install WireGuard tools (wg and wg-quick) before connecting');
    return tool;
  }
  async runtimeStatus() {
    try {
      if (this.platform === 'linux') {
        const ip = await this.findTool(['/usr/sbin/ip','/usr/bin/ip','/sbin/ip','/bin/ip']);
        if (!ip) return {state:'unknown', message:'iproute2 is required to inspect the VPN interface'};
        try { await this.run(ip, ['link','show','dev',NAME]); return {state:'active'}; }
        catch (error) {
          if (/does not exist|cannot find device|not found/i.test(cleanError(error))) return {state:'inactive'};
          return {state:'unknown', message:'Could not inspect the VPN interface'};
        }
      }
      if (this.platform === 'darwin') {
        let iface;
        try { iface = (await fs.readFile(path.join(this.wireguardDir, `${NAME}.name`), 'utf8')).trim(); }
        catch (error) { return error.code === 'ENOENT' ? {state:'inactive'} : {state:'unknown', message:'Could not inspect the VPN interface'}; }
        if (!/^utun\d+$/.test(iface)) return {state:'unknown', message:'Invalid WireGuard interface name'};
        try { await this.run('/sbin/ifconfig', [iface]); return {state:'active'}; }
        catch { return {state:'inactive'}; }
      }
      if (this.platform === 'win32') {
        const powershell = await this.windowsTool('powershell');
        const script = "$ErrorActionPreference='Stop'; try { (Get-Service -Name 'WireGuardTunnel$opvpn0' -ErrorAction Stop).Status.ToString() } catch { if ($_.FullyQualifiedErrorId -like 'NoServiceFoundForGivenName*') {'absent'} else {throw} }";
        const state = (await this.run(powershell, ['-NoProfile','-NonInteractive','-Command',script])).trim().toLowerCase();
        if (state === 'running') return {state:'active'};
        if (state === 'absent') return {state:'inactive'};
        if (state === 'stopped') return {state:'stopped', message:'WireGuard service stopped; disconnect to remove it.'};
        return {state:'unknown', message:`WireGuard service is ${state || 'not responding'}`};
      }
      return {state:'unsupported', message:'Device VPN is supported on Linux, macOS and Windows'};
    } catch (error) { return {state:'unknown', message:cleanError(error)}; }
  }
  async status() {
    const runtime = await this.runtimeStatus();
    const configured = await this.imported();
    const owned = await this.markerExists();
    let installed = false;
    try { if (this.platform === 'win32') await this.windowsTool('wireguard'); else if (['linux','darwin'].includes(this.platform)) await this.wgQuick(); installed = ['linux','darwin','win32'].includes(this.platform); } catch {}
    const message = !owned && (runtime.state === 'active' || runtime.state === 'stopped')
      ? 'This interface is not confirmed as OpenPath-owned. Inspect or stop it with its original WireGuard client.'
      : runtime.message || (runtime.state === 'active' ? 'Interface active; peer connectivity is not yet verified.' : undefined);
    return { ...runtime, configured, owned, installed, interface:NAME, message };
  }
  async withTempConfig(config, action) {
    await this.initDir();
    const temp = await fs.mkdtemp(path.join(this.dir, 'wg-'));
    await fs.chmod(temp, 0o700);
    const filename = path.join(temp, `${NAME}.conf`);
    try { await fs.writeFile(filename, config, {mode:0o600, flag:'wx'}); return await action(filename); }
    finally { await fs.rm(temp, {recursive:true, force:true}); }
  }
  async elevated(action, configPath) {
    if (this.platform === 'linux') {
      const wg = await this.wgQuick();
      if (process.getuid?.() === 0) return this.run(wg, [action, configPath]);
      const pkexec = await this.findTool(['/usr/bin/pkexec','/bin/pkexec']);
      if (!pkexec) throw new Error('Install polkit/pkexec to authorize WireGuard changes');
      return this.run(pkexec, [wg, action, configPath]);
    }
    if (this.platform === 'darwin') {
      const wg = await this.wgQuick();
      return this.run('/usr/bin/osascript', ['-e', appleScriptCommand(wg, action, configPath)]);
    }
    if (this.platform === 'win32') {
      const wireguard = await this.windowsTool('wireguard');
      const powershell = await this.windowsTool('powershell');
      const operation = action === 'up' ? '/installtunnelservice' : '/uninstalltunnelservice';
      const arg = action === 'up' ? configPath : NAME;
      const script = "$ErrorActionPreference='Stop'; $a=@($env:OPVPN_ACTION, ('\"'+$env:OPVPN_ARGUMENT+'\"')); $p=Start-Process -FilePath $env:OPVPN_PROGRAM -ArgumentList $a -Verb RunAs -Wait -PassThru; if($null -eq $p){throw 'No elevated process started'}; exit [int]$p.ExitCode";
      return this.run(powershell, ['-NoProfile','-NonInteractive','-Command',script], {env:{OPVPN_ACTION:operation, OPVPN_ARGUMENT:arg, OPVPN_PROGRAM:wireguard}});
    }
    throw new Error('This operating system is not supported by the device VPN');
  }
  async connect(options = {}) {
    return this.locked(async()=>{
      const current = await this.status();
      if (current.state !== 'inactive') throw new Error(current.state === 'active' ? 'The device VPN interface already exists' : current.message || 'Could not verify device VPN status');
      const {profile} = await this.readVault();
      const safeOptions = {dnsMode:options.dnsMode || 'unfiltered', customDns:String(options.customDns || '')};
      const config = renderConfig(profile, safeOptions);
      // Save the selected DNS policy for cleanup after an app restart/crash.
      await this.saveVault({config:renderConfig(profile, {dnsMode:'unfiltered'}), options:safeOptions});
      // Do not claim an existing interface if another client wins a race with us.
      // Mark ownership only after our elevated start command succeeds.
      await fs.rm(this.marker, {force:true});
      let started = false;
      try {
        if (this.platform === 'win32') {
          // Windows tunnel services reread this path on restart. Its directory is
          // ACL-restricted to this user and SYSTEM; it is deleted on disconnect.
          // Recreate rather than overwrite a stale file, so it inherits the
          // freshly restricted directory DACL instead of old explicit grants.
          await fs.rm(this.windowsConfig, {force:true});
          await fs.writeFile(this.windowsConfig, config, {mode:0o600, flag:'wx'});
          await this.elevated('up', this.windowsConfig);
        } else await this.withTempConfig(config, filename => this.elevated('up', filename));
        started = true;
        await fs.writeFile(this.marker, JSON.stringify({interface:NAME}), {mode:0o600});
        const result = await this.status();
        if (result.state !== 'active') throw new Error(result.message || 'WireGuard did not report an active interface');
        return result;
      } catch (error) {
        const runtime = await this.runtimeStatus();
        if (runtime.state === 'inactive') {
          await Promise.all([fs.rm(this.marker, {force:true}), fs.rm(this.windowsConfig, {force:true})]);
        } else if (!started) {
          // An interface/service whose ownership cannot be proved is never stopped
          // automatically. The user can inspect and clean it with WireGuard tools.
          await fs.rm(this.marker, {force:true});
        }
        throw new Error(`Could not start WireGuard: ${cleanError(error)}`);
      }
    });
  }
  async disconnect() {
    return this.locked(async()=>{
      const current = await this.status();
      if (current.state === 'inactive') {
        await Promise.all([fs.rm(this.marker, {force:true}), fs.rm(this.windowsConfig, {force:true})]);
        return this.status();
      }
      if (!current.owned) throw new Error('This interface was not started by OpenPath; stop it with its original client');
      if (current.state !== 'active' && current.state !== 'stopped') throw new Error(current.message || 'Could not verify device VPN status');
      try {
        // The Windows uninstall operation needs only the service name, so allow
        // emergency disconnect even if the saved profile can no longer be unlocked.
        if (this.platform === 'win32') await this.elevated('down', this.windowsConfig);
        else {
          const {profile, options} = await this.readVault();
          const config = renderConfig(profile, options);
          await this.withTempConfig(config, filename => this.elevated('down', filename));
        }
      } catch (error) { throw new Error(`Could not stop WireGuard: ${cleanError(error)}`); }
      const after = await this.runtimeStatus();
      if (after.state !== 'inactive') throw new Error('WireGuard did not confirm that the interface or service was removed');
      await Promise.all([fs.rm(this.marker, {force:true}), fs.rm(this.windowsConfig, {force:true})]);
      return this.status();
    });
  }
}

module.exports = { DeviceVpn, parseConfig, renderConfig, appleScriptCommand, DNS, NAME };
