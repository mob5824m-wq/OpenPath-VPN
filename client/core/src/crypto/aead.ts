// Browser + Node compatible AEAD using Web Crypto (AES-GCM) and pure JS ChaCha20 fallback
// For demo we use Web Crypto AES-GCM which is hardware-accelerated everywhere

export async function aesGcmEncrypt(key: CryptoKey, iv: Uint8Array, plaintext: Uint8Array, aad?: Uint8Array): Promise<Uint8Array> {
  const algo: any = { name: 'AES-GCM', iv, tagLength: 128 };
  if (aad) algo.additionalData = aad;
  const ct = await crypto.subtle.encrypt(algo, key, plaintext);
  return new Uint8Array(ct);
}
export async function aesGcmDecrypt(key: CryptoKey, iv: Uint8Array, ciphertext: Uint8Array, aad?: Uint8Array): Promise<Uint8Array> {
  const algo: any = { name: 'AES-GCM', iv, tagLength: 128 };
  if (aad) algo.additionalData = aad;
  const pt = await crypto.subtle.decrypt(algo, key, ciphertext);
  return new Uint8Array(pt);
}
export async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw as any, { name: 'AES-GCM' }, false, ['encrypt','decrypt']);
}
export function randomBytes(n: number): Uint8Array {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return a;
}
export async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const ck = await crypto.subtle.importKey('raw', key as any, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', ck, data as any);
  return new Uint8Array(sig);
}
export async function hkdfSha256(ikm: Uint8Array, salt: Uint8Array, info: string, len=32): Promise<Uint8Array> {
  // Simplified HKDF
  const prk = await hmacSha256(salt, ikm);
  const infoBytes = new TextEncoder().encode(info);
  const data = new Uint8Array(infoBytes.length + 1);
  data.set(infoBytes); data[infoBytes.length]=0x01;
  const okm = await hmacSha256(prk, data);
  return okm.slice(0,len);
}
export function toBase64Url(bytes: Uint8Array): string {
  let s=''; bytes.forEach(b=> s+=String.fromCharCode(b));
  return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
export function fromBase64Url(s: string): Uint8Array {
  s=s.replace(/-/g,'+').replace(/_/g,'/');
  while(s.length%4) s+='='; const bin=atob(s); const a=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) a[i]=bin.charCodeAt(i); return a;
}
