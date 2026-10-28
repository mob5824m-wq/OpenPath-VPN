const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');

function execute(file, electron, extras={}) {
  const source = fs.readFileSync(file, 'utf8');
  const localRequire = createRequire(path.resolve(file));
  vm.runInNewContext(source, {
    require:(name)=>name === 'electron' ? electron : localRequire(name),
    __dirname:path.dirname(path.resolve(file)), process, URL, console, ...extras,
  }, {filename:file});
}

test('desktop preload dispatches the window buttons and TUN requests over IPC', () => {
  const calls = [];
  let bridge;
  const electron = {
    contextBridge:{exposeInMainWorld:(_name, value)=>{bridge=value;}},
    ipcRenderer:{send:(...args)=>calls.push(['send', ...args]), invoke:(...args)=>calls.push(['invoke', ...args])},
  };
  execute('electron/preload.js', electron);
  bridge.window.minimize(); bridge.window.maximize(); bridge.window.close(); bridge.tunStart({});
  bridge.deviceVpn.status(); bridge.deviceVpn.importProfile(); bridge.deviceVpn.connect({dnsMode:'ads'}); bridge.deviceVpn.disconnect();
  assert.deepEqual(calls.map(c=>c.slice(0,2)), [
    ['send','window:minimize'], ['send','window:maximize'], ['send','window:close'], ['invoke','tun:start'],
    ['invoke','device-vpn:status'], ['invoke','device-vpn:import'], ['invoke','device-vpn:connect'], ['invoke','device-vpn:disconnect'],
  ]);
});

test('desktop main wires window controls and restricts VPN IPC to the application window', async () => {
  const listeners = {};
  const handlers = {};
  const external = [];
  let created;
  class FakeWindow {
    constructor() { created=this; this.maximized=false; this.calls=[]; this.webContents={setWindowOpenHandler:fn=>{this.openHandler=fn;}, on:(name,fn)=>{if(name==='will-navigate')this.navigationHandler=fn;}}; }
    loadURL(url){ this.loaded=url; }
    minimize(){ this.calls.push('minimize'); }
    maximize(){ this.maximized=true; this.calls.push('maximize'); }
    unmaximize(){ this.maximized=false; this.calls.push('unmaximize'); }
    isMaximized(){ return this.maximized; }
    close(){ this.calls.push('close'); }
    static getAllWindows(){ return [created]; }
  }
  const electron = {
    app:{ whenReady:()=>Promise.resolve(), on:()=>{}, quit:()=>{} },
    BrowserWindow:FakeWindow,
    ipcMain:{ on:(name,cb)=>{listeners[name]=cb;}, handle:(name,cb)=>{handlers[name]=cb;} },
    shell:{openExternal:url=>external.push(url)},
  };
  execute('electron/main.js', electron);
  await Promise.resolve();
  created.webContents.mainFrame = {url:created.loaded};
  const trusted = {sender:created.webContents, senderFrame:created.webContents.mainFrame};
  listeners['window:minimize'](trusted);
  listeners['window:maximize'](trusted);
  listeners['window:maximize'](trusted);
  listeners['window:close'](trusted);
  listeners['window:close']({});
  assert.deepEqual(created.calls, ['minimize','maximize','unmaximize','close']);
  await assert.rejects(handlers['tun:start']({}), /restricted to the OpenPath window/);
  await assert.rejects(handlers['device-vpn:import']({}), /restricted to the OpenPath window/);
  assert.equal(created.openHandler({url:'https://github.com/example'}).action, 'deny');
  created.openHandler({url:'javascript:alert(1)'});
  let blocked = false;
  created.navigationHandler({preventDefault:()=>{blocked=true;}}, 'https://untrusted.example/');
  assert.equal(blocked, true);
  blocked = false;
  created.navigationHandler({preventDefault:()=>{blocked=true;}}, `${created.loaded}/settings`);
  assert.equal(blocked, false);
  assert.deepEqual(external, ['https://github.com/example', 'https://untrusted.example/']);
});
