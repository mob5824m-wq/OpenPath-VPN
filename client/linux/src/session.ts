import crypto from 'crypto';
import WebSocket, { type RawData } from 'ws';

export interface SessionOptions { serverUrl: string; psk: string; user: string }
export interface SessionStatus {
  connected: boolean;
  connecting: boolean;
  mode: 'websocket';
  server: string;
  secure: boolean;
  rx: number;
  tx: number;
  rtt: number;
  uptime: number;
}

/** An authenticated WebSocket session. This is not a system VPN or a TUN driver. */
export class WebSocketSession {
  private socket: WebSocket | null = null;
  private cancelPending: (() => void) | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private connected = false;
  private connecting = false;
  private startedAt = 0;
  private server = '';
  private secure = false;
  private rx = 0;
  private tx = 0;
  private rtt = 0;

  constructor(
    private onState: (state: SessionStatus) => void = () => {},
    private onLog: (message: string) => void = () => {},
  ) {}

  status(): SessionStatus {
    return {
      connected: this.connected, connecting: this.connecting, mode:'websocket',
      server:this.server, secure:this.secure, rx:this.rx, tx:this.tx, rtt:this.rtt,
      uptime:this.startedAt ? Date.now() - this.startedAt : 0,
    };
  }

  private emit() { this.onState(this.status()); }

  private sendPing(socket: WebSocket) {
    if(socket.readyState !== WebSocket.OPEN) return;
    const message = JSON.stringify({op:'ping', t:Date.now()});
    try { socket.send(message); this.tx += Buffer.byteLength(message); this.emit(); }
    catch(error) { this.onLog(`Could not send ping: ${(error as Error).message}`); }
  }

  async connect(opts: SessionOptions): Promise<SessionStatus> {
    const serverUrl = String(opts.serverUrl || '').trim();
    const psk = String(opts.psk || '');
    const user = String(opts.user || '').trim();
    if(!serverUrl || !psk || !user) throw new Error('Server, username and PSK are required');
    let url: URL;
    try { url = new URL(serverUrl); }
    catch { throw new Error('Enter a valid ws:// or wss:// server address'); }
    if(!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('Enter a ws:// or wss:// address without embedded credentials');
    }

    // Validate before disconnecting the existing session, and never send the PSK itself.
    const ts = String(Date.now());
    const nonce = crypto.randomBytes(12).toString('hex');
    const signature = crypto.createHmac('sha256', psk).update(`${ts}.${nonce}.${url.pathname}`).digest('hex');
    url.searchParams.set('auth', `${ts}.${nonce}.${signature}`);
    url.searchParams.set('user', user);
    this.disconnect();
    this.server = url.host;
    this.secure = url.protocol === 'wss:';
    this.connecting = true;
    this.emit();
    this.onLog(`Connecting to ${url.host}${url.pathname}${this.secure ? ' over TLS' : ' (unencrypted ws://)'}`);

    return new Promise((resolve, reject) => {
      let socket: WebSocket;
      try { socket = new WebSocket(url); }
      catch(error) {
        this.connecting = false;
        this.emit();
        reject(error);
        return;
      }
      this.socket = socket;
      let pending = true;
      const timeout = setTimeout(() => fail(new Error('Connection timed out')), 8000);
      const fail = (error: Error) => {
        if(!pending) return;
        pending = false;
        clearTimeout(timeout);
        this.cancelPending = null;
        if(this.socket === socket){
          this.socket = null;
          this.connecting = false;
          this.connected = false;
          this.emit();
          try { socket.terminate(); } catch {}
        }
        reject(error);
      };
      this.cancelPending = () => fail(new Error('Connection cancelled'));

      socket.on('open', () => {
        if(!pending || this.socket !== socket) { try { socket.terminate(); } catch {}; return; }
        pending = false;
        clearTimeout(timeout);
        this.cancelPending = null;
        this.connected = true;
        this.connecting = false;
        this.startedAt = Date.now();
        this.rx = 0; this.tx = 0; this.rtt = 0;
        this.onLog(`WebSocket session connected to ${this.server}. Device traffic is not routed.`);
        this.emit();
        this.sendPing(socket);
        this.pingTimer = setInterval(() => this.sendPing(socket), 15000);
        resolve(this.status());
      });
      socket.on('message', (raw: RawData) => {
        if(this.socket !== socket) return;
        const data = Array.isArray(raw) ? Buffer.concat(raw) : Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
        this.rx += data.length;
        try {
          const msg = JSON.parse(data.toString());
          if(msg.op === 'pong' && typeof msg.t === 'number') this.rtt = Math.max(0, Date.now() - msg.t);
        } catch {} // The server may also send binary keepalive frames.
        this.emit();
      });
      socket.on('error', error => {
        if(this.socket !== socket) return;
        this.onLog(`Connection error: ${error.message}`);
        if(pending) fail(new Error(`Could not connect: ${error.message}`));
      });
      socket.on('close', (code) => {
        if(pending) { fail(new Error(`Connection closed before it was established (${code})`)); return; }
        if(this.socket !== socket) return;
        this.socket = null;
        if(this.pingTimer) clearInterval(this.pingTimer);
        this.pingTimer = null;
        this.connected = false;
        this.connecting = false;
        this.startedAt = 0;
        this.onLog(`WebSocket session closed (${code})`);
        this.emit();
      });
    });
  }

  disconnect(): void {
    this.cancelPending?.();
    this.cancelPending = null;
    if(this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    const socket = this.socket;
    this.socket = null;
    if(socket){
      try { if(socket.readyState === WebSocket.CONNECTING) socket.terminate(); else socket.close(1000); } catch {}
      this.onLog('WebSocket session disconnected');
    }
    this.connected = false;
    this.connecting = false;
    this.startedAt = 0;
    this.rx = 0; this.tx = 0; this.rtt = 0;
    this.emit();
  }
}
