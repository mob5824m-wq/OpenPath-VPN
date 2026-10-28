/** Fixed-destination WireGuard datagrams over authenticated WebSockets.
 * The TLS reverse proxy must be trusted and the backend isolated from clients.
 */
import { createSocket, type Socket } from 'node:dgram';
import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { validateAuth } from '../auth.js';

export const STEALTH_PATH = '/stealth-wg';
const MAX_PACKET = 2048;
const MAX_QUEUED = 1024 * 1024;
const MAX_CLIENTS = 128;
const FORBIDDEN_DEMO = 'demo-student-key-do-not-use-prod';

type Target = { address:string; port:number; family:'udp4'|'udp6' };
export function parseRelayTarget(value:string):Target {
  const match = /^(?:\[([^\]]+)\]|([^:]+)):(\d{1,5})$/.exec(value);
  const address = match?.[1] || match?.[2] || '';
  const family = isIP(address);
  const port = Number(match?.[3]);
  if (!family || !Number.isInteger(port) || port < 1 || port > 65535 || address.includes('%')) {
    throw new Error('STEALTH_WG_TARGET must be a numeric IP and UDP port, e.g. 127.0.0.1:51820');
  }
  return {address, port, family:family === 4 ? 'udp4' : 'udp6'};
}

/** A WireGuard handshake, cookie or transport datagram; never an arbitrary UDP relay. */
export function isWireGuardPacket(data:Buffer):boolean {
  if (data.length < 4 || data.length > MAX_PACKET || data[1] || data[2] || data[3]) return false;
  const type = data[0];
  return (type === 1 && data.length === 148) || (type === 2 && data.length === 92) ||
    (type === 3 && data.length === 64) || (type === 4 && data.length >= 32);
}

export class StealthRelayServer {
  private readonly wss = new WebSocketServer({ noServer:true, maxPayload:MAX_PACKET, perMessageDeflate:false });
  private readonly target:Target | null;
  private readonly trustProxy:boolean;
  constructor(target:string, trustProxy:boolean, private readonly psks:Record<string,string>) {
    this.target = target ? parseRelayTarget(target) : null;
    this.trustProxy = trustProxy;
  }
  get enabled():boolean { return !!this.target && this.trustProxy; }

  handleUpgrade(req:IncomingMessage, socket:import('node:stream').Duplex, head:Buffer, url:URL):void {
    // X-Forwarded-Proto is meaningful ONLY if an operator isolates this HTTP
    // backend and explicitly trusts the TLS-terminating reverse proxy.
    const forwarded = req.headers['x-forwarded-proto'];
    const secure = this.trustProxy && typeof forwarded === 'string' && forwarded.toLowerCase() === 'https';
    const user = url.searchParams.get('user') || 'demo';
    const peer = req.socket.remoteAddress || 'unknown';
    if (!this.enabled || !secure || this.wss.clients.size >= MAX_CLIENTS || this.psks[user] === FORBIDDEN_DEMO ||
        !validateAuth(url, peer, true).ok) {
      socket.write('HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    this.wss.handleUpgrade(req, socket, head, ws => this.attach(ws, this.target!));
  }

  private attach(ws:WebSocket, target:Target):void {
    let udp:Socket | null = createSocket(target.family);
    let closed = false;
    let pong = true;
    let connected = false;
    const shutdown = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      const old = udp; udp = null;
      try { old?.close(); } catch { /* socket may not have bound yet */ }
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
    };
    const heartbeat = setInterval(() => {
      if (!pong) { ws.terminate(); shutdown(); return; }
      pong = false;
      try { ws.ping(); } catch { shutdown(); }
    }, 25000);
    heartbeat.unref?.();
    ws.on('pong', () => { pong = true; });
    ws.on('close', shutdown);
    ws.on('error', shutdown);
    udp.on('error', shutdown);
    udp.on('message', data => {
      if (!isWireGuardPacket(data)) return;
      if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > MAX_QUEUED) { shutdown(); return; }
      ws.send(data, {binary:true}, error => { if (error) shutdown(); });
    });
    ws.on('message', (raw:RawData, binary:boolean) => {
      const data = Buffer.isBuffer(raw) ? raw : Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(raw);
      if (!binary || !connected || !isWireGuardPacket(data) || !udp || udp.getSendQueueSize() > MAX_QUEUED) { shutdown(); return; }
      try { udp.send(data, error => { if (error) shutdown(); }); } catch { shutdown(); }
    });
    udp.connect(target.port, target.address, () => {
      if (closed || ws.readyState !== WebSocket.OPEN) return;
      connected = true;
      ws.send(JSON.stringify({type:'ready', protocol:'wireguard-ws', version:1}));
    });
  }
}
