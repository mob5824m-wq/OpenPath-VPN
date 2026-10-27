# OpenPath macOS — Native GUI + CLI Installer (Intel & Apple Silicon)

> NetworkExtension PacketTunnelProvider + TLS mimic (Safari17 JA3 on macOS).

## Install (user)

- **DMG**: Download `OpenPath-1.0.0-mac-universal.dmg` → drag to Applications → open → System Settings → Privacy & Security → Allow System Extension → approve VPN profile.
- **Homebrew**: `brew install --cask openpath` (cask from Releases).
- **CLI**: `/Applications/OpenPath VPN.app/Contents/MacOS/openpath connect --server wss://... --psk XXX` or symlink: `sudo ln -s "/Applications/OpenPath VPN.app/Contents/MacOS/openpath" /usr/local/bin/openpath`

Universal binary (arm64 + x86_64). Requires macOS 12+ (Monterey). Notarized.

## Build (developer)

1. Xcode 15+ → open `client/macos/OpenPathVPN.xcodeproj` (NetworkExtension entitlement required, Team ID).
2. `PacketTunnelProvider.swift` + `openpath-core` SwiftPM.
3. DMG: `cd client/desktop && npx electron-builder --mac dmg` or `xcodebuild archive`.
4. Notarize: `xcrun notarytool submit ...`

utun interface `utun9 10.89.0.2` via `NEPacketTunnelProvider`; TLS SNI fronted via Cloudflare; school sees Safari HTTPS.
