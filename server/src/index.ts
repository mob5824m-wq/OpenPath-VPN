import express from 'express';
import cors from 'cors';
import http from 'http';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { WebSocketServer, WebSocket } from 'ws';
import { config } from './config.js';
import { validateAuth, buildAuthToken } from './auth.js';
import { decoyHtml } from './decoy.js';
import { createSession, encryptFrame, decryptFrame, sessions, FrameType, fastEncode, fastDecode } from './transports/websocket.js';
import { forwardHttpRequest } from './proxy/forwarder.js';
import { ReleaseService } from './releases.js';
import hostsRouter from './hosts/routes.js';
import { startRegistryPruner, listHosts } from './hosts/registry.js';
import { startSubRegistration } from './subHost.js';
import { StealthRelayServer, STEALTH_PATH } from './stealth/relay.js';

const packageVersion = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {version:string}).version;
const app = express();
app.use(cors());
app.use(express.json());

// --- Health & API (with host role) ---
app.get('/health', (_req,res)=> res.json({
  ok:true, version:packageVersion, role: config.role, hostId: config.hostId, sessions: sessions.size, uptime: process.uptime(), hosts: listHosts().online,
  modes: ['stealth','fast','dual'], mode: config.vpnMode, fastPath: config.fastPath,
}));
app.get('/api/info', (_req,res)=> res.json({
  name: 'OpenPath-VPN Server',
  protocol: 'OpenPath WebSocket sessions',
  role: config.role, hostId: config.hostId, hostName: config.hostName,
  transports: ['websocket'],
  modes: { stealth: `${config.opsPath} WebSocket session`, fast: `${config.fastPath} WebSocket session` },
  port: config.port, decoy: !process.env.WEB_DIST, opsPath: config.opsPath, fastPath: config.fastPath, vpnMode: config.vpnMode,
}));
// Fast info endpoint for client toggle
app.get('/api/modes', (_req,res)=> res.json({
  current: config.vpnMode,
  available: [
    { id:'stealth', name:'Stealth', path: config.opsPath, desc:'WebSocket session. Use wss:// through a TLS-terminating proxy for transport encryption.' },
    { id:'fast', name:'Turbo', path: config.fastPath, desc:'Alternative WebSocket session. It is not a WireGuard tunnel.' },
  ]
}));
app.get('/api/stats', (_req,res)=>{
  const list = [...sessions.values()].map(s=> ({ id:s.id, user:s.user, createdAt:s.createdAt, lastSeen:s.lastSeen, rx:s.rxBytes, tx:s.txBytes }));
  res.json({ sessions: list, totalBytes: list.reduce((a,b)=> a+b.rx+b.tx,0), role: config.role, hosts: listHosts() });
});
app.post('/api/provision', (req,res)=>{
  const user = (req.body?.user || 'demo').toString();
  const psk = config.psks[user] || 'not-found';
  if (psk==='not-found') return res.status(404).json({ error:'unknown user' });
  const token = buildAuthToken(psk);
  const wsUrl = `wss://${req.headers.host}${config.opsPath}?auth=${encodeURIComponent(token)}&user=${encodeURIComponent(user)}`;
  const uri = `openpath://${req.headers.host}${config.opsPath}?psk=${encodeURIComponent(psk)}&user=${user}#${user}`;
  res.json({ user, psk, token, wsUrl, uri, hosts: listHosts() });
});
// Host directory: main lists sub-hosts, sub registers here
app.use('/api', hostsRouter);

const releaseService = new ReleaseService();
app.get('/api/releases', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try { res.json(await releaseService.get(req.query.refresh === '1')); }
  catch (error) { res.status(502).json({ error: (error as Error).message || 'Could not load releases' }); }
});

// --- DoH fallback tunnel (simplified) ---
app.get('/dns-query', (req,res)=>{
  const name = (req.query.name as string)||'';
  if (name.includes('openpath')) {
    res.json({ Status:0, Answer:[{ name, type:1, TTL:30, data:'1.1.1.1' }], tunnel:'doh-ok' });
    return;
  }
  res.json({ Status:0, Answer:[] });
});

// --- HTTP streaming transport fallback ---
app.post('/api/upload', (req,res)=>{
  let body = Buffer.alloc(0);
  req.on('data', d=> body=Buffer.concat([body,d]));
  req.on('end', ()=> {
    res.setHeader('Content-Type','application/octet-stream');
    res.setHeader('Cache-Control','no-store');
    res.write(body);
    res.end();
  });
});

app.get('/api/ip', (req,res)=>{
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || (req.socket.remoteAddress||'').replace('::ffff:','') || 'unknown';
  res.json({ ip, country: null, city: null, via: 'openpath' });
});
app.get('/api/client-ip', (req,res)=>{
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || (req.socket.remoteAddress||'').replace('::ffff:','') || 'unknown';
  res.json({ ip });
});

// A release's static dashboard can optionally be hosted by this server on the
// same origin as its API/WebSocket endpoints. Without WEB_DIST the decoy remains.
if (process.env.WEB_DIST) app.use(express.static(path.resolve(process.env.WEB_DIST), { dotfiles:'deny' }));

// --- Decoy website (must be last GET) ---
app.get('/', (_req,res)=>{
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.setHeader('Cache-Control','public, max-age=300');
  res.setHeader('X-Cache','HIT from yul-edge1');
  res.send(decoyHtml(config.decoyTitle));
});

// Fallback: any other GET not matching API/doh/ops returns decoy 404 page but 200
app.get('*', (_req,res)=>{
  res.status(200).setHeader('Content-Type','text/html').send(decoyHtml(config.decoyTitle) + `\n<!-- 404 but masked as 200 -->`);
});

const server = http.createServer(app);

const wss = new WebSocketServer({ noServer: true });
const fastWss = new WebSocketServer({ noServer: true });
const stealthRelay = new StealthRelayServer(process.env.STEALTH_WG_TARGET || '', process.env.STEALTH_TRUST_PROXY === '1', config.psks);

server.on('upgrade', (req, socket, head)=>{
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  if (url.pathname === STEALTH_PATH) {
    stealthRelay.handleUpgrade(req, socket, head, url);
    return;
  }
  const isFast = url.pathname.startsWith(config.fastPath) || url.searchParams.get('mode') === 'fast' || url.searchParams.get('fast') === '1';
  const pathOk = url.pathname.startsWith(config.opsPath) || url.pathname.startsWith(config.fastPath);
  if (!pathOk) {
    socket.write('HTTP/1.1 426 Upgrade Required\r\nContent-Type: text/html\r\n\r\nUpgrade required.');
    socket.destroy();
    return;
  }
  (req as any)._isFast = isFast;
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || (req.socket.remoteAddress||'unknown');
  const authRes = validateAuth(url, ip);
  if (!authRes.ok) {
    const delay = 200 + Math.floor(Math.random()*600);
    setTimeout(()=>{
      socket.write(`HTTP/1.1 404 Not Found\r\nContent-Type: text/html\r\nContent-Length: 0\r\n\r\n`);
      socket.destroy();
    }, delay).unref?.();
    // Never put authentication query tokens in server logs.
    console.log(`[auth-fail] ${ip} reason=${authRes.reason} path=${url.pathname}`);
    return;
  }
  if ((req as any)._isFast) {
    fastWss.handleUpgrade(req, socket, head, (ws)=> {
      fastWss.emit('connection', ws, req, authRes.user!);
    });
  } else {
    wss.handleUpgrade(req, socket, head, (ws)=> {
      wss.emit('connection', ws, req, authRes.user!);
    });
  }
});

wss.on('connection', (ws: WebSocket, req: any, user: string)=>{
  const session = createSession(ws, user);
  console.log(`[connect] user=${user} id=${session.id} ua=${req.headers['user-agent']?.slice(0,60)}`);
  // hello sent as plain JSON for web demo (client has no AES key yet) + encrypted variant optional
  const hello = Buffer.from(JSON.stringify({ t:'hello', id: session.id, user, serverTime: Date.now(), transports:['websocket'], mode:'stealth' }));
  ws.send(hello);

  let alive = true;
  const pingInterval = setInterval(()=>{
    if (!alive) { clearInterval(pingInterval); try{ws.terminate();}catch{} return; }
    alive = false;
    try { ws.ping(); } catch {}
    if (Math.random()<0.5) {
      try { ws.send(encryptFrame(session, Buffer.from('ping'), FrameType.KEEPALIVE)); } catch{}
    }
  }, 15000 + Math.floor(Math.random()*10000));

  ws.on('pong', ()=> { alive=true; session.lastSeen=Date.now(); });

  ws.on('message', async (raw: Buffer)=>{
    session.lastSeen = Date.now();
    session.rxBytes += raw.length;
    const dec = decryptFrame(session, raw as Buffer);
    let payload: Buffer | null = null;
    let payloadType = FrameType.DATA;
    if (dec) {
      payload = dec.plaintext;
      payloadType = dec.type;
      if (payloadType === FrameType.KEEPALIVE) {
        try { ws.send(encryptFrame(session, Buffer.from('pong'), FrameType.KEEPALIVE)); } catch{}
        return;
      }
      if (payloadType === FrameType.CLOSE) {
        ws.close(1000, 'client-close'); return;
      }
    } else {
      payload = raw as Buffer;
    }

    let handled = false;
    try {
      const msg = JSON.parse(payload.toString('utf8'));
      if (msg.op === 'fetch' && msg.url) {
        handled = true;
        const out = await forwardHttpRequest({ url: msg.url, method: msg.method, headers: msg.headers });
        const resp = Buffer.from(JSON.stringify({ op:'fetch-res', id: msg.id, status: out.status, headers: out.headers, body: out.body.toString('base64'), truncated: out.truncated }));
        const enc = dec ? encryptFrame(session, resp) : resp;
        session.txBytes += enc.length;
        ws.send(enc);
      } else if (msg.op === 'echo') {
        handled = true;
        const resp = Buffer.from(JSON.stringify({ op:'echo-res', id: msg.id, echo: msg.data }));
        const enc = dec ? encryptFrame(session, resp) : resp;
        session.txBytes += enc.length;
        ws.send(enc);
      } else if (msg.op === 'ping') {
        handled = true;
        const resp = Buffer.from(JSON.stringify({ op:'pong', t: typeof msg.t === 'number' ? msg.t : Date.now(), serverTime: Date.now() }));
        const enc = dec ? encryptFrame(session, resp, FrameType.KEEPALIVE) : resp;
        ws.send(enc);
      } else if (msg.op === 'hosts') {
        // client asks for host list over tunnel
        handled = true;
        const resp = Buffer.from(JSON.stringify({ op:'hosts-res', hosts: listHosts(), id: msg.id }));
        const enc = dec ? encryptFrame(session, resp) : resp;
        session.txBytes += enc.length;
        ws.send(enc);
      }
    } catch {}

    if (!handled) {
      const echo = Buffer.from(JSON.stringify({ op:'data-echo', len: payload.length, rx: session.rxBytes, tx: session.txBytes }));
      const enc = dec ? encryptFrame(session, echo) : echo;
      session.txBytes += enc.length;
      try { ws.send(enc); } catch {}
    }
  });

  ws.on('close', ()=>{
    clearInterval(pingInterval);
    sessions.delete(session.id);
    console.log(`[disconnect] user=${user} id=${session.id} rx=${session.rxBytes} tx=${session.txBytes}`);
  });
  ws.on('error', ()=> {
    clearInterval(pingInterval);
    sessions.delete(session.id);
  });
});

// --- Fast mode handler (Home Turbo) — plain JSON, no double-crypto, max throughput ---
fastWss.on('connection', (ws: WebSocket, req: any, user: string)=>{
  const session = createSession(ws, user);
  (session as any).isFast = true;
  console.log(`[fast-connect] user=${user} id=${session.id} mode=FAST (no obfuscation, home turbo)`);
  ws.send(fastEncode({ t:'hello', id: session.id, user, serverTime: Date.now(), mode:'fast', transports:['turbo-ws'], note:'Home Turbo — no DPI evasion, max speed' }));
  let alive = true;
  const pingInterval = setInterval(()=>{
    if (!alive) { clearInterval(pingInterval); try{ws.terminate();}catch{} return; }
    alive = false; try { ws.ping(); } catch {}
  }, 20000);
  ws.on('pong', ()=> { alive=true; session.lastSeen=Date.now(); });
  ws.on('message', async (raw: Buffer)=>{
    session.lastSeen = Date.now(); session.rxBytes += raw.length;
    const msg = fastDecode(raw as Buffer);
    if (!msg) {
      // raw binary fallback — echo back as plain
      const echo = fastEncode({ op:'data-echo', len: raw.length, rx: session.rxBytes, tx: session.txBytes, mode:'fast' });
      session.txBytes += echo.length; try { ws.send(echo); } catch {} ; return;
    }
    let handled = false;
    try {
      if (msg.op === 'fetch' && msg.url) {
        handled = true;
        const out = await forwardHttpRequest({ url: msg.url, method: msg.method, headers: msg.headers });
        const resp = fastEncode({ op:'fetch-res', id: msg.id, status: out.status, headers: out.headers, body: out.body.toString('base64'), truncated: out.truncated, mode:'fast' });
        session.txBytes += resp.length; ws.send(resp);
      } else if (msg.op === 'ping') {
        handled = true; const resp = fastEncode({ op:'pong', t: typeof msg.t === 'number' ? msg.t : Date.now(), serverTime: Date.now(), mode:'fast' }); ws.send(resp);
      } else if (msg.op === 'echo') {
        handled = true; const resp = fastEncode({ op:'echo-res', id: msg.id, echo: msg.data, mode:'fast' }); session.txBytes += resp.length; ws.send(resp);
      } else if (msg.op === 'hosts') {
        handled = true; const resp = fastEncode({ op:'hosts-res', hosts: listHosts(), id: msg.id, mode:'fast' }); session.txBytes += resp.length; ws.send(resp);
      } else if (msg.op === 'speedtest') {
        handled = true;
        // fast mode speedtest — return big chunk instantly
        const size = Math.min(parseInt(msg.bytes|| '100000'), 500000);
        const chunk = Buffer.alloc(size, 0x42);
        session.txBytes += chunk.length; ws.send(chunk);
      }
    } catch {}
    if (!handled) {
      const echo = fastEncode({ op:'data-echo', len: raw.length, rx: session.rxBytes, tx: session.txBytes, mode:'fast', msg });
      session.txBytes += echo.length; try { ws.send(echo); } catch {}
    }
  });
  ws.on('close', ()=>{
    clearInterval(pingInterval); sessions.delete(session.id);
    console.log(`[fast-disconnect] user=${user} id=${session.id} rx=${session.rxBytes} tx=${session.txBytes}`);
  });
  ws.on('error', ()=> { clearInterval(pingInterval); sessions.delete(session.id); });
});

server.listen(config.port, config.host, ()=>{
  const roleLabel = config.role === 'sub' ? 'SUB-HOST (registers to main)' : 'MAIN-HOST (directory)';
  console.log(`
╔══════════════════════════════════════════════╗
║  OpenPath-VPN Server  OPSP v1 (GhostPath)   ║
║  ${roleLabel.padEnd(42)}║
║  Listening on ${config.host}:${config.port}             ║
║  Session endpoints: ${config.opsPath} and ${config.fastPath}             ║
║  WebSocket only; TLS requires a proxy       ║
║  Role: ${config.role}  HostId: ${config.hostId.slice(0,22).padEnd(22)}║
╚══════════════════════════════════════════════╝
  Provision: POST /api/provision {user:"demo"}
  Health: GET /health  Stats: GET /api/stats
  Hosts:  GET /api/hosts  (app gets available sub-hosts from main)
  Register: POST /api/hosts/register  (sub -> main)
  Decoy: curl http://localhost:${config.port}/
`);
  // start host registry pruner on main
  if (config.role === 'main') startRegistryPruner();
  // if sub, register with main
  startSubRegistration();
});
