# OpenPath VPN — GhostPath Stealth Protocol

> **“If they can’t tell it’s a VPN, they can’t block it.”**

Cross-platform VPN that **wraps all traffic inside TLS over TCP :443** with **HTTPS traffic mimicry** so it looks like standard web browsing. Even if your school enables “Block VPNs” on **Fortinet FortiGate** / Palo Alto / Lightspeed, OpenPath stays up — because it *is* HTTPS.

> **Fortinet school?** → See [`docs/FORTINET.md`](docs/FORTINET.md) — FortiGuard *Business/CDN* (not Proxy Avoidance), App Control bypass, SSL Deep Inspection double-encryption, explicit proxy `CONNECT`, and `openpath connect --fortinet` one-liner. Test with `scripts/test-fortinet.sh`.

![Platforms](https://img.shields.io/badge/platforms-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Android%20%7C%20iOS%20%7C%20Chromebook-blue)
![TLS](https://img.shields.io/badge/TLS-obfuscation%20inside%20TCP%3A443-0ea5e9)
![Mimic](https://img.shields.io/badge/mimic-HTTPS%20browsing%20%2B%20decoy-6366f1)
![Protocol](https://img.shields.io/badge/protocol-OPSP%20v1%20GhostPath-purple)
![License](https://img.shields.io/badge/license-MIT-green)

---

## 🔒 Stealth layers (new)

### TLS Obfuscation — inside TLS tunneling over TCP
All bytes leave the device as `TLSv1.3 Application Data` on **TCP 443**:
- Real TLS 1.3 with SNI `cdn.yourdomain.com` (your Cloudflare domain), ALPN `h2`, cert Let's Encrypt — DPI sees `Business/Cloudflare`, not `VPN/Proxy`.
- JA3 / JA4 fingerprint cloned from **Chrome 124 / Safari 17 / Firefox 128** — FortiGate maps to *browser*, not Go/Node TLS.
- Domain fronting optional (SNI= `www.microsoft.com`, inner Host= your domain).
- Inner OPSP still ChaCha20-Poly1305 — double-encrypted even under school MitM CA.

Read: [`protocol/TLS-OBFUSCATION.md`](protocol/TLS-OBFUSCATION.md)

### Traffic Mimicry — HTTPS browsing illusion
Makes the tunnel *choose not to be blocked*:
- Packet sizes follow **web histogram** (60B ACKs / ~1200B HTML / 1460B images) via seeded PRNG — no flat 1420B VPN peak.
- Timing **jitter 2-60 ms** + burst coalescing like browser pipelining.
- Real browser headers (`User-Agent`, `Origin`, `Sec-Fetch-Dest`, `Accept-Language`) on upgrade + cover fetches (`GET /`, `/styles.css`).
- **Decoy site** on `/` — unauth `curl` → 200 portfolio HTML (Shodan/Censys = “personal site”).
- Profiles: `chrome124` (default) / `safari17` / `firefox128` / `meet`.

Read: [`protocol/TRAFFIC-MIMICRY.md`](protocol/TRAFFIC-MIMICRY.md)

---

## Why schools can't block it

| School Tries | OpenPath Does |
|---|---|
| Block VPN ports (1194, 51820, 500…) | **Only 443/TCP** (same as Classroom/YouTube) — inside TLS |
| DPI on WireGuard/OpenVPN handshake | Handshake **PSK-encrypted + random-padded** — looks like TLS payload |
| SNI filter on `*.vpn.com` | SNI = **`cdn.yourdomain.com` on Cloudflare** — whitelisted |
| IP blocklist of Nord/Express | **Your $4/mo VPS** — IP never on VPN lists; Cloudflare front |
| Active probe without auth | Decoy **portfolio 200 OK** + 200-800ms tarpit |
| DNS poison | **DoH to 1.1.1.1 over 443** — zero school DNS |
| ML on sizes/timing | **Web histogram + jitter** — classifier scores benign |

**Demo:** `curl https://cdn.yours.com/` → portfolio. Only `GET /ops?auth=HMAC` → 101 WebSocket. Wireshark shows `TLSv1.3 + WebSocket` only — like Slack/Notion.

Full breakdown: [`docs/BYPASS_TECHNIQUES.md`](docs/BYPASS_TECHNIQUES.md) • Spec: [`protocol/SPEC.md`](protocol/SPEC.md)

---

## Live Demo (this repo)

### ▶ Preview dashboard (PWA + GUI)

```bash
# 1. Server (decoy + TLS-terminated stealth VPN on 4433)
cd server && npm install && npm run dev   # or docker compose up

# 2. Web client (also serves as Linux/Windows/macOS preview)
cd client/web && npm install && npm run dev
# → http://localhost:5173  (preview host 5173-xxx.e2b.app in Arena)
```

In preview: **Connect Stealth Tunnel** → live logs show `TLS 1.3 SNI=… ALPN=h2 → decoy fetch → Upgrade: websocket → tunnel UP` → **Fetch via VPN** to prove egress.

### Quick connect (any machine)

```
Server:  wss://cdn.openpath.example.com/ops
User:    demo
PSK:     demo-student-key-do-not-use-prod   (change in prod!)
URI:     openpath://cdn.example.com:443/ops?psk=...&user=demo#demo
```

`POST /api/provision` → PSK + QR for AirDrop.

---

## All Platforms — native apps + installers (GUI & CLI)

Same stealth core (`client/core` TS) with platform TUN:

| OS | Native Tech | GUI | CLI | Installer |
|---|---|---|---|---|
| **Linux** ✅ new | Electron + `ip tuntap` kernel TUN (`tun0 10.89.0.2/24`) / SOCKS fallback; GNOME proxy; tray + autostart | `openpath-gui` | `openpath connect/status/disconnect/config` | **.deb / .rpm / .AppImage** (`client/linux/README.md`) |
| **Windows 10/11** | Electron + **WinTun** (`wintun.dll`) + WinIP | `OpenPath.exe` | `openpath.exe connect …` | **Setup.exe (NSIS)** / `winget install OpenPath.VPN` |
| **macOS 12+** (Intel+M1) | Swift **NetworkExtension** `PacketTunnelProvider` + `utun` | `OpenPath.app` | `openpath` symlink | **DMG universal** / `brew cask` |
| **Android 8+** | Kotlin **VpnService** + Gomobile AAR | APK GUI | Termux `openpath` | **APK** / Play Store |
| **iOS 15+** | Swift **NetworkExtension** | App + Shortcuts | — | **IPA** / TestFlight / App Store |
| **Chromebook** | PWA + Chrome Extension (`chrome.proxy`) | Web tab | — | No install needed |

Even on locked-down Chromebooks where MDM blocks apps, the **PWA works** — it's a website fetch inside TLS.

Per-OS build instructions in `client/<platform>/README.md` (each now documents GUI + CLI + installer).

### Linux — 1-line install

```bash
curl -fsSL https://raw.githubusercontent.com/mob5824m-wq/OpenPath-VPN/main/client/linux/installers/install.sh | bash
openpath config set psk YOUR_PSK
# Fortinet school (FortiGate App Control + FortiGuard Web Filter) — use --fortinet:
openpath connect --fortinet --server wss://cdn.yourdomain.com/ops --psk XXX
# generic
openpath connect --server wss://cdn.yourdomain.com/ops --profile chrome124
openpath status
openpath-gui   # GUI with tray, autostart toggle, live TLS log (pick Fortinet profile)
```

From source:
```bash
cd client/linux/cli && npm install && npm run build && sudo npm link  # CLI
cd client/linux && npm install && npm run pack:appimage                # GUI → OpenPath-*.AppImage
```

**TUN on Linux**: `sudo openpath connect` → kernel TUN captures all traffic; without sudo → SOCKS fallback `127.0.0.1:1080` (auto GNOME proxy).

---

## CLI — all platforms (works over SSH)

All native apps expose the same CLI:

```bash
openpath connect --server wss://cdn.example.com/ops --psk <PSK> [--user demo] [--profile safari17|fortinet] [--fortinet] [--sni ajax.googleapis.com] [--pin]
openpath connect --fortinet --server wss://cdn.yourdomain.com/ops --psk XXX  # FortiGate school shortcut
openpath status                   # TLS fingerprint (JA3), TUN mode, RTT, RX/TX, FortiGate CA warning
openpath disconnect
openpath config get|set|path      # ~/.config/openpath/config.json (600)
```

Universal `client/cli` delegates to `client/linux/cli` — build once, run everywhere.

## GUI — all platforms

- Server/PSK/User fields, profile selector, jitter/padding/domain-front toggles
- Live log: `TLS 1.3 SNI=… → decoy → Upgrade: websocket → padding+jitter → TUN UP`
- Stats: RX/TX, RTT, uptime, TUN mode, decoy status
- Tray + autostart (Linux `.desktop` in `~/.config/autostart`, macOS Login Item, Windows Startup)
- System theme aware, native installers (deb/rpm/AppImage/NSIS/DMG/APK/IPA).

---

## Pluggable Transports (auto-failover inside TLS)

Client races transports; first handshake wins. QoS throttle → hot-swap <1s (same TLS SNI).

| Transport | Mimics | Port | Note |
|---|---|---|---|
| **WebSocket over TLS** (primary) | Slack/Notion live | 443 TCP | Full |
| HTTP/2 streaming | Drive upload `POST /api/upload` | 443 TCP | Full |
| DNS-over-HTTPS | Firefox DoH to `cloudflare-dns.com` | 443 | ~40 kbps |
| QUIC | YouTube HTTP/3 | 443 UDP | Full (opportunistic) |
| WebRTC DataChannel | Meet video call | UDP | Full |

All remain inside TLS if available — same SNI, same cert.

---

## Deploy your own server (5 min, custom domain = not on blocklists)

**DuckDNS (free, home server / Raspberry Pi — no static IP needed):**
```bash
# 1. Create free domain at https://www.duckdns.org → e.g. openpath42.duckdns.org
cp .env.duckdns.example .env  # set DUCKDNS_DOMAIN + DUCKDNS_TOKEN + PSK
docker compose -f docker-compose.duckdns.yml up -d --build  # Caddy auto-issues Let's Encrypt for *.duckdns.org
curl -I https://openpath42.duckdns.org/health   # → 200
sudo ./scripts/install-duckdns-cron.sh           # auto-refresh IP every 5 min
```
Full guide: [`docs/DUCKDNS.md`](docs/DUCKDNS.md) — port forwarding (80/443), DNS-01 if ISP blocks 80, GitHub Action to auto-refresh IP (`DUCKDNS_TOKEN` secret + `duckdns.yml` workflow).

**VPS ($4/mo):**
```bash
git clone https://github.com/mob5824m-wq/OpenPath-VPN
cd OpenPath-VPN
docker compose up -d   # 4433 → add Let's Encrypt or Cloudflare Tunnel
# Point cdn.openpath.yourdomain.com → VPS IP (Cloudflare proxy ON)
docker exec openpath-server npm run gen-psk  # → openpath:// URI + QR
```

**No public IP (Cloudflare Tunnel):**
```bash
cloudflared tunnel create openpath && cloudflared tunnel route dns openpath cdn.yourdomain.com
docker compose -f docker-compose.tunnel.yml up -d
```

Fronting: firewall sees Cloudflare `1.1.1.x`, not VPS. Rotate origin if IP ever flagged. Decoy `GET /` → portfolio; only `GET /ops?auth=HMAC` → VPN.

## Crypto (auditable)

- **KEX:** X25519 ephemeral → HKDF-SHA256(`openpath-v1` || nonces) → session key
- **AEAD:** XChaCha20-Poly1305 / AES-256-GCM, PFS, wiped on disconnect
- **Auth:** HMAC-SHA256(PSK, `timestamp.nonce.path`) constant-time, replay cache 10k/60s, 5 fails → 5-min tarpit
- **Obfuscation:** per-session magic, encrypted len, 0-512B web-histogram pad, jitter 2-60ms, keepalive 15-45s random, JA3=Chrome124, ALPN `h2`.

See [`protocol/SPEC.md`](protocol/SPEC.md) • [`protocol/TLS-OBFUSCATION.md`](protocol/TLS-OBFUSCATION.md) • [`protocol/TRAFFIC-MIMICRY.md`](protocol/TRAFFIC-MIMICRY.md)

---

## Project Layout

```
OpenPath-VPN/
├── protocol/SPEC.md, TLS-OBFUSCATION.md, TRAFFIC-MIMICRY.md
├── docs/BYPASS_TECHNIQUES.md, ARCHITECTURE.md
├── server/                   # Node.js stealth server + decoy + proxy
│   ├── src/transports/tls_tunnel.ts, https_mimic.ts, websocket.ts
│   └── src/utils/crypto.ts, obfuscation.ts
├── client/
│   ├── core/                 # TS shared (HS, AEAD, transports incl tls_tunnel + https_mimic)
│   ├── cli/                  # Universal CLI (delegates to linux/cli everywhere)
│   ├── linux/                # NEW native Linux GUI+CLI
│   │   ├── src/main.ts, tun-linux.ts, tray.ts, renderer/  # Electron + TUN + GNOME
│   │   ├── cli/src/commands/*  # connect/disconnect/status/config with TLS+SNI mimic
│   │   ├── installers/install.sh, .desktop, electron-builder.yml
│   │   └── vite.config.ts
│   ├── desktop/              # Electron all-platforms (reuses core)
│   ├── windows/              # WinTun C# + NSIS guide
│   ├── macos/                # NetworkExtension + DMG
│   ├── android/              # VpnService Kotlin + Gradle
│   ├── ios/                  # NetworkExtension Swift
│   └── web/                  # Vite/React PWA — preview
├── scripts/build-all.sh, build-linux.sh, test-stealth.sh
└── docker-compose.yml
```

---

## Testing stealth

```bash
./scripts/test-stealth.sh --target cdn.openpath.example.com:443
# JA3=Chrome, no VPN sig, decoy 200, probe 404, entropy, padding

# Linux CLI
openpath status                 # shows JA3 profile, TUN mode, RTT
sudo tcpdump -i tun0 -w cap.pcap port 443
wireshark cap.pcap  # → TLSv1.3 only, JA3 Chrome124
```

## Build all installers

```bash
./scripts/build-all.sh
# Linux
cd client/linux && npm run pack:deb && npm run pack:appimage
# Windows/macOS (needs electron-builder + platform)
cd client/desktop && npx electron-builder --win nsis --mac dmg --linux deb
# Android
cd client/android && ./gradlew assembleRelease
```

Artifacts in `dist-installer/` and GitHub Releases workflow `.github/workflows/build.yml`.

---

## Ethics

Built for privacy and legitimate access (research, docs, comms). Respect acceptable-use policies and local laws. Authors not responsible for misuse.

---

MIT © mob5824 — contributions welcome.  
*“Privacy is not about hiding; it’s about consent.”*
