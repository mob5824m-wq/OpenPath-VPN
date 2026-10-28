// TUN abstraction — platform-specific implementations implement this interface
// Desktop (Windows/macOS/Linux) uses OS TUN via tun2socks/wintun; browser uses SOCKS proxy simulation

export interface TunnelProvider {
  start(): Promise<void>;
  stop(): Promise<void>;
  // called when OPSP frame with TUN_IPv4 payload arrives
  onPacket(packet: Uint8Array): void;
  // called to send IP packet into tunnel → becomes OPSP DATA frame
  setPacketHandler(handler: (pkt: Uint8Array)=>void): void;
  stats(): { rx: number; tx: number; packets: number };
}

export class NoopTunnel implements TunnelProvider {
  private handler: ((pkt:Uint8Array)=>void)|null=null;
  private rx=0;
  private tx=0;
  private pkts=0;
  async start(){}
  async stop(){}
  onPacket(p: Uint8Array){ this.rx+=p.length; this.pkts++; }
  setPacketHandler(h:(p:Uint8Array)=>void){ this.handler=h; }
  stats(){ return { rx:this.rx, tx:this.tx, packets:this.pkts }; }
  // Simulate outbound packet
  simulateSend(url: string){
    const pkt = new TextEncoder().encode(`GET ${url}`);
    this.tx+=pkt.length; this.pkts++; this.handler?.(pkt as any);
  }
}

// SOCKS5 local proxy (127.0.0.1:1080) fallback when TUN not available
// Browser cannot open raw sockets; we proxy fetch via ServiceWorker + tunnel
export class SocksProxyTunnel implements TunnelProvider {
  private handler: ((p:Uint8Array)=>void)|null=null;
  private rx=0;
  private tx=0;
  private pkts=0;
  constructor(private port=1080){}
  async start(){ console.log(`[SOCKS] Listening on 127.0.0.1:${this.port} (simulated); configure browser proxy to this`); }
  async stop(){}
  onPacket(p: Uint8Array){ this.rx+=p.length; this.pkts++; }
  setPacketHandler(h:(p:Uint8Array)=>void){ this.handler=h; }
  stats(){ return { rx:this.rx, tx:this.tx, packets:this.pkts }; }
}
