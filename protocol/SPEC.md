# OpenPath Stealth Protocol (OPSP) — v1.0

> **Codename: GhostPath** — A fully obfuscated, DPI-resistant VPN protocol designed to look like normal HTTPS web traffic.

---

## 1. Design Goals

- **Indistinguishable from regular browsing:** No DPI signature, no fixed ports, no static handshake patterns.
- **Single port:** Only TCP 443 (HTTPS) / UDP 443 (QUIC fallback).
- **Censorship-resistant:** Domain fronting, decoy webserver, pluggable transports.
- **Cross-platform:** Single core (TypeScript/Go) compiled to every OS.
- **Plausible deniability:** Probes without secrets see a benign personal website.

## 2. Threat Model

| Adversary Capability | Countermeasure |
|---|---|
| Port blocking (1194, 51820, 500, 4500, 1723) | Only 443/TCP + 443/UDP allowed; 53 fallback via DoH inside 443 |
| DPI — packet inspection | TLS camouflage (uTLS JA3 cloned from Chrome), padding, timing jitter |
| SNI filtering | SNI = benign CDN domain; real routing inside encrypted tunnel |
| IP blocklist | Cloudflare / AWS CloudFront domain fronting; rotating origin |
| Active probing | Decoy HTTP server returns 200 portfolio site unless HMAC path valid |
| DNS poisoning/block | DNS over HTTPS (Cloudflare 1.1.1.1) embedded in tunnel |
| Traffic analysis (timing/size) | Random padding 0-512B, jitter 2-60ms, HTTP/2 multiplex mimic |
| QUIC/WebSocket blocking | Automatic downgrade chain: WS→H2 stream→DoH→WebRTC→DNS |

## 3. Handshake (Obfuscated ECDH)

```
Client                                         Server
  |  ------ ClientHello (obfuscated) ---------> |
  |        * 32B random nonce                   |
  |        * X25519 ephemeral pubkey (32B)      |
  |        * timestamp (8B) + padding 16-128B   |
  |        * HMAC-SHA256 over payload with PSK   |
  |        * all encrypted with ChaCha20 using  |
  |          pre-shared key-derived keystream    |
  |                                            |
  |  <------ ServerHello (obfuscated) -------- |
  |        * Server X25519 pubkey              |
  |        * timestamp + padding               |
  |        * HMAC with PSK                     |
  |
  |  === ECDH shared secret: X25519(priv,pub) |
  |  === Session key: HKDF-SHA256(shared,     |
  |       "openpath-v1" + clientNonce+serverNonce)
  |
  |  ------ TunnelReady (AES) ---------------> |
  |        * sessionId + cipher negotiation    |
  |  <------ TunnelReadyAck ----------------  |
```

- No cleartext version bytes, no constant header.
- Each handshake is random bytes; entropy matches HTTPS.
- Replay protected by 30s timestamp window + nonce cache.
- PSK is per-user provisioning token (base64url 32B). Server can also allow open registration with CAPTCHA → issues PSK.
- After ECDH, all further traffic is ChaCha20-Poly1305 (for speed on mobile without AES hardware) + optional AES-GCM fallback.

## 4. Data Framing

After handshake, bidirectional stream of frames:

```
[ 2B Magic (random per session, negotiated) ]
[ 1B Type: 0x01 DATA, 0x02 KEEPALIVE, 0x03 REKEY, 0x04 CLOSE ]
[ 2B Length (encrypted length + 16 tag) ]
[ 4B Frame counter (anti-replay) ]
[ Variable: Encrypted Payload (ChaCha20-Poly1305) ]
[ Random Padding 0-512B ]
```

- Magic is derived from session key → no static magic.
- Length is encrypted → observer can't tell packet size distribution.
- Padding length derived from PRNG seeded with session key + counter → unpredictable but reproducible for validation.
- Keepalive mimics HTTP/2 PING: sent every 15-45s randomized.

### Data Payload Types
- `0x10 TUN_IPv4` — raw IP packet (tun2socks)
- `0x11 TUN_IPv6`
- `0x12 SOCKS5_UDP_ASSOCIATE`
- `0x13 DNS_QUERY` (embedded DoH)
- `0x14 HTTP_CONNECT` (proxy fallback)

## 5. Transport Layers (Pluggable)

Priority order (auto failover within 2s):

1. **WebSocket over TLS (wss://)** — Primary. Path `/api/v3/live?token=...` looks like web app live updates. WS frames already provide framing; OPSP frames nested inside binary WS frames. Headers include realistic: `Origin: https://cdn.example.com`, `User-Agent: Mozilla/5.0 ... Chrome/124`.
2. **HTTP/2 Streaming** — POST `https://cdn.example.com/api/upload` with chunked `application/octet-stream`, server replies chunked. Looks like file upload/download.
3. **DNS-over-HTTPS tunneling** — Encodes OPSP frames as base64url inside DoH JSON queries to `https://cloudflare-dns.com/dns-query?name=<data>.openpath.example.com`. Bandwidth ~40kbps but unblockable where DoH allowed.
4. **QUIC (UDP/443)** — Direct QUIC stream if TCP throttled but UDP open.
5. **WebRTC DataChannel** — Establishes fake WebRTC video call; data inside `a=...` SDP. Useful when only UDP WebRTC is whitelisted (e.g., Google Meet allowed).

Each transport exposes same `send(bytes): void` and `onMessage(bytes)` interface.

## 6. Obfuscation Layer

- **TLS Fingerprint Cloning**: Server uses standard Node `tls` with sessionTickets+ALPN h2; client uses `user-agents` rotation matching real browsers (JA3 strings curated list). No custom cipher suites.
- **Header Camouflage**: Every WebSocket upgrade includes: `Accept-Language`, `Sec-WebSocket-Extensions: permessage-deflate`, `Sec-Ch-Ua`, etc.
- **Packet Morphing**:
  - Size: Pad to distribution matching Alexa Top 1000 web browsing (peaks at ~1200, 1360, 1460).
  - Timing: Adds `jitter = random(2,60) * (1 + sin(counter))` ms delay; burst-coalesce small packets.
- **Decoy Website**: `GET /` without valid HMAC returns fully rendered React portfolio site (fake blog) with valid HTTPS cert. Only `GET /ops?auth=<HMAC>` triggers upgrade. Scanner sees normal site.

## 7. Crypto Choices

- **Key Exchange**: X25519 (libsodium/curve25519). Fast on mobile, no side-channels.
- **AEAD**: XChaCha20-Poly1305 (24B nonce). Mobile + IoT friendly, constant-time JS.
- **KDF**: HKDF-SHA256, info = `openpath-v1|<clientNonce>|<serverNonce>`.
- **Auth**: HMAC-SHA256 for handshake, Poly1305 for AEAD.
- **PFS**: New ECDH per session, keys wiped after disconnect.
- **PSK Provisioning**: QR code / `openpath://` URI contains `server#wss://host:443/path?psk=...` — share via AirDrop.

## 8. Anti-Probe & Anti-Replay

- Invalid handshake → server waits random 200-800ms then closes, logs IP but doesn't reveal protocol.
- Nonce cache (LRU 10k entries, 60s TTL) prevents replay.
- Timestamp drift >30s rejected (client NTP sync hinted).
- Fail2ban: 5 bad attempts ⇒ tarpits for 5 min.

## 9. Flow Example (Full Connect)

```
1. Client resolves `cdn.openpath.example.com` → Cloudflare IP (or direct VPS IP if fronting disabled)
2. Client opens TLS to :443, SNI=cdn.openpath.example.com, JA3=Chrome124
3. Client sends GET /ops?auth=HMAC(...) Upgrade: websocket (+ decoy headers)
4. Server validates HMAC (constant-time), replies 101 Switching Protocols, sends ServerHello
5. ECDH → session key, tunnel established
6. Client enables TUN interface (or SOCKS5 on 127.0.0.1:1080 if no root)
7. All device traffic → TUN → OPSP frames → WebSocket → TLS → Internet → Server → egress to target
8. Response path reverse.
```

## 10. Performance

- Overhead: ~4% (16B tag + 2-8B headers + avg 32B padding) vs WireGuard 4% similar.
- Throughput: JS ChaCha20 ~300Mbps on M1, ~150Mbps on mid Android; native (Go/Rust) >1Gbps.
- Latency: +3ms vs direct (WS framing), +8ms with jitter enabled.
- Battery: Adaptive keepalive backoff when screen off.

## 11. Security Properties

- Confidentiality, integrity, authenticity per frame (AEAD).
- Forward secrecy (ephemeral ECDH).
- DoS resistance (proof-of-work optional under load).
- No identity leakage (SNI is fronted domain, no client cert).

---

*Spec authors: OpenPath Team — licensed MIT — contributions welcome.*
