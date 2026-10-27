// Traffic morphing helpers — size & timing obfuscation to mimic browsing
export function jitterDelay(baseMs = 10): number {
  const jitter = 2 + Math.random() * 58; // 2-60ms
  const wave = Math.sin(Date.now() / 1000) * 5;
  return Math.max(0, baseMs + jitter + wave);
}

export function shouldCoalesce(queueLen: number): boolean {
  // Coalesce 2-5 small frames into one TLS record like browser pipelining
  if (queueLen < 2) return false;
  return Math.random() < 0.35;
}

export function fakeHttpHeaders(): Record<string,string> {
  return {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Accept-Encoding': 'gzip, deflate, br',
    'Sec-Fetch-Dest': 'websocket',
    'Sec-Fetch-Mode': 'websocket',
    'Sec-Fetch-Site': 'same-origin',
    'Pragma': 'no-cache',
    'Cache-Control': 'no-cache',
    'Origin': 'https://cdn.openpath.example.com',
  };
}
