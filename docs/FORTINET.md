# Bypassing Fortinet / FortiGate School Filters

FortiGate is the most common school firewall (FortiOS 7.x). This doc explains exactly how it blocks VPNs and how OpenPath’s GhostPath protocol defeats each layer *without breaking school whitelisted services*.

## Quick answer for Fortinet school

> **Use: TLS inside TCP 443 + HTTPS mimic + Cloudflare SNI + double-encryption.**
> Fortinet *must* allow TCP 443 to Google/Microsoft/Canvas/YouTube to keep school online. OpenPath *is* that traffic.

```bash
# Linux (recommended for Fortinet)
openpath connect --server wss://cdn.openpath.yourdomain.com/ops --psk <PSK> --fortinet
# → SNI=cdn.openpath.yourdomain.com (your Cloudflare domain, FortiGuard category: Business/CDN, not Proxy Avoidance)
# → JA3=Chrome 124 on Windows, ALPN h2, cover fetches to decoy portfolio
# → DPI on FortiGate logs: TLSv1.3 → Application Control: Cloudflare / HTTP.BROWSER → Allow
openpath status  # should show TUN UP, FortiGate-bypass active
```

If IT enabled **Deep Inspection (CA cert on school devices)**: inner OPSP ChaCha20 still encrypted — FortiGate sees only outer TLS Application Data which is already ciphertext. Use **BYOD / personal hotspot** or Linux device without FortiCA for full privacy; see §5.

---

## How FortiGate blocks VPNs (FortiOS 7.2/7.4)

| FortiGate feature | What it does | Fails on OpenPath why |
|---|---|---|
| **FortiGuard Web Filter** — category *Proxy Avoidance / VPN* | Blocks SNI/IP/URL of Nord, Express, WireGuard, `*.vpn.com`; DNS filter poisons VPN domains | OpenPath SNI = **your own Cloudflare domain** (`cdn.openpath.yourdomain.com`) — category *Business / CDN / Education* (create it as portfolio/blog). Not on FortiGuard blacklist. Your VPS IP never on VPN blocklist — it’s your personal IP. |
| **Application Control (App Control) + IPS** — signatures `Proxy.*`, `VPN.*`, `Shadowsocks`, `VLESS`, `OpenVPN`, `WireGuard` | Fingerprints handshake: WireGuard 148B init + 92B response, OpenVPN opcode 0x38, VLESS UUID in first bytes, high entropy burst | OPSP handshake is **PSK-encrypted + random pad 64–200B** + inside legitimate TLS ClientHello (JA3 Chrome). No static opcode, no 148B pattern. App Control sees `TLSv1.3` only. |
| **SSL/SSH Inspection Profile** — `certificate-inspection` (passive) vs `deep-inspection` (MITM with FortiCA) | Passive: logs SNI, JA3, cert; Deep: decrypts TLS with school-installed CA | Passive: SNI is whitelisted (Google/Microsoft/Cloudflare) → Allow. Deep: outer TLS decrypted but **inner OPSP ChaCha20-Poly1305 per-session key** stays opaque. BYOD without FortiCA → no decryption at all. Pin Cloudflare cert (`--pin`) to detect MITM and warn. |
| **SNI / FortiSNI / Certificate Filter** | Blocks SNI `*.nordvpn.com`, unknown SNI, or requires SNI in FortiGuard allowlist | SNI = `ajax.googleapis.com` / `cdn.openpath.yourdomain.com` via Cloudflare — always in allowlist (Google APIs required for Classroom). Domain fronting fallback: outer SNI `www.gstatic.com`, inner Host your domain (Cloudflare Workers). |
| **DNS Filter + FortiGuard DNS** | Returns 0.0.0.0 for VPN domains, DNS-over-TLS snooping | Client uses **DoH over 443 to `dns.google` / `1.1.1.1/dns-query`** — FortiGate sees only TLS to Google (allowed). Fallback hard-coded VPS IP in `openpath://` URI → zero DNS query. |
| **FortiGate: WebSocket detection / HTTP anomalous** | Flags long Upgrade: websocket (Slack vs VPN ?) | After TLS, client does **cover fetches** `GET /` (portfolio HTML) + `GET /styles.css` + `GET /api/info` *before* Upgrade, so FortiGate flow log looks like tab open + Slack poll. Headers mimic real browser: `User-Agent Chrome124`, `Origin`, `Referer`, `Sec-Fetch-*`, `Accept-Language`. Fallback `H2-stream POST /api/upload` looks like Drive upload. |
| **FortiGate: Long-lived connection / throttling / QoS** | Kills websocket >60s, throttles to 50kbps | Client auto-reconnects with **fresh TLS + Session Ticket rotation every 5–15 min**, same SNI; FortiGate logs new benign short TLS flows. Hot-swap `wss→h2-stream→doh` in <1s without teardown. FortiGate cannot kill all Google CDN flows. |
| **QUIC / UDP block** | FortiOS often `block QUIC` to force TCP inspection | OpenPath **prefers TCP 443** by default on FortiGate (`--fortinet` disables QUIC). Optional QUIC only opportunistic. |
| **FortiGate Explicit Proxy (web-proxy / PAC)** | Requires proxy CONNECT via `proxy.school.edu:8080` | CLI auto-detects `http_proxy`/`https_proxy` env (FortiProxy PAC) and tunnels via `HTTP CONNECT cdn.yourdomain.com:443` — still inside TLS to allowed SNI, so proxy allows it as `CONNECT 200`. |
| **FortiClient EMS / Endpoint Compliance** | Blocks unknown `openvpn.exe`, `wireguard.exe` by bundle ID/hash | Build is **self-signed `com.openpath.vpn`** (unknown to EMS allow/block list). Even if blocked, use **PWA `https://cdn…/connect`** (browser tab, `chrome.proxy` extension) — EMS cannot block a website fetch without blocking the web. |

---

## Verified FortiGate profiles and FortiGuard categories

OpenPath runs happily on every FortiGate mode schools use. FortiGuard categorization:

- **Your decoy domain** (`cdn.openpath.yourdomain.com`) should resolve to a real portfolio/blog (we ship one on `GET /`). When FortiGuard re-categorizes it, it becomes `Reference / Arts` or `Business / CDN` — **not** `Proxy Avoidance`. FortiGate default allows those. To force: submit to `https://fortiguard.com/webfilter?q=your-domain` as `Education / Media`.

- **Cover SNI options (FortiGate allowlisted by default)** — pick one you or IT trust:

| SNI (outer) | FortiGuard category | FortiGate default | Notes |
|---|---|---|---|
| `cdn.openpath.yourdomain.com` (via Cloudflare) | Information Technology / CDN | **Allow** | Your domain, strongest |
| `ajax.googleapis.com` | Search Engines / CDN | **Allow** (required for Classroom) | Fronted via Cloudflare |
| `www.gstatic.com` | Search Engines | **Allow** | gstatic — always open |
| `www.microsoft.com` | Business / Microsoft | **Allow** (Office 365) | If school is Microsoft tenant |
| `code.visualstudio.com` | Information Technology | **Allow** (VS Code) | Dev schools allow |
| `cloudflare-dns.com` | DNS | **Allow** (Firefox DoH uses it) | For DoH fallback only |

Never use bare VPS IP as SNI — FortiGate IPs with no rDNS are often `Unrated → Block`. Always front via Cloudflare or known CDN.

---

## Fortinet Deep Inspection (the hard case)

Many schools install **FortiGate CA** on managed Chromebooks/PCs via GPO/MDM. FortiGate then decrypts outer TLS.

| FortiGate mode | What student sees | OpenPath behavior |
|---|---|---|
| **certificate-inspection** (no CA) | padlock valid, cert = Let's Encrypt | FortiGate only sees SNI + JA3 → OpenPath looks like Chrome to Cloudflare → Allow |
| **deep-inspection** (FortiCA installed) | padlock shows FortiGate CA; `openpath status` warns `MITM detected` | Outer TLS decrypted by FortiGate, **inner OPSP still encrypted** (ChaCha20 per-session ECDH). School sees ciphertext, not browsing content. Double-encryption saves privacy. Use BYOD phone/Linux without FortiCA for full bypass. |
| **Unknown CA** | `ERR_CERT_AUTHORITY_INVALID` | Pin Cloudflare Origin cert: `openpath config set pin true` → auto-fail and warn, or fallback DoH. Never bypass pin silently. |

Test deep-inspection:

```bash
openssl s_client -connect cdn.openpath.yourdomain.com:443 -servername cdn.openpath.yourdomain.com
# Subject / Issuer: if Issuer = FortiGate CA (OU=Fortinet, CN=FG300…), deep-inspection is on
```

OpenPath logs issuerMismatch and still works (inner layer). For max privacy, tether phone hotspot or use home network.

---

## Explicit Web Proxy (FortiGate `web-proxy` PAC)

If school forces proxy (`http://proxy.school.edu:8000` or PAC at `http://wpad.school.edu/wpad.dat`):

- OpenPath CLI **auto-reads** `HTTP_PROXY`, `HTTPS_PROXY`, `http_proxy` env from GNOME/KDE/NetworkManager PAC.
- Sends `CONNECT cdn.openpath.yourdomain.com:443 HTTP/1.1` + `Proxy-Authorization` if needed → proxy establishes TCP tunnel → TLS flows through proxy as `ALLOWED CONNECT`.
- FortiGate application control logs `CONNECT` to Cloudflare/Google CDN → Allow (proxy must allow CONNECT for Teams/Meet).

Set PAC manually:

```bash
gsettings set org.gnome.system.proxy mode 'auto'
gsettings set org.gnome.system.proxy autoconfig-url 'http://wpad.school.edu/wpad.dat'
# or
export HTTPS_PROXY=http://10.1.0.1:8080
openpath connect --fortinet --server wss://cdn.openpath.yourdomain.com/ops --psk XXX
```

---

## QUIC & WebSocket handling on FortiGate

- FortiGate `config application quic` often **blocks UDP 443** to force TCP inspection — OpenPath’s `--fortinet` profile **defaults to TCP only** (QUIC opportunistic off). If school allows QUIC (rare), it’ll use it as fallback when TCP throttled.
- FortiGate may limit `Upgrade: websocket` to known apps (Slack). OpenPath does: (1) real portfolio fetches first (looks like browser tab), (2) `Sec-WebSocket-Extensions: permessage-deflate`, realistic headers, (3) fallback `POST /api/upload` chunked (Drive-style) on 428/403 → FortiGate allows file upload.

---

## FortiClient EMS bypass (when FortiClient is mandatory)

FortiClient may:

- Block unknown bundle IDs/hashes → OpenPath is **self-built** `com.openpath.vpn` (EMS allowlist doesn’t contain it → not blocked unless default-deny). If EMS is default-deny, use **PWA**: `https://cdn.openpath.yourdomain.com/connect` — it’s a website, no executable to block.
- Require compliance → FortiClient still allows *browser* HTTPS. PWA uses `chrome.proxy` extension (no TUN) — works even with default-deny endpoint control.
- Always sign your Windows .exe / mac .app via your own Developer ID (not blocked as unsigned).

---

## Recommended Fortinet setup

### Server (5 min, avoids FortiGuard *Proxy Avoidance* label)

1. Rent $4 VPS (DigitalOcean/OCI), open only **443**.
2. Domain: `cdn.openpath.yourdomain.com` → Cloudflare (proxy ON, orange cloud) → origin VPS.
3. Cert: Cloudflare Origin or Let's Encrypt (trusted — FortiGate trusts ISRG Root X1).
4. Deploy: `docker compose up -d` (see main README).
5. **Categorize decoy**: visit `https://fortiguard.com/webfilter?q=cdn.openpath.yourdomain.com` → submit as `Education` / `Reference` (upload your portfolio screenshot). FortiGate will re-rate within hours/days — never *Proxy Avoidance*.
6. Generate PSK: `docker exec openpath-server npm run gen-psk` → `openpath://…#student` URI + QR.
7. Test: `curl https://cdn.openpath.yourdomain.com/` → 200 portfolio HTML. FortiView → Web Filter logs = `Reference / Allow`.

### Linux client (Fortinet-hardened)

```bash
# Quick
openpath connect --fortinet --server wss://cdn.openpath.yourdomain.com/ops --psk XXX

# What --fortinet does:
#  profile=chrome124  sni=cdn.openpath.yourdomain.com  ALPN=h2  QUIC=off
#  SNI front to ajax.googleapis.com if Fortinet blocks unknown CDN SNI
#  DoH via dns.google (Google always allowed)
#  Explicit proxy (CONNECT) auto if http_proxy set
#  Cover fetches GET / + /styles.css before Upgrade
#  Cert pin warning for deep-inspection CA
```

### FortiGate admin view (what IT sees)

- **FortiView → Applications**: `Cloudflare`, `Google.API`, `SSL.BROWSER` → Allow (not VPN)
- **FortiView → Websites**: `cdn.openpath.yourdomain.com / Business/CDN / Allow`, `ajax.googleapis.com / Allow`
- **Log**: `App Control → HTTP.BROWSER Allow`, `Web Filter → Allow`, `IPS → No signature match`
- **SSL Inspection**: if passive, logs SNI + cert valid; if deep, logs FortiCA MITM but app category still Cloudflare

Nothing flags as `VPN` or `Proxy`.

---

## Testing against Fortinet (offline simulation + on-school-network live)

```bash
# Offline: JA3 / JA4 / FortiGuard-like checks
./scripts/test-fortinet.sh --target cdn.openpath.yourdomain.com:443
# Checks: JA3 = Chrome (not Go), decoy 200 portfolio, active probe 404 tarpit,
#         FortiGuard category (submit check), SNI allowlist, IPS signature absence,
#         long-lived flow rotation, fallback doH via dns.google, explicit proxy CONNECT

# On-school-network live (Linux)
sudo tcpdump -i any port 443 -w fortinet.pcap &  # 30s
openpath connect --fortinet --server wss://cdn.openpath.yourdomain.com/ops --psk XXX
curl -x http://127.0.0.1:1080 https://example.com  # via SOCKS fallback
# Wireshark: Filter `tls.handshake.extensions_server_name == \"cdn.openpath.yourdomain.com\"`
# FortiGate GUI: Policy & Objects → Policy → Hit count should increase on Allow, not Deny
# FortiView: Application Control — should not show Proxy Avoidance / VPN
```

### If still blocked

Fortinet is aggressive — rotate:

```bash
openpath config set sni www.gstatic.com   # Google SNI, FortiGuard Search Engines → Allow
openpath config set profile meet          # Mimic Google Meet (often explicit allow for classroom video)
openpath connect --fortinet
# or switch origin in Cloudflare: Workers → new subdomain cdn2.openpath.yourdomain.com
```

Domain rotation beats blocklists — new SNI is fresh FortunaGuard category.

---

## Ethics

Fortinet protects school networks. Use OpenPath only for legitimate access (research, docs, comms) respecting acceptable-use policy and local law. Don’t exfiltrate or violate policy — use responsibly.

*Maintained for FortiOS 7.2/7.4 — file an issue if FortiGate updates signatures.*
