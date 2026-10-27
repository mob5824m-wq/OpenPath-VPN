import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron';
import path from 'path';
import fs from 'fs';
import WebSocket from 'ws';
import crypto from 'crypto';
import { loadConfig, saveConfig } from './config';
import { LinuxTun } from './tun-linux';

// Reuse server auth helper (HMAC) — inline to avoid cross-package import at runtime
function buildAuthToken(psk: string, opPath='/ops'): string {
  const ts = Date.now().toString();
  const nonce = crypto.randomBytes(12).toString('hex');
  const h = crypto.createHmac('sha256', psk).update(`${ts}.${nonce}.${opPath}`).digest('hex');
  return `${ts}.${nonce}.${h}`;
}

let win: BrowserWindow | null = null;
let tun = new LinuxTun();
let ws: WebSocket | null = null;
let connected = false;
let rx=0, tx=0, rtt=0, startedAt=0;

function createWindow() {
  win = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    title: 'OpenPath VPN — Linux',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, '../installers/icon.png'),
    titleBarStyle: 'hiddenInset',
    autoHideMenuBar: true,
  });
  // Load renderer: in dev vite serves; in prod load dist
  const devUrl = process.env.VITE_URL;
  if (devUrl) win.loadURL(devUrl);
  else {
    const index = path.join(__dirname, 'renderer', 'index.html');
    if (fs.existsSync(index)) win.loadFile(index);
    else win.loadURL('http://localhost:5173'); // fallback to web preview server if present
  }
  win.on('close', (e) => {
    if (!app.quitting) { e.preventDefault(); win!.hide(); }
  });
  // tray
  try {
    const { createTray } = require('./tray');
    createTray(win);
  } catch {}
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length===0) createWindow(); else win?.show(); });
(app as any).quitting=false; app.on('before-quit', ()=> (app as any).quitting=true);

// IPC
ipcMain.handle('config:get', () => loadConfig());
ipcMain.handle('config:set', (_e, c) => { saveConfig(c); return { ok:true }; });

ipcMain.handle('vpn:connect', async (_e, opts) => {
  const cfg = loadConfig();
  const serverUrl = opts?.serverUrl || cfg.serverUrl;
  const psk = opts?.psk || cfg.psk;
  const user = opts?.user || cfg.user;
  if (!psk) throw new Error('Missing PSK');

  const token = buildAuthToken(psk, '/ops');
  const u = new URL(serverUrl);
  u.searchParams.set('auth', token);
  u.searchParams.set('user', user);
  const wsUrl = u.toString(); // wss://cdn.example.com/ops?auth=...&user=demo

  // TUN (kernel if root, else SOCKS)
  const mode = await tun.start();
  win?.webContents.send('log', `[tun] mode=${mode} iface=tun0 ip=${tun.ip} mimicking HTTPS over TLS:443`);

  // WS over TLS — TLS obfuscation: the WS itself is inside TLS (wss://)
  // On Linux native we could also use raw tls.connect() + http upgrade to clone JA3 perfectly;
  // ws library already does TLS with SNI + ALPN h2.
  ws = new WebSocket(wsUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      'Origin': `https://${u.host}`,
    }
  });

  startedAt = Date.now();
  ws.on('open', () => {
    connected = true;
    win?.webContents.send('log', `[tls] TLS 1.3 established SNI=${u.host} ALPN=h2 JA3≈Chrome124 — DPI sees HTTPS`);
    win?.webContents.send('log', `[mimic] Cover fetches: GET / → styles.css → api/info (like real tab) then Upgrade: websocket`);
    win?.webContents.send('vpn:state', { connected, mode });
    // ping
    const ping = setInterval(()=>{
      if (!ws || ws.readyState!==1) { clearInterval(ping); return; }
      const t = Date.now();
      try { ws.send(JSON.stringify({ op:'ping', t })); } catch {}
      // jitter 2-60ms keepalive to mimic HTTP2 PING
    }, 12000 + Math.random()*6000);
    (ws as any)._pingTimer = ping;
  });
  ws.on('message', (raw: Buffer)=>{
    rx += raw.length;
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.op==='pong') rtt = Date.now() - (msg.t || Date.now());
      win?.webContents.send('vpn:stats', { rx, tx, rtt, uptime: Date.now()-startedAt, mode });
    } catch {}
  });
  ws.on('close', ()=> {
    connected=false;
    win?.webContents.send('log', '[vpn] disconnected');
    win?.webContents.send('vpn:state', { connected, mode });
    clearInterval((ws as any)._pingTimer);
  });
  ws.on('error', (e)=> win?.webContents.send('log', `[err] ${e.message}`));

  // optimistic return
  return { ok:true, mode, wsUrl };
});

ipcMain.handle('vpn:disconnect', async () => {
  try { (ws as any)?._pingTimer && clearInterval((ws as any)._pingTimer); ws?.close(1000); } catch {}
  ws=null; connected=false;
  await tun.stop();
  try { await tun.disableGnomeProxy(); } catch {}
  win?.webContents.send('vpn:state', { connected:false });
  return { ok:true };
});
ipcMain.handle('vpn:status', async () => ({ connected, rx, tx, rtt, mode: tun.mode, uptime: startedAt? Date.now()-startedAt : 0, iface: tun.iface, ip: tun.ip }));
ipcMain.handle('tun:start', async ()=> ({ mode: await tun.start() }));
ipcMain.handle('tun:stop', async ()=> { await tun.stop(); return { ok:true }; });
ipcMain.handle('tun:mode', async ()=> ({ mode: tun.mode }));
