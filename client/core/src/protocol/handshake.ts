import { randomBytes, hmacSha256, hkdfSha256, toBase64Url } from '../crypto/aead.js';

export interface HandshakeParams {
  psk: string; // base64url or utf8
  path: string; // e.g. /ops
  serverHost: string;
}

export function buildAuthQuery(psk: string, path='/ops'): string {
  const ts = Date.now().toString();
  const nonce = toBase64Url(randomBytes(12));
  // Need Node-like hmac but browser: use subtle — sync quick hmac via TextEncoder
  // For demo, we construct token client-side via subtle async; caller uses buildAuthQueryAsync
  return `${ts}.${nonce}.PLACEHOLDER`;
}

// Async HMAC for browser
export async function buildAuthTokenAsync(psk: string, path='/ops'): Promise<string> {
  const ts = Date.now().toString();
  const nonce = toBase64Url(randomBytes(12));
  const key = new TextEncoder().encode(psk);
  const data = new TextEncoder().encode(`${ts}.${nonce}.${path}`);
  const macBytes = await hmacSha256(key, data);
  const hex = [...macBytes].map(b=> b.toString(16).padStart(2,'0')).join('');
  return `${ts}.${nonce}.${hex}`;
}

export async function deriveSessionKey(psk: string, clientNonce: Uint8Array, serverNonce: Uint8Array): Promise<Uint8Array> {
  const ikm = new TextEncoder().encode(psk);
  const salt = new Uint8Array([...clientNonce, ...serverNonce]);
  return hkdfSha256(ikm, salt, 'openpath-v1', 32);
}
