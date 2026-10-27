import { buildAuthTokenAsync } from './protocol/handshake.js';
import { WSTransport } from './transports/websocket.js';
import { DoHTransport } from './transports/doh.js';
import { H2StreamTransport } from './transports/http2stream.js';
import type { Transport } from './transports/interface.js';

export * from './transports/websocket.js';
export * from './transports/doh.js';
export * from './transports/http2stream.js';
export * from './tunnel/tun.js';

export interface OpenPathClientOpts {
  serverUrl: string; // wss://host/ops?user=demo — auth token auto-appended
  psk: string;
  path?: string;
  transports?: ('wss'|'h2'|'doh')[];
  onStatus?: (s: string)=>void;
  onStats?: (s: { rx:number; tx:number; rtt:number })=>void;
}

export class OpenPathClient {
  private transports: Transport[] = [];
  private active: Transport | null = null;
  private wsUrl = '';
  private psk = '';
  private path = '/ops';
  private rx=0, tx=0;
  private connected=false;
  private pingTimer:any=null;
  private reconnectAttempts=0;
  private rtt=0;
  private onStatus?: (s:string)=>void;
  private onStats?: (s:any)=>void;

  constructor(private opts: OpenPathClientOpts){
    this.psk = opts.psk;
    this.path = opts.path || '/ops';
    this.onStatus = opts.onStatus;
    this.onStats = opts.onStats;
    const order = opts.transports || ['wss','h2','doh'];
    for (const t of order) {
      if (t==='wss') this.transports.push(new WSTransport());
      if (t==='h2') this.transports.push(new H2StreamTransport());
      if (t==='doh') this.transports.push(new DoHTransport());
    }
  }

  async connect(){
    const base = this.opts.serverUrl;
    const u = new URL(base);
    // Build fresh auth token
    const token = await buildAuthTokenAsync(this.psk, this.path);
    u.searchParams.set('auth', token);
    if (!u.searchParams.has('user')) u.searchParams.set('user','demo');
    this.wsUrl = u.toString();

    let lastErr: any = null;
    for (const tr of this.transports) {
      try {
        this.onStatus?.(`Trying ${tr.name}...`);
        await this.tryTransport(tr, this.wsUrl);
        this.active = tr;
        this.connected = true;
        this.reconnectAttempts = 0;
        this.onStatus?.(`Connected via ${tr.name}`);
        this.startPing();
        return;
      } catch(e:any){
        lastErr = e;
        this.onStatus?.(`${tr.name} failed: ${e?.message||e} — trying next...`);
      }
    }
    throw lastErr || new Error('All transports failed');
  }

  private tryTransport(tr: Transport, url: string): Promise<void> {
    return new Promise((resolve, reject)=>{
      let opened=false;
      const timeout = setTimeout(()=> { if (!opened) reject(new Error('timeout')); }, 6000);
      tr.onOpen = ()=> { opened=true; clearTimeout(timeout); resolve(); };
      tr.onClose = ()=> { if (!opened) { clearTimeout(timeout); reject(new Error('closed before open')); } else this.handleClose(); };
      tr.onError = (e)=> { if (!opened) { clearTimeout(timeout); reject(e); } };
      tr.onMessage = (data)=> this.handleMessage(data);
      tr.connect(url, { headers: {} }).catch(reject);
    });
  }

  private handleMessage(data: Uint8Array|string){
    const len = typeof data==='string'? (data as string).length : (data as Uint8Array).length;
    this.rx += len;
    // Try parse JSON demo protocol
    try {
      const txt = typeof data==='string'? data as string : new TextDecoder().decode(data as Uint8Array);
      const msg = JSON.parse(txt);
      if (msg.op==='pong' || msg.t) {
        // RTT calc if msg carries timestamp
        if (msg.t) this.rtt = Date.now() - msg.t;
      }
      this.onStats?.({ rx:this.rx, tx:this.tx, rtt:this.rtt });
    } catch {}
  }

  private handleClose(){
    if (!this.connected) return;
    this.connected=false;
    this.onStatus?.('Disconnected — reconnecting...');
    this.stopPing();
    // Auto-reconnect with backoff
    const delay = Math.min(30000, 1000 * Math.pow(2, this.reconnectAttempts++));
    setTimeout(()=> this.connect().catch(e=> this.onStatus?.(`Reconnect failed: ${e.message}`)), delay);
  }

  private startPing(){
    this.stopPing();
    this.pingTimer = setInterval(()=>{
      const msg = JSON.stringify({ op:'ping', t: Date.now(), id: Math.random().toString(36).slice(2) });
      this.sendRaw(msg);
    }, 12000 + Math.random()*6000);
  }
  private stopPing(){ if (this.pingTimer) clearInterval(this.pingTimer); this.pingTimer=null; }

  sendRaw(data: string | Uint8Array){
    if (!this.active) return;
    // Apply random padding simulation at app layer (real: frame padding)
    this.active.send(data as any);
    const len = typeof data==='string'? (data as string).length : (data as Uint8Array).length;
    this.tx += len;
    this.onStats?.({ rx:this.rx, tx:this.tx, rtt:this.rtt });
  }

  async fetchViaTunnel(url: string): Promise<{ status:number; body:string }>{
    return new Promise((resolve, reject)=>{
      const id = Math.random().toString(36).slice(2,9);
      const onMsg = this.active?.onMessage;
      const wrapped = (data:any)=>{
        try {
          const txt = typeof data==='string'? data : new TextDecoder().decode(data);
          const msg = JSON.parse(txt);
          if (msg.op==='fetch-res' && msg.id===id) {
            if (this.active) this.active.onMessage = onMsg;
            const body = msg.body ? atob(msg.body) : '';
            resolve({ status: msg.status, body });
          } else {
            onMsg?.(data);
          }
        } catch { onMsg?.(data); }
      };
      if (this.active) this.active.onMessage = wrapped as any;
      this.sendRaw(JSON.stringify({ op:'fetch', url, id }));
      setTimeout(()=> { if (this.active) this.active!.onMessage = onMsg; reject(new Error('fetch timeout')); }, 8000);
    });
  }

  disconnect(){
    this.connected=false;
    this.stopPing();
    this.active?.close();
    this.onStatus?.('Disconnected');
  }

  get stats(){ return { rx:this.rx, tx:this.tx, rtt:this.rtt, connected:this.connected, transport: this.active?.name }; }
}
