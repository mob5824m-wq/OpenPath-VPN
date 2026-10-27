import type { WebSocket } from 'ws';
import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';

// Session management for OPSP

export interface Session {
  id: string;
  user: string;
  ws: WebSocket;
  createdAt: number;
  lastSeen: number;
  rxBytes: number;
  txBytes: number;
  // Simplified session key (real: HKDF from ECDH)
  sessionKey: Buffer;
  frameCounter: number;
}

export const sessions = new Map<string, Session>();

export function createSession(ws: WebSocket, user: string): Session {
  const id = randomBytes(8).toString('hex');
  const sessionKey = randomBytes(32); // in real handshake derived via ECDH HKDF
  const s: Session = { id, user, ws, createdAt: Date.now(), lastSeen: Date.now(), rxBytes:0, txBytes:0, sessionKey, frameCounter:0 };
  sessions.set(id, s);
  return s;
}

export function removeSession(id: string) { sessions.delete(id); }

// Frame format (simplified): [type:1][counter:4][len:2][payload][tag:16][pad:?]
// We use AES-256-GCM for demo (ChaCha20-Poly1305 in production js core)

export function encryptFrame(session: Session, plaintext: Buffer, type = 0x01): Buffer {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', session.sessionKey, nonce);
  const counterBuf = Buffer.alloc(4); counterBuf.writeUInt32BE(session.frameCounter++);
  const header = Buffer.concat([Buffer.from([type]), counterBuf]);
  cipher.setAAD(header);
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const len = Buffer.alloc(2); len.writeUInt16BE(enc.length);
  // header + len + nonce(12) + enc + tag
  const frame = Buffer.concat([header, len, nonce, enc, tag]);
  // add random padding 0-64 for demo
  const padLen = Math.floor(Math.random()*64);
  const pad = padLen? randomBytes(padLen): Buffer.alloc(0);
  const padLenBuf = Buffer.alloc(1); padLenBuf.writeUInt8(padLen);
  return Buffer.concat([frame, padLenBuf, pad]);
}

export function decryptFrame(session: Session, data: Buffer): { type: number; plaintext: Buffer } | null {
  try {
    if (data.length < 1+4+2+12+16+1) return null;
    const type = data[0];
    const counter = data.readUInt32BE(1);
    void counter;
    const len = data.readUInt16BE(5);
    const nonce = data.subarray(7, 19);
    const enc = data.subarray(19, 19+len);
    const tag = data.subarray(19+len, 19+len+16);
    const decipher = createDecipheriv('aes-256-gcm', session.sessionKey, nonce);
    decipher.setAuthTag(tag);
    const header = data.subarray(0,5);
    decipher.setAAD(header);
    const pt = Buffer.concat([decipher.update(enc), decipher.final()]);
    return { type, plaintext: pt };
  } catch { return null; }
}

// Fast mode: plain JSON without crypto overhead (for home use, max speed)
// We still verify HMAC auth on upgrade, but no per-frame AES
export function fastEncode(obj: any): Buffer {
  return Buffer.from(JSON.stringify(obj));
}
export function fastDecode(buf: Buffer): any | null {
  try { return JSON.parse(buf.toString('utf8')); } catch { return null; }
}

// Opcode for data channel
export const FrameType = { DATA: 0x01, KEEPALIVE: 0x02, REKEY: 0x03, CLOSE: 0x04 };
