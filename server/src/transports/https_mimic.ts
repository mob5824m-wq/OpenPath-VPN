/**
 * HTTPS Traffic Mimicry — make VPN handshake and data frames indistinguishable
 * from everyday HTTPS browsing so DPI classifies as benign.
 *
 * Server side: serves decoy website for unauthenticated probes,
 * sends realistic Server headers, and provides cover endpoints (/ , /styles.css, /api/info etc.)
 * that a real browser would fetch before upgrading to websocket.
 *
 * Also injects padding + timing jitter guidance; the real shaping happens client side,
 * but server validates that frames arrive with plausible web-like sizes.
 */

export const mimicEndpoints = [
  { path: '/', mime: 'text/html', note: 'decoy portfolio - real HTML, 200 OK' },
  { path: '/styles.css', mime: 'text/css', note: 'decoy stylesheet' },
  { path: '/app.js', mime: 'application/javascript', note: 'decoy bundle' },
  { path: '/api/info', mime: 'application/json', note: 'server hello JSON - also real' },
  { path: '/health', mime: 'application/json', note: 'health check - used by client pre-check' },
  { path: '/favicon.ico', mime: 'image/x-icon', note: 'cover request' },
];

export function serverHeaders() {
  return {
    'Server': 'cloudflare', // FortiGate whitelists known CDN server strings
    'CF-RAY': `${Math.random().toString(36).slice(2,8)}-${'YUL'}`,
    'Cache-Control': 'public, max-age=300',
    'Content-Type': 'text/html; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    // Cloudflare-style:
    'CF-Cache-Status': 'HIT',
    'Via': '1.1 google',
  };
}

export function clientMimicHeaders(origin = 'https://cdn.openpath.example.com') {
  // Browser-like headers for WS upgrade + H2 fetches
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Origin': origin,
    'Referer': `${origin}/`,
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Upgrade-Insecure-Requests': '1',
  };
}

/**
 * Validate that incoming frame sizes plausibly mimic web traffic (trimodal peaks ~60, 1200, 1460).
 * Strict DPI might flag flat 1420B stream as VPN; we warn if pattern is too uniform.
 */
export function isSuspiciouslyUniform(frameSizes: number[]): boolean {
  if (frameSizes.length < 20) return false;
  const around = (n:number, target:number, tol=40) => Math.abs(n-target) < tol;
  // Count how many are 1400-1440 (WireGuard / OpenVPN default)
  const vpnPeak = frameSizes.filter(n=> n>=1400 && n<=1440).length;
  if (vpnPeak / frameSizes.length > 0.6) return true; // 60%+ in VPN band = suspicious
  // If no small ACK-like frames, suspicious
  const small = frameSizes.filter(n=> n<100).length;
  if (small < frameSizes.length * 0.15) return true;
  return false;
}
