export const FrameType = { DATA:0x01, KEEPALIVE:0x02, REKEY:0x03, CLOSE:0x04 } as const;

// Simple framing for demo (same as server AES-GCM framing) — handled with WebCrypto in client

// Padding distribution helper
export function paddingLenForCounter(counter: number): number {
  const r = Math.random();
  if (r < 0.55) return Math.floor(Math.random()*48);
  if (r < 0.88) return 60 + Math.floor(Math.random()*140);
  return 200 + Math.floor(Math.random()*200);
}
