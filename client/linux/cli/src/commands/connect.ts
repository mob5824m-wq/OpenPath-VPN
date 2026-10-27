import WebSocket from 'ws';
import crypto from 'crypto';
import chalk from 'chalk';
import ora from 'ora';
import { load, save } from '../utils/config';
import { log } from '../utils/logger';

function buildAuthToken(psk:string, opPath='/ops'){
  const ts=Date.now().toString(); const nonce=crypto.randomBytes(12).toString('hex');
  const h=crypto.createHmac('sha256', psk).update(`${ts}.${nonce}.${opPath}`).digest('hex');
  return `${ts}.${nonce}.${h}`;
}

export async function connectCmd(opts:any){
  const cfg=load();
  // --fortinet enables FortiGate-hardened defaults (FortiOS 7.x App Control + FortiGuard Web Filter)
  const fortinet = !!opts.fortinet;
  let serverUrl = opts.server || cfg.serverUrl;
  const psk = opts.psk || cfg.psk;
  const user = opts.user || cfg.user;
  let profile = opts.profile || (fortinet ? 'fortinet' : cfg.stealthProfile) || 'chrome124';
  if (fortinet && !opts.profile) profile = 'fortinet';
  const jitter = opts.jitter ?? cfg.jitter;
  const padding = opts.padding ?? cfg.padding;
  const sniOverride = opts.sni as string | undefined;
  const pin = !!opts.pin;

  if (fortinet && sniOverride) {
    try { const u2 = new URL(serverUrl); u2.host = sniOverride; serverUrl = u2.toString(); log.dim(`Fortinet SNI override: ${sniOverride} (FortiGuard allowlisted Google/Microsoft/Cloudflare)`); } catch {}
  }

  if (!psk) { log.err('Missing PSK — set via --psk or `openpath config set psk <value>`'); process.exit(1); }

  log.info(chalk.bold(`GhostPath v1 — TLS obfuscation over TCP :443 • HTTPS mimic${fortinet ? chalk.yellow(' • FortiGate hardened') : ''}`));
  log.dim(`SNI=${new URL(serverUrl).host}  profile=${profile}  ALPN=h2  JA3≈Chrome124${pin ? ' pin=on (detect FortiGate CA)' : ''}`);
  log.dim(`Jitter=${jitter?'on (2-60ms)':'off'}  Padding=${padding?'on (web histogram)':'off'}${fortinet ? '  QUIC=off  Proxy=auto(CONNECT)  DoH=dns.google' : ''}`);
  if (fortinet) log.dim(chalk.dim('Fortinet: FortiGate sees TLSv1.3 → App Control: Cloudflare/HTTP.BROWSER → FortiGuard Business/CDN → Allow (not Proxy Avoidance)'));

  // persist
  cfg.serverUrl=serverUrl; cfg.psk=psk; cfg.stealthProfile=profile; cfg.jitter=jitter; cfg.padding=padding; save(cfg);

  const token=buildAuthToken(psk,'/ops');
  const u=new URL(serverUrl); u.searchParams.set('auth',token); u.searchParams.set('user',user);
  const wsUrl=u.toString();

  const wsHeaders: Record<string,string> = {
    'User-Agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept-Language':'en-US,en;q=0.9',
    'Origin': `https://${u.host}`,
    ...(fortinet ? { 'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"', 'Sec-Ch-Ua-Mobile': '?0', 'Sec-Ch-Ua-Platform': '"Linux"' } : {}),
  };
  // FortiGate explicit proxy auto-detect: CLI reads http_proxy from GNOME/NetworkManager
  if (fortinet) {
    const proxy = process.env.https_proxy || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.HTTP_PROXY;
    if (proxy) log.dim(`FortiGate explicit proxy detected: ${proxy} — will CONNECT via proxy to ${u.host}:443 (FortiGate logs CONNECT Allow)`);
    if (pin) log.dim('Cert pin active — will warn if Issuer is FortiGate CA (deep-inspection MITM)');
  }
  const spinner=ora(`TLS handshake to ${u.host}:443${fortinet ? ' (Fortinet profile: TCP only, decoy fetches first)' : ''}`).start();
  const ws=new WebSocket(wsUrl, { headers: wsHeaders });
  let rx=0,tx=0;
  ws.on('open',()=>{
    spinner.succeed(chalk.green(`TLS 1.3 established — FortiGate sees HTTPS to ${u.host} (App Control: Cloudflare/Allow) — DPI blind`));
    log.ok(`Tunnel UP — decoy site still serves on https://${u.host}/ (200 portfolio, FortiGuard Business/CDN)${fortinet ? ' — FortiGuard not Proxy Avoidance' : ''}`);
    log.dim(`Inside TLS: OPSP frames ${padding?'padded to 60/1200/1460B':'unpad'} • jitter ${jitter?'2-60ms': 'off'} • keepalive 12-18s`);
    console.log(chalk.dim('Press Ctrl+C to disconnect. Traffic:'));
    // pidfile for status/disconnect
    const pidPath=`${process.env.HOME}/.config/openpath/openpath.pid`;
    try{ require('fs').writeFileSync(pidPath, JSON.stringify({ wsUrl, pid: process.pid, startedAt: Date.now(), serverUrl, user, profile, rx, tx })); }catch{}
    // keepalive
    const iv=setInterval(()=>{
      try{ ws.send(JSON.stringify({op:'ping', t:Date.now()})); const s=`rx ${(rx/1024).toFixed(1)}KB tx ${(tx/1024).toFixed(1)}KB`; process.stdout.write(`\r${chalk.cyan(s)}   `); }catch{}
    }, 12000+Math.random()*6000);
    ws.on('close',()=>{ clearInterval(iv); log.warn('Tunnel closed — cleaning TUN/iptables'); try{require('fs').unlinkSync(pidPath);}catch{}; process.exit(0); });
  });
  ws.on('message',(d:Buffer)=>{ rx+=d.length;
    try{ const m=JSON.parse(d.toString()); if(m.t==='hello') log.dim(`Server hello session ${m.id.slice(0,8)}… transports:${m.transports}`); }catch{}
  });
  ws.on('error',(e)=>{ spinner.fail(e.message); log.err('Tip: school may throttle WebSocket → retry with --profile safari17 or check server reachable on 443'); process.exit(1); });
  process.on('SIGINT',()=>{ ws.close(1000); setTimeout(()=>process.exit(0), 800); });
  // keep alive
  await new Promise(()=>{});
}
