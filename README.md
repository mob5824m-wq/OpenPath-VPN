# OpenPath VPN

OpenPath provides a **native Qt Widgets desktop app** for Linux, Windows and macOS, a server, and a separate web UI preview. The desktop app is not a browser wrapper and does not embed a webview. The old Electron projects remain in the repository as legacy code; they are not used for the desktop releases.

There are two distinct connections:

1. **Device-wide VPN:** the desktop app controls an operator-provided WireGuard UDP tunnel using the operating system's WireGuard tools. The OpenPath server does not create or operate that WireGuard server.
2. **WebSocket session:** the desktop app and web preview can connect to an OpenPath server and send individual HTTP GET requests through it. This session does **not** route other apps or browser tabs. `wss://` uses TLS; `ws://` is unencrypted.

> **Security:** The supplied demo PSK and unauthenticated provisioning/host-registration endpoints are not production-safe. Use the demo only on a trusted network; secure or disable these endpoints before exposing a server. The device VPN has no general kill switch, and an active interface alone does not prove a peer handshake or internet connectivity. Inspect routes and verify your setup independently before relying on it for privacy.

## Native desktop app

Download a desktop installer from a release that includes one, or run from source with Python 3.10+:

```bash
python3 -m venv .venv
. .venv/bin/activate                # Windows: .venv\Scripts\activate
pip install -r client/native/requirements.txt
python client/native/entry.py
```

The **Home** page imports a WireGuard profile and starts or stops the device VPN. **Session** connects to the separate OpenPath WebSocket server, lists online locations actually advertised by that server, and fetches a single URL through it. Enter the WebSocket server URL, username and PSK in **Settings**; the PSK stays in process memory and is never saved by the app. **Releases** lists real published GitHub assets and opens selected downloads in the system browser. See [native desktop development and packaging](client/native/README.md).

### Device-wide WireGuard VPN

A server operator must first configure a WireGuard server and a dedicated peer profile for this device, including forwarding, firewall/NAT, DNS and working IPv4/IPv6 routes.

1. Install the OS prerequisites below and unlock your system keychain.
2. Import the operator's `.conf` file. The supported profile contains one `[Interface]` followed by one `[Peer]`, an endpoint and `AllowedIPs = 0.0.0.0/0, ::/0`. An IPv6 interface address and server-side IPv6 support are needed for working IPv6 traffic. Only IP-address DNS entries are accepted. Hook commands, `Table` and other unsupported directives are rejected before elevation.
3. Choose a DNS policy, select **Connect device VPN** and approve the administrator prompt. Use **Disconnect** when finished. The WebSocket session is independent.

NetShield/DNS choices are **unfiltered** (the profile's DNS, or Cloudflare if omitted), **malware** (Quad9), **ads/malware/trackers** (AdGuard DNS), or custom resolver IPs. These are third-party DNS services, not an OpenPath-maintained blocklist. Apps using their own encrypted DNS, local-network routes, or other network configurations can bypass filtering. A changed choice applies on the next device connection.

**Prerequisites:**

- **Linux:** `wg`, `wg-quick`, `iproute2`, `resolvconf` or `openresolv`, polkit/`pkexec` (unless running as root), kernel WireGuard or its supported userspace implementation, and an unlocked Secret Service-compatible keychain such as GNOME Keyring. DNS setup depends on the host's `resolvconf` integration.
- **macOS:** WireGuard tools including `wg-quick`, `wg` and `wireguard-go` (for example via Homebrew's `wireguard-tools` package), an unlocked Keychain, and administrator authorization.
- **Windows:** the official WireGuard for Windows application and Windows Credential Manager. The app requests UAC authorization to install/remove a tunnel service. Windows' credential store protects the saved profile, but the service also needs a **plaintext** configuration while installed, in a directory restricted to the current user and SYSTEM. Administrators can still access it. The service can restart with Windows; disconnect removes it and the plaintext file when removal is confirmed.

Linux/macOS use restricted temporary plaintext configuration files for `wg-quick` and normally remove them after each command; an abrupt process or system crash can leave them or network changes behind. The VPN is **not** automatically disconnected when the app closes. The app refuses to stop an interface whose ownership it cannot confirm, but its local ownership marker is not a security boundary. If start/stop is interrupted or ownership is ambiguous, inspect and clean up with the original WireGuard/system tools. Disconnecting does not require the profile keychain to remain unlocked. No peer-handshake verification, automatic kill switch, LAN exclusion guarantee, or guarantee of IPv6 connectivity is provided.

## Web UI preview and server

The web UI is a **testing preview**, not the shipped desktop application. Requires Node.js 20 or newer. Start the server and preview in separate terminals:

```bash
cd server && npm ci && npm run dev
cd client/web && npm ci && npm run dev
```

Open the Vite address shown in the terminal. Quick Connect opens a WebSocket session; Countries shows actually advertised online hosts. The preview stores non-secret profiles and settings locally and keeps the PSK in tab memory. Its default server address uses the preview's own origin, so a reverse proxy must forward `/api`, `/health`, `/ops` and `/fast` to the backend. Vite does this in development; set `OPENPATH_BACKEND_URL` to change its backend. Docker Compose builds the server and preview and serves the latter on port `4173`.

The demo fetch supports GET/HEAD only, blocks private, loopback and reserved IPs including on redirects, pins checked DNS results and limits responses to 6,000 bytes. `POST /api/provision` returns the demo PSK without authentication and must not be exposed to untrusted clients.

## Releases and packaging

The **Native Installers** workflow builds Qt/PyInstaller applications and runs native control/backend tests and a packaged-app smoke test on each platform. It produces Linux x64 `.deb` and portable `.tar.gz`, Windows x64 NSIS `.exe` and `.zip`, and macOS Intel and Apple Silicon `.dmg` and `.zip`. The release workflow publishes those along with server/web-preview archives and SHA-256 checksums only after all jobs succeed, using the exact release tag. A manual Native Installers run without a tag creates CI artifacts without publishing. These builds are unsigned and macOS builds are not notarized; OS security prompts may appear. Android/iOS installers are not produced. Existing releases are not retroactively changed; a new release is needed for new installers.

For a downloaded server archive, run `npm ci --omit=dev` then `npm start`. Set `WEB_DIST` to the extracted web-preview archive's `dist` directory to serve it and the API from one origin, or configure the reverse proxy described above. Verify downloaded files with `SHA256SUMS.txt`.

## Tests and development

```bash
PYTHONPATH=client/native python -m unittest discover -s client/native/tests -v
(cd server && npm ci && npm test && npm run build)
(cd client/web && npm ci && npm test && npm run typecheck && npm run build)
```

On headless Linux, Qt tests need the usual system Qt graphics libraries and `QT_QPA_PLATFORM=offscreen`. Tests of system commands are mocked; real device tunnels require OS privileges and an operator-controlled server. The repository also contains legacy Electron GUIs and experimental TUN, CLI and mobile scaffolding. They are not the native desktop release or a completed alternative WireGuard implementation. See [protocol specifications](protocol/SPEC.md) and [architecture notes](docs/ARCHITECTURE.md) as design documents, not security guarantees.

MIT license. Use responsibly and comply with applicable policies and laws.
