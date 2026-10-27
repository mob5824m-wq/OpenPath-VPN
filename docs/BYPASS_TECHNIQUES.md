# How OpenPath Bypasses School/Workplace VPN Blocks

Schools typically deploy FortiGate, Palo Alto, Lightspeed, or Securly. This doc explains each blocking method and OpenPath's countermeasure.

## 1. Port Blocking
**Block:** Firewall drops UDP 1194 (OpenVPN), 51820 (WireGuard), 500/4500 (IPsec), 1723 (PPTP), even 22 (SSH tunnels).
**Bypass:** OpenPath ONLY uses TCP 443 — the HTTPS port. Every school must leave 443 open for Google Classroom, Canvas, YouTube, etc. No other port is ever needed (UDP 443/QUIC is optional fallback).

Test: `nmap -p 443 school-firewall` always shows open. We hide VPN inside that port.

## 2. Deep Packet Inspection (DPI)
**Block:** Firewall inspects handshake bytes. WireGuard has recognizable 148B `initiator` pattern; OpenVPN has `0x38` opcode; Shadowsocks has high-entropy but fixed length.
**Bypass:**
- OPSP handshake is **encrypted with PSK** and padded to random length (64-200B) — looks like random TLS application data.
- After TLS, payload is inside legitimate `ClientHello` → `Application Data` records. Firewall sees only TLS ciphertext; certificate is valid Let's Encrypt for `cdn.openpath.school.edu` (or any domain you control behind Cloudflare).
- TLS fingerprint is **cloned from Chrome 124** via header ordering, cipher suite list, extensions, ALPN. Tools like JA3 / JA4 fingerprint it as real Chrome, not Go/js VPN.
- No static bytes: negotiated per-session magic + encrypted length field.

Verification: Run `wireshark` capture → protocol shows `TLSv1.3` + `WebSocket` — identical to Slack/Notion web clients.

## 3. SNI / Domain Filtering
**Block:** Firewall checks TLS ClientHello SNI field against list of known VPN domains (`nordvpn.com`, `expressvpn.net`, `*.wireguard.com`). Blocks if matched.
**Bypass:**
- SNI is `cdn.openpath.example.com` or any whitelisted domain (e.g., `az705742.vo.msecnd.net` Azure CDN, `d3j3asdf.cloudfront.net`). You own this domain and point it via Cloudflare to your VPS.
- Real destination encoded inside encrypted tunnel via `CONNECT` semantic, not visible.
- Optional **Domain Fronting**: SNI = `www.microsoft.com` (front), Host header inside TLS = `cdn.openpath.example.com` (real). Cloudflare/AWS front validates SNI only at edge; Host routes to origin.

Setup: Deploy server behind Cloudflare Workers → traffic looks like it goes to Cloudflare, which is whitelisted everywhere.

## 4. IP Blocklists
**Block:** Schools subscribe to feeds of commercial VPN egress IPs. Packet to those IPs dropped.
**Bypass:**
- You run your **own VPS** (DigitalOcean $4/mo, Oracle Free Tier, home server). Its IP is not on any VPN blocklist (it's your personal IP, not known VPN provider).
- Optionally, rotate egress via Cloudflare Warp / AWS Lambda for extra anonymity.
- Server supports **domain fronting** so firewall sees Cloudflare IP (1.1.1.x) not VPS IP.

## 5. Active Probing / Honeypot Detection
**Block:** Firewall without PSK connects to suspected VPN server, sees if it replies like VPN (e.g., OpenVPN sends `SERVER` error).
**Bypass:** Decoy website.
- `curl https://cdn.openpath.example.com/` ⇒ Returns full HTML portfolio site (React static build, fake blog posts, contact form). Status 200, valid cert. Scanner (Shodan, Censys, FortiGate probe) classifies as "Personal website", not VPN.
- Only path `/ops?auth=HMAC(time,nonce,psk)` triggers VPN. Without correct HMAC, server returns 404 or decoy HTML.
- HMAC is SHA256, checked in constant-time; invalid auth → random delay 0.2-0.8s → close. No timing oracle.

## 6. DNS Filtering
**Block:** School DNS returns 0.0.0.0 for VPN domains; DoH blocked at DNS level.
**Bypass:**
- Client never uses school DNS for VPN domain resolution. It queries `https://cloudflare-dns.com/dns-query` (DoH) or `https://dns.google/dns-query` directly over 443. School sees only encrypted DoH query to Cloudflare, indistinguishable from Firefox/Chrome DoH.
- After tunnel up, all system DNS forced through tunnel via embedded DNS forwarder (client TUN captures port 53).
- Fallback: Hardcode VPS IP + provide IP fallback URI `openpath://192.0.2.1:443#...` (no DNS needed).

## 7. Traffic Analysis (Size/Timing)
**Block:** ML classifier detects VPN by packet size histogram (WireGuard produces 1420B packets) or constant keepalive intervals (WireGuard 25s).
**Bypass:**
- **Size morphing**: Pad frames to mimic web traffic distribution. Real web browsing has trimodal sizes (small ACKs ~60B, TLS records ~1200B, large images ~1460B). OpenPath pads to this distribution via PRNG seeded with session key.
- **Timing jitter**: Each frame delayed by `random(2,60)ms * sin(frameCounter)` — destroys inter-arrival correlation. Keepalive interval random 15-45s (like HTTP/2 PING).
- **Burst coalescing**: Coalesce 2-5 small packets into one TLS record when possible, similar to browser HTTP pipelining.

## 8. QoS Throttling / Shaping
**Block:** Firewall throttles long-lived TLS connections or limits WebSocket duration.
**Bypass:** Auto-reconnect with session resumption. If server detects throttling (throughput <50kbps for 10s), client switches transport: WS → H2 streaming → DoH tunnel → QUIC. Each switch takes <1s.

## 9. Captive Portal / TLS Intercept (MitM)
**Block:** School installs root CA on managed Chromebooks to MitM TLS, see inside traffic.
**Bypass:**
- On unmanaged devices (personal laptop/phone), MitM fails because we pin Cloudflare's cert (or use DoH with cert pinning).
- On managed Chromebooks with school CA, flag warns user: "School CA detected — traffic may be inspected". OpenPath still encrypts **inside** TLS (double encryption), so even MitM sees only outer TLS plaintext which is already encrypted OPSP — second layer remains opaque.
- Suggest using personal hotspot or school BYOD network where CA not installed.

## 10. Application / Process Blocking (MDM)
**Block:** School MDM (Jamf, Intune) blocks installation of NordVPN/WireGuard apps by bundle ID.
**Bypass:**
- OpenPath Desktop app is signed with generic developer cert + not on MDM blocklist (you build it yourself, bundle ID is `com.openpath.vpn` — unknown to MDM).
- Even if app install blocked, **browser extension** fallback: Chrome extension (`openpath-extension`) establishes SOCKS proxy via `chrome.proxy` API without TUN — works on locked-down Chromebooks where you can't install apps but can add extensions (or sideload CRX).
- PWA/Web client: Pure JavaScript via `WebSocket` — runs in any browser tab, no install needed. User opens `https://cdn.openpath.example.com/connect` and proxies via browser Fetch API + Service Worker.

## Testing Bypass

We provide `scripts/test-stealth.sh` that simulates FortiGate DPI:

```bash
./scripts/test-stealth.sh --target cdn.openpath.example.com:443
# Checks:
#  - JA3 fingerprint matches Chrome
#  - No VPN signatures in pcap
#  - Decoy returns 200 HTML
#  - Random padding verified
#  - Active probe rejected
```

If school updates rules, rotate SNI/Path via server config `stealth.profile: chrome124` → `safari17` etc.

---

*Educational note: Use this responsibly and respect local laws and school acceptable use policies. This tool is for privacy and accessing legitimate resources.*
