import type { Transport } from './interface.js';

// DoH fallback: encode payload as subdomain label in dns-query
// Throughput ~30-50kbps but unblockable where DoH whitelisted
export class DoHTransport implements Transport {
  name='doh';
  private endpoint = 'https://cloudflare-dns.com/dns-query';
  private timer: any=null;
  private queue: Uint8Array[]=[];
  onMessage: any=null; onClose:any=null; onOpen:any=null; onError:any=null;
  private connected=false;
  async connect(_url: string): Promise<void> {
    this.connected=true;
    this.onOpen?.();
    // Poll loop: long-poll via fetch
    const poll = async ()=>{
      if (!this.connected) return;
      if (this.queue.length===0) { this.timer=setTimeout(poll, 1000); return; }
      const chunk = this.queue.shift()!;
      try {
        const label = btoa(String.fromCharCode(...chunk)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'').slice(0,60);
        const url = `${this.endpoint}?name=${label}.openpath.example.com&type=TXT`;
        const res = await fetch(url, { headers:{ accept:'application/dns-json' }});
        const j = await res.json();
        // Demo: echo back; real server returns data in TXT record
        this.onMessage?.(JSON.stringify({ op:'doh-res', data: j }));
      } catch(e){ this.onError?.(e); }
      this.timer=setTimeout(poll, 300);
    };
    poll();
  }
  send(data: Uint8Array|string){
    const buf = typeof data==='string'? new TextEncoder().encode(data) : data as Uint8Array;
    this.queue.push(buf);
  }
  close(){ this.connected=false; clearTimeout(this.timer); this.onClose?.({}); }
}
