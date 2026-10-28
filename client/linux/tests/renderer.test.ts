import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync('src/renderer/index.html', 'utf8');
const tick = () => new Promise(resolve=>setTimeout(resolve, 0));

test('Linux connect/disconnect and tray actions call the native bridge and show actual state', async () => {
  const handlers:Record<string, Function> = {};
  const calls:any[] = [];
  let state = { connected:false, connecting:false, server:'vpn.example', secure:true, rx:0, tx:0, rtt:0 };
  const bridge = {
    getConfig:async()=>({serverUrl:'wss://vpn.example/ops', user:'student', psk:'key'}),
    status:async()=>state,
    connect:async(opts:any)=>{
      calls.push(['connect',opts]);
      state = { ...state, connected:true, tx:31 };
      handlers.state(state);
      return state;
    },
    disconnect:async()=>{ calls.push(['disconnect']); state = {...state, connected:false}; handlers.state(state); return {ok:true}; },
    logs:(cb:Function)=>{ handlers.log=cb; },
    onState:(cb:Function)=>{ handlers.state=cb; },
    onTrayConnect:(cb:Function)=>{ handlers.connect=cb; },
    onTrayDisconnect:(cb:Function)=>{ handlers.disconnect=cb; },
    onTraySettings:(cb:Function)=>{ handlers.settings=cb; },
  };
  const dom = new JSDOM(html, {runScripts:'dangerously', beforeParse(window){ (window as any).openpathLinux = bridge; }});
  try {
    await tick();
    const document = dom.window.document;
    const connect = document.getElementById('conn') as HTMLButtonElement;
    const disconnect = document.getElementById('disc') as HTMLButtonElement;
    assert.equal(connect.disabled, false);
    assert.equal(disconnect.disabled, true);
    connect.click();
    await tick();
    assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), ['connect', {serverUrl:'wss://vpn.example/ops', user:'student', psk:'key'}]);
    assert.match(document.getElementById('status')!.textContent!, /Session connected.*TLS/);
    assert.equal(connect.disabled, true);
    assert.equal(disconnect.disabled, false);
    disconnect.click();
    await tick();
    assert.equal(calls[1][0], 'disconnect');
    assert.equal(document.getElementById('status')!.textContent, 'Disconnected');
    handlers.connect();
    await tick();
    assert.equal(calls[2][0], 'connect');
    handlers.settings();
    assert.equal(document.activeElement?.id, 'server');
    handlers.disconnect();
    await tick();
    assert.equal(calls[3][0], 'disconnect');
  } finally { dom.window.close(); }
});

test('browser fallback disables controls instead of pretending to connect', () => {
  const dom = new JSDOM(html, {runScripts:'dangerously'});
  try {
    const document = dom.window.document;
    assert.match(document.getElementById('status')!.textContent!, /unavailable/);
    assert.equal((document.getElementById('conn') as HTMLButtonElement).disabled, true);
    assert.equal((document.getElementById('disc') as HTMLButtonElement).disabled, true);
  } finally { dom.window.close(); }
});
