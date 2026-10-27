# OpenPath Windows — Native GUI + CLI Installer

> WinTun + TLS 1.3 over TCP:443 with HTTPS mimicry (JA3 Chrome124, SNI fronted).

## Install (user)

- **Installer**: Download `OpenPath-Setup-1.0.0.exe` (NSIS) from Releases → Next → allow WinTun adapter → approve Windows Firewall exception.
- **winget**: `winget install OpenPath.VPN`
- **Portable**: `OpenPath-1.0.0-win.zip` → unzip → `OpenPath.exe`
- **CLI**: same binary supports `openpath.exe connect --server wss://... --psk XXX` (check `openpath.exe --help`)

Auto-launch toggle in Settings → creates Startup shortcut + tray minimize.

## Build (developer)

1. VS 2022 + .NET 8 + WiX Toolset + NSIS.
2. `client/windows/Tunnel.cs` (C# WinTun wrapper) compiled as helper `openpath-tun.exe`.
3. Electron builder: `cd client/desktop && npx electron-builder --win nsis zip` → `dist-installer/OpenPath Setup 1.0.0.exe`
4. Or C# installer: `dotnet publish client/windows/OpenPath -c Release -r win-x64`

WinTun adapter: `wintun.dll` fetched from wintun.net at build time; first run creates `OpenPath` adapter `10.89.0.2/24`. DPI sees TLS to your Cloudflare SNI only.

## Uninstall
Settings → Apps → OpenPath VPN → Uninstall (removes adapter + service).
