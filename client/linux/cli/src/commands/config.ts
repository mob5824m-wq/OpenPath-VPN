import { load, save, pathOf } from '../utils/config';
import chalk from 'chalk';

export async function configCmd(action:string, key?:string, value?:string){
  const cfg=load();
  if(action==='path') { console.log(pathOf()); return; }
  if(action==='get') {
    if(!key) console.log(JSON.stringify(cfg,null,2));
    else console.log(`${key}=${(cfg as any)[key] ?? ''}`);
    return;
  }
  if(action==='set') {
    if(!key||value===undefined){ console.error('Usage: openpath config set <key> <value>'); process.exit(1); }
    let v:any=value;
    if(value==='true') v=true; else if(value==='false') v=false;
    (cfg as any)[key]=v;
    save(cfg);
    console.log(chalk.green(`Saved ${key}=${v} → ${pathOf()}`));
    return;
  }
  console.error('Unknown config action. Use: openpath config get|set|path');
  process.exit(1);
}
