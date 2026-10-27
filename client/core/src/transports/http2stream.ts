import type { Transport } from './interface.js';
// HTTP/2 streaming fallback: POST chunked to /api/upload, read chunked response
export class H2StreamTransport implements Transport {
  name='h2-stream';
  private abort: AbortController | null=null;
  onMessage:any=null; onClose:any=null; onOpen:any=null; onError:any=null;
  private endpoint='';
  async connect(url: string): Promise<void> {
    // url is wss URL; convert to https upload endpoint
    try {
      const u = new URL(url.replace(/^wss/,'https'));
      this.endpoint = `${u.origin}/api/upload`;
    } catch { this.endpoint = '/api/upload'; }
    this.onOpen?.();
  }
  async send(data: Uint8Array|string){
    if (!this.endpoint) return;
    this.abort?.abort();
    this.abort = new AbortController();
    try {
      const res = await fetch(this.endpoint, { method:'POST', body: data as any, signal: this.abort.signal });
      const ab = await res.arrayBuffer();
      this.onMessage?.(new Uint8Array(ab));
    } catch(e:any){ if (e.name!=='AbortError') this.onError?.(e); }
  }
  close(){ this.abort?.abort(); this.onClose?.({}); }
}
