import fs from 'fs';
import os from 'os';
import path from 'path';

export interface Config {
  serverUrl: string; user:string; psk:string;
  stealthProfile:string; jitter:boolean; padding:boolean; domainFront:boolean;
  autostart:boolean; killSwitch:boolean;
}
const P = path.join(os.homedir(), '.config','openpath','config.json');
export function load(): Config {
  try { if(fs.existsSync(P)) return JSON.parse(fs.readFileSync(P,'utf-8')); }catch{}
  return { serverUrl:'wss://cdn.openpath.example.com/ops', user:'demo', psk:'demo-student-key-do-not-use-prod', stealthProfile:'chrome124', jitter:true, padding:true, domainFront:false, autostart:false, killSwitch:false };
}
export function save(c:Config){ fs.mkdirSync(path.dirname(P),{recursive:true}); fs.writeFileSync(P, JSON.stringify(c,null,2)); try{fs.chmodSync(P,0o600);}catch{} }
export function pathOf(){ return P; }
