import type { Transport } from './interface.js';

export class WSTransport implements Transport {
  name = 'wss';
  ws: WebSocket | null = null;
  onMessage: ((d:any)=>void)|null=null;
  onClose: ((e:any)=>void)|null=null;
  onOpen: (()=>void)|null=null;
  onError: ((e:any)=>void)|null=null;

  private chromeHeaders(): Record<string,string> {
    return {
      // These are set automatically by browser; included for docs
    };
  }

  connect(url: string): Promise<void> {
    return new Promise((resolve, reject)=>{
      try {
        const ws = new WebSocket(url);
        (ws as any).binaryType = 'arraybuffer';
        this.ws = ws;
        ws.onopen = ()=> { this.onOpen?.(); resolve(); };
        ws.onmessage = (e)=> {
          let data: Uint8Array|string = e.data;
          if (data instanceof ArrayBuffer) data = new Uint8Array(data);
          else if (data instanceof Blob) { data.text().then(t=> this.onMessage?.(t)); return; }
          this.onMessage?.(data);
        };
        ws.onclose = (e)=> this.onClose?.(e);
        ws.onerror = (e)=> { this.onError?.(e); reject(e); };
      } catch (e) { reject(e); }
    });
  }
  send(data: Uint8Array | string) {
    if (!this.ws || this.ws.readyState !== 1) return;
    this.ws.send(data as any);
  }
  close(){ try{this.ws?.close(1000)}catch{} }
}
