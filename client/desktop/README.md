# OpenPath Desktop (Windows / macOS / Linux Electron)

Reuses shared `client/core` + TLS tunneling. Now unified:

- **Windows**: WinTun driver via `wintun.dll` (`client/windows/Tunnel.cs` as reference; Electron packs it).
- **macOS**: NetworkExtension utun via privileged helper.
- **Linux**: kernel TUN via `ip tuntap` (root) or SOCKS fallback — see `client/linux/` for full native Linux GUI+CLI.

## Build

```bash
cd client/desktop
npm install
npm run dev        # Vite + Electron (hot reload, uses web dashboard at localhost:5173)
npm run build      # electron-builder → dist-installer/
# per-OS
npx electron-builder --win nsis
npx electron-builder --mac dmg
npx electron-builder --linux deb rpm AppImage
```

Installers land in `dist-installer/` and GitHub Releases.
