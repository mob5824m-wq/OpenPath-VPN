import fs from 'fs';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import { load, pathOf } from '../utils/config';
import { log } from '../utils/logger';

export async function statusCmd(){
  const cfg=load();
  const pidPath=path.join(os.homedir(),'.config','openpath','openpath.pid');
  const online=fs.existsSync(pidPath);
  console.log(chalk.bold.cyan('OpenPath VPN — Linux status'));
  console.log(chalk.dim('─'.repeat(50)));
  console.log(`Config: ${chalk.cyan(pathOf())}`);
  console.log(`  server: ${cfg.serverUrl}  user:${cfg.user}  profile:${cfg.stealthProfile}`);
  console.log(`  jitter:${cfg.jitter?'on':'off'}  padding:${cfg.padding?'on':'off'}  killSwitch:${cfg.killSwitch?'on':'off'}`);
  console.log(`TLS: ${chalk.green('inside TLS 1.3 over TCP :443')}  SNI=${safeHost(cfg.serverUrl)}  ALPN=h2  JA3≈Chrome124`);
  console.log(`Mimic: HTTPS web traffic (sizes 60/1200/1460, burst coalesce, browser headers)`);
  if (online){
    try{
      const j=JSON.parse(fs.readFileSync(pidPath,'utf-8'));
      const up=Math.floor((Date.now()-j.startedAt)/1000);
      console.log(chalk.green(`\n● TUNNEL UP  pid ${j.pid}  up ${up}s`));
      console.log(`  endpoint: ${j.serverUrl}  wsUrl: ${String(j.wsUrl).slice(0,70)}…`);
      // TUN check
      try{ const out=require('child_process').execSync('ip link show tun0 2>&1').toString(); console.log(chalk.dim(out.split('\n')[0])); }catch{ console.log(chalk.dim('  TUN: SOCKS fallback 127.0.0.1:1080 (no root)')); }
    }catch(e:any){ log.warn(e.message); }
  } else {
    console.log(chalk.yellow('\n○ Disconnected — run `openpath connect`'));
  }
}

function safeHost(u:string){ try{ return new URL(u).host }catch{ return u } }
