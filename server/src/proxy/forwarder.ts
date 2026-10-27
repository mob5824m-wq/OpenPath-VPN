// Production: uses raw TUN via node-tun or iptables NAT.
// Demo: transparent HTTP/SOCKS-style proxy via fetch + DNS over tunnel.

export type ProxyTarget = { host: string; port: number; protocol: 'tcp'|'udp'|'http'|'https' };

export async function forwardHttpRequest(opts: {
  url: string;
  method?: string;
  headers?: Record<string,string>;
  body?: Buffer | string;
}): Promise<{ status: number; headers: Record<string,string>; body: Buffer }> {
  try {
    const res = await fetch(opts.url, {
      method: opts.method || 'GET',
      headers: opts.headers,
      body: opts.body as any,
      redirect: 'follow',
    });
    const arrayBuf = await res.arrayBuffer();
    const headers: Record<string,string> = {};
    res.headers.forEach((v,k)=> headers[k]=v);
    return { status: res.status, headers, body: Buffer.from(arrayBuf) };
  } catch (e:any) {
    return { status: 502, headers: {}, body: Buffer.from(`Bad Gateway: ${e.message}`) };
  }
}

// SOCKS-like TCP connect simulation via fetch for demo; real server opens raw socket
export function canUseRawSocket(): boolean {
  // Check if we have privileges for raw sockets (needs CAP_NET_RAW)
  return false; // demo runs unprivileged
}
