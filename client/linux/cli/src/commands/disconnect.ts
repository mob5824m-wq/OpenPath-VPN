import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { log } from '../utils/logger';

export async function disconnectCmd(){
  const pidPath=path.join(os.homedir(),'.config','openpath','openpath.pid');
  let killed=false;
  if (fs.existsSync(pidPath)){
    try{
      const j=JSON.parse(fs.readFileSync(pidPath,'utf-8'));
      if (j.pid) { process.kill(j.pid, 'SIGTERM'); log.info(`Stopped openpath pid ${j.pid}`); killed=true; }
    }catch(e:any){ log.warn(e.message); }
    try{ fs.unlinkSync(pidPath);}catch{}
  }
  // cleanup TUN if we were root
  try{ execSync('ip link del dev tun0 2>/dev/null; iptables -t nat -D POSTROUTING -o tun0 -j MASQUERADE 2>/dev/null; echo cleaned'); log.info('TUN/iptables cleaned'); }catch{}
  try{ execSync('gsettings set org.gnome.system.proxy mode none 2>/dev/null'); }catch{}
  if(!killed) log.info('No active tunnel (or use Ctrl+C in connect window).');
}
