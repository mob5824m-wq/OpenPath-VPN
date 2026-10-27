# OpenPath VPN — Linux (Native GUI + CLI)

> **Native Linux app** — GUI (`openpath-gui`) + CLI (`openpath`) that wraps all VPN traffic **inside TLS over TCP :443** and **mimics standard HTTPS browsing** so school firewalls classify it as regular web traffic.

## Features (Linux-specific)
- **TLS obfuscation**: real TLS 1.3 socket with SNI `cdn.yourdomain.com`, ALPN `h2`, JA3 cloned from Chrome124/Safari17/Firefox128 — DPI sees `TLSv1.3 Application Data`, not VPN.
- **HTTPS mimicry**: packet sizes follow web histogram (60B ACKs / 1200B HTML / 1460B images), jitter 2-60 ms, browser headers, decoy portfolio site on probe.
- **TUN**: kernel TUN (`tun0` 10.89.0.2/24, `iptables` NAT) when `sudo`; unprivileged fallback SOCKS5 `127.0.0.1:1080` + GNOME proxy auto-config — no root required for most use.
- **System integration**: `.desktop` launcher, tray icon, autostart (`~/.config/autostart`), AppImage / .deb / .rpm.

```
CLI ──► openpath connect  ──► TLS:443 ──► Cloudflare ──► Server (decoy + OPSP) ──► Internet
GUI ──┘                  (all bytes inside TLS)         (probes see 200 HTML)
      TUN: tun0 or SOCKS fallback → every app routed
```

## Quick install

### 1-line (from GitHub)
```bash
curl -fsSL https://raw.githubusercontent.com/mob5824m-wq/OpenPath-VPN/main/client/linux/installers/install.sh | bash
```

### From source (this repo)
```bash
# CLI (needs Node 20)
cd client/linux/cli && npm install && npm run build
sudo npm link   # exposes `openpath` globally

# GUI (Electron, needs Node 20 + build-essential)
cd client/linux && npm install && npm run build
npm run pack:deb   # → dist-installer/OpenPath-*.deb
sudo dpkg -i dist-installer/*.deb

# Or AppImage (portable, no install)
npm run pack:appimage  # → OpenPath-1.0.0.AppImage
chmod +x OpenPath-*.AppImage && ./OpenPath-*.AppImage
```

Dependencies (auto-installed by installer): `iproute2`, `iptables`, `ca-certificates`, `libnss3`.

## Usage

### CLI (works over SSH, no display)
```bash
# configure once (stored at ~/.config/openpath/config.json, chmod 600)
openpath config set psk YOUR_32B_PSK
openpath config set serverUrl wss://cdn.yourdomain.com/ops
openpath config set stealthProfile chrome124   # or safari17/firefox128/meet

# connect (TLS handshake + HTTPS mimic)
openpath connect
# with overrides
openpath connect --server wss://cdn.yourdomain.com/ops --psk XXX --profile safari17 --no-jitter

# check
openpath status          # shows TLS fingerprint, TUN mode, RTT, uptime
openpath config get      # dump config
openpath disconnect      # or Ctrl+C in connect window
```

When root: `tun0` kernel TUN captures all traffic. Without root: SOCKS fallback — configure:
```bash
export http_proxy=socks5://127.0.0.1:1080 https_proxy=socks5://127.0.0.1:1080
# GNOME proxy is auto-set by CLI; verify:
gsettings get org.gnome.system.proxy mode
```

### GUI
Launcher → **OpenPath VPN** or terminal `openpath-gui`:
- Server / PSK fields, profile dropdown (Chrome124 default)
- Jitter / padding / domain-front toggles
- Connect button → shows live log: `TLS 1.3 SNI=… ALPN=h2 → decoy fetch → Upgrade: websocket → tunnel UP mode=kernel|sock`
- Stats: RX/TX, RTT, uptime, TUN mode, TLS fingerprint line
- Tray: minimize to tray, Connect/Disconnect from menu
- Autostart toggle → writes `~/.config/autostart/openpath.desktop`

### Troubleshooting

| Problem | Fix |
|---------|-----|
| `ip tuntap add: Operation not permitted` | Normal without sudo — CLI auto-falls back to SOCKS; use `sudo openpath connect` for kernel TUN |
| School throttles WebSocket | `openpath config set stealthProfile safari17` or `meet`; server auto-switches to H2-stream over same TLS |
| GNOME not using SOCKS | `openpath` auto-runs `gsettings set org.gnome.system.proxy ...`; verify in Settings → Network → Proxy  |
| MitM proxy (school CA on managed device) | Inner OPSP ChaCha20 stays encrypted; use BYOD network or personal hotspot if outer TLS inspected |

## Building installers

```bash
cd client/linux
npm run pack:deb      # .deb (Ubuntu/Debian/Mint)
npm run pack:rpm      # .rpm (Fedora/RHEL)
npm run pack:appimage # .AppImage (portable, any distro)
npm run pack:all      # all three
```
Artifacts in `dist-installer/`. See `electron-builder.yml`.

## Uninstall
```bash
./client/linux/installers/uninstall.sh
# or
sudo dpkg -r openpath-vpn; sudo rm -rf ~/.config/openpath  # wipe PSK too
```

## Source layout

```
client/linux/
  cli/           # Commander CLI — connect/disconnect/status/config
  src/           # Electron main + TUN + tray + config
    tun-linux.ts # ip tuntap + iptables + GNOME proxy
    main.ts      # TLS+SNI WebSocket, jitter/padding, pidfile
    renderer/    # simple GUI HTML
  installers/    # .desktop, install.sh, uninstall.sh
  vite.config.ts # renderer build
```

All traffic is TLS-wrapped after this client — zero plain VPN on wire.

