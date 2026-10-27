/**
 * HTTPS Traffic Mimicry — shape outbound frames to look like regular browsing.
 *
 * Applied as a decorator around any Transport.send():
 *   - pads payload size to web histogram (60B / 1200B / 1460B peaks)
 *   - injects timing jitter 2-60ms
 *   - coalesces small frames into one TLS record
 *   - injects realistic browser headers on upgrade
 */

export interface MimicOpts {
  enabled: boolean;
  profile: 'chrome124' | 'safari17' | 'firefox128' | 'meet';
  jitter: boolean;
  padding: boolean;
  coalesce: boolean;
}

export const defaultMimic: MimicOpts = {
  enabled: true,
  profile: 'chrome124',
  jitter: true,
  padding: true,
  coalesce: true,
};

const uaFor: Record<string,string> = {
  chrome124: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  safari17: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  firefox128: 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0',
  meet: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36 WebRTC/Meet',
};

export function mimicHeaders(profile: keyof typeof uaFor, origin = 'https://cdn.openpath.example.com') {
  return {
    'User-Agent': uaFor[profile] || uaFor.chrome124,
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Origin': origin,
    'Referer': origin+'/',
    'Sec-Fetch-Dest': 'websocket',
    'Sec-Fetch-Mode': 'websocket',
    'Cache-Control': 'no-cache',
  };
}

export function applyPadding(buf: Uint8Array, enabled: boolean): Uint8Array {
  if (!enabled) return buf;
  const r = Math.random();
  let target: number;
  if (r < 0.35) target = 60 + Math.floor(Math.random()*30);       // ack-like
  else if (r < 0.75) target = 1100 + Math.floor(Math.random()*250); // html/json chunk
  else target = 1300 + Math.floor(Math.random()*160);               // image chunk
  if (buf.length >= target) return buf;
  const padded = new Uint8Array(target);
  padded.set(buf);
  // pad with random (already pseudo-random due to OPSP AEAD padding, but ensure)
  for(let i=buf.length;i<target;i++) padded[i]= Math.floor(Math.random()*256);
  return padded;
}

export function jitterDelay(enabled: boolean): number {
  if (!enabled) return 0;
  return 2 + Math.random()*58; // 2-60ms
}
