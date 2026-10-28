import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync('src/renderer/index.html', 'utf8');
const tick = () => new Promise(resolve=>setTimeout(resolve, 0));

test('Linux device VPN panel imports a profile and applies the requested DNS policy', async () => {
  const calls:any[] = [];
  let device:any = {state:'inactive', configured:false, owned:false, installed:true, interface:'opvpn0'};
  const bridge = {
    getConfig:async()=>({serverUrl:'wss://vpn.example/ops', user:'demo', psk:'key'}),
    status:async()=>({connected:false,connecting:false}),
    connect:async()=>({connected:false,connecting:false}), disconnect:async()=>({ok:true}),
    logs:()=>{}, onState:()=>{}, onTrayConnect:()=>{}, onTrayDisconnect:()=>{}, onTraySettings:()=>{},
    deviceVpn:{
      status:async()=>({...device}),
      importProfile:async()=>{calls.push(['import']);device={...device,configured:true};return {configured:true}},
      removeProfile:async()=>{calls.push(['remove']);device={...device,configured:false};return {ok:true}},
      connect:async(opts:any)=>{calls.push(['connect',opts]);device={...device,state:'active',owned:true};return {...device}},
      disconnect:async()=>{calls.push(['disconnect']);device={...device,state:'inactive',owned:false};return {...device}},
    },
  };
  const dom = new JSDOM(html, {runScripts:'dangerously', beforeParse(window){(window as any).openpathLinux=bridge}});
  try {
    await tick();
    const doc=dom.window.document;
    const importButton=doc.getElementById('device-import') as HTMLButtonElement;
    const connectButton=doc.getElementById('device-connect') as HTMLButtonElement;
    const disconnectButton=doc.getElementById('device-disconnect') as HTMLButtonElement;
    const dns=doc.getElementById('device-dns') as HTMLSelectElement;
    assert.equal(importButton.disabled,false); assert.equal(connectButton.disabled,true);
    importButton.click(); await tick();
    dns.value='malware'; connectButton.click(); await tick();
    assert.match(doc.getElementById('device-status')!.textContent!,/interface active/);
    assert.equal(disconnectButton.disabled,false);
    disconnectButton.click(); await tick();
    assert.match(doc.getElementById('device-status')!.textContent!,/disconnected/);
    assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['import'],['connect',{dnsMode:'malware',customDns:''}],['disconnect']]);
  } finally {dom.window.close();}
});
