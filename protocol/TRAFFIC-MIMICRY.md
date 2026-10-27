# Traffic Mimicry — Make VPN Look Like Standard HTTPS Browsing

> **Goal:** Even if the firewall does deep packet inspection, it *chooses not to block* because traffic looks exactly like a normal web user.

## The trick
WireGuard, OpenVPN, Shadowsocks all have tell-tale shapes:
- fixed packet sizes (1420B)
- regular keepalives every 15-25s
- high entropy from first byte
- no HTTP headers, no HTML

OpenPath mimics **real HTTPS browsing** distribution measured from Alexa Top 1000:

- **Sizes**: trimodal — 60B ACKs, ~1200B TLS records (HTML/JSON), ~1460B images. OpenPath pads/trims to this histogram via seeded PRNG (reproducible per session, unpredictable to observer).
- **Timing**: inter-arrival times of human browsing are bursty + think-time gaps. OpenPath injects `jitter = 2–60 ms * (1 + 0.5*sin(counter))` and coalesces 2–5 small OPSP frames into one TLS record like browser pipelining.
- **Headers**: every WebSocket Upgrade carries realistic browser headers (`User-Agent: Chrome124`, `Accept-Language`, `Sec-WebSocket-Extensions: permessage-deflate`, `Origin: https://…`, `Sec-Ch-Ua`). The decoy origin *is* a browsable site, so `Referer` matches.
- **Flow**: after handshake the client immediately fetches `/`, `/styles.css`, `/api/info` like a new tab would — background noise covering first tunnel bytes.
- **ALPN / HTTP version**: `h2` preferred (modern sites), fallback `http/1.1` on inspect-heavy networks. Server sends `h2 SETTINGS` / `PING` frames even when payload is OPSP.

Result: packet capture → Wireshark “Statistics → I/O Graph” looks like Chrome opening Cloudflare-hosted portfolio, Slack polling, YouTube thumbnails pre-loading — not a flat VPN tunnel.

---

## Mimicry levels

OpenPath exposes `stealth.profile`:

| Profile | Mimic target | When to use |
|---------|--------------|-------------|
| `chrome124` (default) | Windows 11 Chrome 124 → Cloudflare | most schools |
| `safari17` | macOS Safari 17 → Apple CDN | iPad-heavy schools |
| `firefox128` | Firefox → `googleapis.com` | Firefox allowed, Chrome blocked |
| `meet` | Google Meet WebRTC → `meet.google.com` | only Meet/Zoom whitelisted |
| `office365` | Microsoft → `outlook.office365.com` | Microsoft tenant schools |

Each profile changes:
- JA3 / JA4 fingerprint (cipher order, curves, extensions)
- `User-Agent` / `Sec-Ch-Ua` / `Accept-Language`
- ALPN (`h2` vs `http/1.1`)
- Keepalive cadence (Meet uses 20s WebRTC pings; Chrome uses 45s HTTP/2 PING)

Switch via dashboard or CLI: `openpath config set stealthProfile safari17`

---

## Cover traffic example (first 8s after connect)

```
0.000s TLS ClientHello  SNI=cdn.openpath… ALPN=h2  (Chrome124 JA3)
0.040s TLS ServerHello
0.090s GET /            → 200 portfolio HTML (15 KB)  — real decoy fetch
0.120s GET /styles.css  → 200 (4 KB)
0.200s GET /api/info    → 200 JSON (0.5 KB) — also real endpoint
0.250s Upgrade: websocket /ops?auth=HMAC  → 101 Switching Protocols
0.260s [OPSP tunnel starts — looks like websocket binary “live updates”]
0.400s TLS keepalive 60B (like TCP ACK)
1.400s TLS 1200B (coalesced 2× OPSP frames + padding → 1188B)
2.800s TLS 1460B (image fetch mimic)
… random thereafter 60B ↔ 1460B, bursty
```

A FortiGate ML classifier trained on “VPN traffic is flat” sees bursty web traffic and scores it **benign**.

---

## Implementation hooks

- `server/src/transports/https_mimic.ts` — returns decoy HTML/CSS/JS for unauthenticated probes; sends realistic `Server: cloudflare` headers.
- `server/src/utils/obfuscation.ts` — `jitterDelay()`, `paddingLenForCounter()`, `shouldCoalesce()`, `fakeHttpHeaders()`, `browserProfiles` list.
- `client/core/src/transports/*` — padding / jitter applied before `ws.send()`.
- `client/web/src/App.tsx` — exposes stealth toggles (jitter on/off, pad on/off, domain front, profile selector) and live log showing what DPI sees.

---

## Testing mimicry

```bash
# collect 30s capture on server or client
sudo tcpdump -i tun0 -w openpath.pcap port 443
# analyze sizes
tshark -r openpath.pcap -T fields -e frame.len | sort -n | uniq -c
# should show trimodal: ~60, ~1200, ~1460, not single peak at 1420

# JA3 check (client → server)
python3 scripts/ja3.py --pcap openpath.pcap
# → should map to Chrome124 on ja3er.com, not “unknown/Go”
```

If school retunes ML, switch profile and re-capture — no DPI signature to update against because distribution is *their* whitelist.

---

*See also TLS-OBFUSCATION.md for outer TLS tunneling that carries the mimicked traffic.*
