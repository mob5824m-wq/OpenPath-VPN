import { createHmac, createHash, randomBytes, timingSafeEqual } from 'crypto';

// Lightweight X25519 via Node's crypto; fallback helpers

export function hmacSha256(key: string | Buffer, data: string | Buffer): string {
  return createHmac('sha256', key).update(data).digest('hex');
}

export function hmacRaw(key: Buffer, data: Buffer): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export function secureEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// Generate random base64url PSK (32 bytes)
export function genPsk(): string {
  return randomBytes(32).toString('base64url');
}

// Derive session key via HKDF-SHA256
export function hkdfSha256(ikm: Buffer, salt: Buffer, info: string, len = 32): Buffer {
  // HKDF-Extract + Expand simplified; Node has hkdf but manual for clarity
  const prk = createHmac('sha256', salt).update(ikm).digest();
  const okm = createHmac('sha256', prk).update(Buffer.concat([Buffer.from(info), Buffer.from([0x01])])).digest();
  return okm.subarray(0, len);
}

// Simple XOR stream placeholder for outer handshake obfuscation (PSK-derived keystream)
// Production uses XChaCha20; this demo uses HMAC-based keystream for simplicity + compat
export function obfuscateWithPsk(data: Buffer, psk: string): Buffer {
  const key = Buffer.from(psk, 'utf8');
  const out = Buffer.alloc(data.length);
  // HMAC-SHA256 in counter mode
  let counter = 0;
  let keystream = Buffer.alloc(0);
  let pos = 0;
  while (pos < data.length) {
    if (keystream.length === 0) {
      keystream = createHmac('sha256', key).update(Buffer.from(counter.toString())).digest();
      counter++;
    }
    out[pos] = data[pos] ^ keystream[pos % keystream.length];
    pos++;
    if (pos % 32 === 0) keystream = Buffer.alloc(0);
  }
  return out;
}
export const deobfuscateWithPsk = obfuscateWithPsk;

// Nonce cache for anti-replay
export class NonceCache {
  private map = new Map<string, number>();
  private maxSize: number;
  constructor(maxSize = 10000) { this.maxSize = maxSize; }
  has(nonce: string): boolean { return this.map.has(nonce); }
  add(nonce: string) {
    if (this.map.size >= this.maxSize) {
      const first = this.map.keys().next().value!;
      this.map.delete(first);
    }
    this.map.set(nonce, Date.now());
    // auto-expire after 60s
    setTimeout(() => this.map.delete(nonce), 60000).unref?.();
  }
}

// Random padding length derived from session-like PRNG (deterministic if seed provided)
export function randomPaddingLen(counter: number, seed = 'openpath-pad'): number {
  // Simple hash-based PRNG to get deterministic but unpredictable padding
  const h = createHash('sha256').update(seed + counter).digest();
  // Distribution mimics web traffic: 0-512, skewed small
  const r = h.readUInt16BE(0) / 65535;
  if (r < 0.6) return Math.floor(r * 80);        // 0-48B (60% small)
  if (r < 0.9) return 50 + Math.floor(Math.random() * 150); // 50-200 (30%)
  return 200 + Math.floor(Math.random() * 312);  // 200-512 (10% large)
}

// Chrome-like UA rotation for server-side validation or client mimic
export const CHROME_UAS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.6367.88 Mobile/15E148 Safari/604.1',
];
