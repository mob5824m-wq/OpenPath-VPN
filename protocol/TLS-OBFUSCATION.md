# TLS Obfuscation — Inside TLS Tunneling over TCP

> **Goal:** Wrap *all* VPN traffic inside a standard TLS 1.2/1.3 tunnel over TCP so DPI only sees legitimate HTTPS.

## Why TLS over TCP matters in schools
FortiGate, Palo Alto, Lightspeed and Securly all ship with “Block VPN / Proxy” categories. They work by:

- blocking non-standard ports (1194/UDP, 51820/UDP, 1701/TCP…)
- fingerprinting WireGuard/OpenVPN/QUIC handshakes
- blocking SNI of known VPN domains

What they **cannot** block without breaking the entire school is:
- **TCP 443 with legitimate TLS** — Google Classroom, Canvas, YouTube, Cloudflare, Microsoft 365 all require it.
- **WebSocket Upgrade inside TLS** — Slack, Notion, VS Code Web, Figma all use it.

OpenPath exploits this by making the VPN *be* TLS. There is no outer “VPN protocol” to detect — only TLS Application Data.

---

## Architecture

```
App IP packet (tun0)
   │
   ▼
OPSP framing: [magic|type|len|counter] + ChaCha20-Poly1305 + random padding 0-512B
   │
   ▼
TLS 1.3 record layer  ──────────────────────────────────────┐
   │  ClientHello (JA3 = Chrome 124 / Safari 17)            │
   │  SNI = cdn.openpath.yourdomain.com (or Cloudflare)     │
   │  ALPN: h2, http/1.1                                     │
   │  Cipher: TLS_AES_128_GCM_SHA256 / TLS_CHACHA20_POLY1305 │
   │  Cert: Let's Encrypt for your domain (trusted)         │
   └────────────────────────────────────────────────────────┘
   │
   ▼
TCP :443 ──► Cloudflare edge (optional front) ──► Origin VPS
                                │
                                ▼
                          TLS termination → OPSP decap → NAT egress
```

- **Every byte** leaves the device as `ContentType: application_data` inside TLS. No extra UDP, no custom header.
- **No VPN SNI**: the SNI in ClientHello is a normal web domain you control (or `cloudflare-dns.com`, `ajax.googleapis.com` style whitelisted front). Real routing is encrypted inside TLS (`CONNECT` semantics).
- **Domain fronting** (optional): outer SNI = `www.microsoft.com`, inner Host = `cdn.yourdomain.com` via Cloudflare Workers / AWS CloudFront.

---

## TLS details implemented

- **Version**: TLS 1.3 preferred, TLS 1.2 fallback for strict middleboxes.
- **Fingerprint cloning**: headers + cipher-suite order + extensions cloned from real browsers (Chrome 124, Firefox 128, Safari 17 profiles). JA3 / JA4 tool sees `Chrome`, not `Go TLS`.
- **Session resumption**: TLS Session Tickets + 0-RTT disabled for stealth (0-RTT has replay risk and fingerprintable).
- **mTLS not used**: no client cert (anonymous). Auth is inside OPSP HMAC, not TLS.
- **Cert pinning optional**: client can pin Cloudflare Origin cert to defeat school MitM proxy that installs custom CA on managed Chromebooks. On BYOD network the MitM disappears; inside-TLS encryption still protects content even under MitM.
- **Inner encryption still active**: even if school MitM breaks outer TLS, the inner OPSP frame is *still* ChaCha20-Poly1305 encrypted with per-session ECDH key — double encryption.

---

## How we avoid signatures

| Risk | Mitigation |
|------|------------|
| Static ClientHello bytes | Randomize GREASE, extension order per browser profile, timestamp jitter |
| High-entropy burst after handshake | OPSP payload encrypted *and* padded → entropy matches Chrome loading a JS bundle |
| Long-lived single TLS flow | Server sends `Connection: keep-alive` + periodic `HTTP/2 PING` style keepalives; client auto-reconnects with fresh TLS + session ticket rotation every 5-15 min |
| Observable keepalive size | Keepalive padded to 60-140B like normal ACK/WSA keepalive |
| QUIC blocking | Fallback remains TCP TLS; QUIC is opportunistic only |

---

## Verification

```bash
tcpdump -i any port 443 -w cap.pcap
# open in Wireshark:
#   Frame shows: Ethernet → IP → TCP → TLSv1.3 → (Application Data) only
#   JA3 hash: check https://ja3er.com → maps to Chrome124, not “unknown”
#   No WireGuard (148B), no OpenVPN opcode 0x38, no custom port

openssl s_client -connect cdn.yourdomain.com:443 -alpn h2
# → cert trusted, chain Let's Encrypt ISRG Root X1, protocol TLSv1.3, cipher TLS_AES_128_GCM_SHA256
```

The DPI blade on FortiGate logs this as `category: Business/Cloudflare`, not `VPN/Proxy`.

---

## Fallback when TCP 443 is throttled

If the firewall throttles long-lived TLS (e.g., QoS caps at 200 kbps after 60s):

1. Client detects throughput < 50 kbps for 10s
2. Hot-swaps transport: `wss+tls → http/2-stream+tls → doh+tls` in <1s, same SNI
3. Server resumes session via TLS SessionID reuse + OPSP session token

All fallbacks remain inside TLS, so filtering rule still misses them.

---

*Implementation: `server/src/transports/tls_tunnel.ts` and `client/core/src/transports/tls_tunnel.ts` — node:tls wrapper with browser-mimic ClientHello.*
