# OpenPath iOS / iPadOS — Native Installer (TestFlight + Sideload)

> Swift NetworkExtension PacketTunnelProvider + URLSessionWebSocketTask inside TLS 1.3.

## Install (user)

- **App Store**: `OpenPath VPN` (pending review; bundle `com.openpath.vpn.ios` not on MDM blocklists).
- **TestFlight**: invite link from Releases.
- **AltStore / Sideloadly**: IPA `OpenPath-1.0.0.ipa` + refresh every 7 days.
- **CLI shortcut**: iOS Shortcuts → `openpath://` URI opens app (provisions PSK from QR).

## Build (developer)

1. Xcode 15+, iOS 15 target, Capability: Network Extensions (Packet Tunnel) for App + Extension.
2. SwiftPM: `client/core` as package (URLSessionWebSocketTask with custom SNI/ALPN).
3. Archive: `xcodebuild archive -scheme OpenPathVPN` → IPA/Dmg.
4. Distribution: App Store Connect / TestFlight; sideload IPA for unmanaged devices.

School MDM (Jamf) typically blocks by known bundle IDs — `com.openpath.vpn` is self-built, not on blocklist. Fallback PWA at `https://cdn…/connect` works on managed Chromebooks.

