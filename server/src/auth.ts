import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { config } from './config.js';

// Validates HMAC auth token: HMAC-SHA256(psk, `${timestamp}.${nonce}.${path}`)
// Token format: ?auth=timestamp.nonce.hmacHex&user=demo

export interface AuthResult { ok: boolean; user?: string; reason?: string }

const nonceCache = new Map<string, number>();
const badAttemptMap = new Map<string, { count: number; firstAt: number; tarpUntil?: number }>();

function cleanupBad() {
  const now = Date.now();
  for (const [k,v] of badAttemptMap) if (now - v.firstAt > 60000 && (!v.tarpUntil || now > v.tarpUntil)) badAttemptMap.delete(k);
  for (const [k,exp] of nonceCache) if (now > exp) nonceCache.delete(k);
}
setInterval(cleanupBad, 30000).unref?.();

export function validateAuth(url: URL, ip: string, exactPath = false): AuthResult {
  const now = Date.now();

  // tarpit check
  const bad = badAttemptMap.get(ip);
  if (bad?.tarpUntil && now < bad.tarpUntil) return { ok: false, reason: 'rate-limited' };

  const auth = url.searchParams.get('auth');
  const user = url.searchParams.get('user') || 'demo';
  const psk = config.psks[user];
  if (!psk) return { ok: false, reason: 'unknown-user' };
  if (!auth) return { ok: false, reason: 'missing-auth' };

  // auth format: ts.nonce.hmac
  const parts = auth.split('.');
  if (parts.length !== 3) return recordBad(ip, 'malformed');

  const [tsStr, nonce, clientHmac] = parts;
  const ts = parseInt(tsStr, 10);
  if (isNaN(ts) || Math.abs(now - ts) > config.antiReplay.windowMs) return recordBad(ip, 'expired-ts');

  if (nonceCache.has(nonce)) return recordBad(ip, 'replay');
  if (nonce.length < 8) return recordBad(ip, 'bad-nonce');

  // Expected HMAC: HMAC-SHA256(psk, `${ts}.${nonce}.${path}`) — accept either opsPath or fastPath (+ plain /ops fallback)
  const pathsToTry = exactPath ? [url.pathname] : [config.opsPath, config.fastPath, '/ops'];
  let ok = false;
  for (const p of pathsToTry) {
    const expected = createHmac('sha256', psk).update(`${ts}.${nonce}.${p}`).digest('hex');
    try {
      const a = Buffer.from(clientHmac, 'hex');
      const b = Buffer.from(expected, 'hex');
      if (a.length === b.length && timingSafeEqual(a,b)) { ok = true; break; }
    } catch {}
  }

  if (!ok) return recordBad(ip, 'bad-hmac');

  // success — cache nonce
  if (nonceCache.size > config.antiReplay.cacheSize) {
    const first = nonceCache.keys().next().value as string; nonceCache.delete(first);
  }
  nonceCache.set(nonce, now + 60000);
  // reset bad attempts on success
  badAttemptMap.delete(ip);
  return { ok: true, user };
}

function recordBad(ip: string, reason: string): AuthResult {
  const now = Date.now();
  let entry = badAttemptMap.get(ip);
  if (!entry) entry = { count: 0, firstAt: now };
  entry.count++;
  if (entry.count >= config.rateLimit.maxBadAuthPerIpPerMin) {
    entry.tarpUntil = now + config.rateLimit.tarpitMs;
  }
  badAttemptMap.set(ip, entry);
  return { ok: false, reason };
}

export function buildAuthToken(psk: string, path = config.opsPath): string {
  const ts = Date.now().toString();
  const nonce = randomBytes(12).toString('hex');
  const h = createHmac('sha256', psk).update(`${ts}.${nonce}.${path}`).digest('hex');
  return `${ts}.${nonce}.${h}`;
}
