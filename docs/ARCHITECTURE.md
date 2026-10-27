# OpenPath-VPN Architecture (v1.1 — TLS + Mimicry + Linux native)

```
┌──────────────────────────────────────────────────────────┐
│                 User Device (Any OS)                     │
│  ┌────────────────────────────────────────────────────┐  │
│  │  GUI — React/Electron/Swift/Kotlin (native)        │  │
│  │  • Connect/Disconnect, stats, live TLS log         │  │
│  │  • Profile: chrome124/safari17/firefox128/meet     │  │
│  └───────────┬────────────────────────────────────────┘  │
│  ┌───────────▼────────────────────────────────────────┐  │
│  │  CLI — `openpath` (Node/Go) all platforms          │  │
│  │  • openpath connect/status/disconnect/config       │  │
│  └───────────┬────────────────────────────────────────┘  │
│               │                                           │
│  ┌────────────▼────────────────────────────────────────┐  │
│  │  openpath-core (TypeScript shared)                 │  │
│  │  • Handshake X25519 ECDH + HMAC-PSK                │  │
│  │  • AEAD XChaCha20-Poly1305 / AES-GCM               │  │
│  │  • TLS-tunnel: SNI, ALPN, JA3 clone                │  │
│  │  • HTTPS-mimic: pad, jitter, coalesce, headers     │  │
│  │  • Transports: wss+tls, h2+tls, doh+tls, quic      │  │
│  │  • Tunnel: TUN (kernel / WinTun / utun) or SOCKS5 │  │
│  └────────────┬────────────────────────────────────────┘  │
│               │ TLS 1.3 record layer (JA3 Chrome124)       │
│               │ TCP :443  +  WebSocket Upgrade + decoy     │
└───────────────┼───────────────────────────────────────────┘
                │
                │ Cloudflare CDN (optional domain front)
                │ SNI=cdn.openpath.example.com (whitelisted)
                ▼
┌───────────────────────────────────────────────┐
│           OpenPath Server (Node.js)           │
│  • TLS termin. (Let's Encrypt, SNI callback)  │
│  • Decoy website (GET / → portfolio 200)      │
│  • Auth: HMAC + nonce cache + tarpit          │
│  • OPSP sessions (AEAD, pad/jitter validator) │
│  • Transports: tls_tunnel, https_mimic, ws    │
│    + h2-stream, doh, quic fallback           │
│  • NAT / iptables egress → Internet           │
│  • DoH resolver 1.1.1.1                       │
└───────────────┬───────────────────────────────┘
                │ egress (school sees target, not VPN IP if fronted)
                ▼
         Internet / YouTube / Meet / etc.
```

## Repository Layout (v1.1)

- `protocol/SPEC.md` — OPSP handshake, framing, crypto
- `protocol/TLS-OBFUSCATION.md` — inside TLS over TCP:443, JA3, fronting
- `protocol/TRAFFIC-MIMICRY.md` — HTTPS sizes/timing/headers/decoy, profiles
- `docs/BYPASS_TECHNIQUES.md` — each school block → countermeasure
- `server/` — Node.js server + decoy + TLS config (`transports/tls_tunnel`, `https_mimic`)
- `client/core/` — shared lib + `transports/tls_tunnel`, `https_mimic`
- `client/cli/` — universal CLI (delegates to linux/cli)
- `client/linux/` — **native Linux GUI+CLI** (Electron + kernel TUN/SOCKS + tray + autostart + deb/rpm/AppImage)
- `client/desktop/` — Electron all-platforms wrapper
- `client/windows/` — WinTun C# + NSIS
- `client/macos/` — NetworkExtension utun + DMG
- `client/android/` — VpnService Kotlin + Gradle
- `client/ios/` — NetworkExtension Swift
- `client/web/` — Vite/React PWA preview (also GUI for Linux dev)

## Data Path (with TLS + mimic)

1. App captures via TUN (or SOCKS5) → `TUN_IPv4` OPSP frame → pad to web histogram → jitter 2-60ms → coalesce
2. OPSP AEAD encrypt (ChaCha20-Poly1305, per-session key)
3. Wrap inside TLS 1.3 `application_data` (SNI=cdn…, ALPN h2, Chrome JA3)
4. TCP 443 → Cloudflare edge → origin TLS termination → OPSP decap → egress NAT
5. Response coalesced server → same TLS → client TUN → app.

## TLS + Mimicry Integration

- `server/src/transports/tls_tunnel.ts` — builds TLS options (SNI, ALPN, SNICallback), cert loading.
- `server/src/transports/https_mimic.ts` — decoy endpoints, `Server: cloudflare` headers, uniform-size validator.
- `client/core/src/transports/tls_tunnel.ts` — Node `tls.connect` with browser profile; browser delegates to WS.
- `client/core/src/transports/https_mimic.ts` — pad/headers/jitter helpers applied before send.
- `server/src/utils/obfuscation.ts` — jitter, padding, fake headers per profile.

## Linux TUN Details

- `client/linux/src/tun-linux.ts` — `ip tuntap add dev tun0` + `ip addr add 10.89.0.2/24` + `iptables NAT`; fallback SOCKS5 + GNOME proxy; autostart `.desktop`.
- Electron main (`src/main.ts`) — builds HMAC token, spawns WS with browser headers, manages pidfile `~/.config/openpath/openpath.pid`, updates tray.

## Native Installers

- Linux: `electron-builder.yml` → deb/rpm/AppImage (auto deb depends on libnss3 etc.)
- Windows: NSIS + wintun.dll (desktop builder)
- macOS: DMG universal (Xcode + desktop builder)
- Android: `./gradlew assembleRelease` + Gomobile AAR
- iOS: Xcode archive → IPA/TestFlight

## Deployment

- VPS: `docker compose up` (443 with Let's Encrypt)
- Tunnel: `cloudflared` so no public IP
- GUI/CLI all fetch PSK via `POST /api/provision` → `openpath://` URI → QR scan on phone

## Build All

See `scripts/build-all.sh` and `client/linux/README.md` per-OS guides.

