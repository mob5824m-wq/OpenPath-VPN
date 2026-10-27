# OpenPath Android — Native GUI + CLI Installer

> Kotlin VpnService + `openpath-core` AAR with TLS tunneling over 443 and HTTPS mimicry.

## Install (user)

- **Play Store**: `OpenPath VPN` (F-Droid build available).
- **APK (GitHub Releases)**: `openpath-1.0.0-arm64.apk` → Enable unknown sources → install → Allow VPN permission (one tap).
- **CLI via Termux**: `pkg install nodejs && npm i -g openpath-cli && openpath connect --psk XXX` (uses same TLS mimic, no TUN root needed).

Split-tunnel: Settings → Apps → choose which apps bypass VPN (e.g., keep school intranet direct).

## Build (developer)

1. Android Studio Hedgehog+ → open `client/android`.
2. Go mobile: `go install golang.org/x/mobile/cmd/gomobile@latest && gomobile init && gomobile bind -target=android -o libs/openpath.aar ./client/core/go`
3. Gradle: `./gradlew assembleRelease` → `app/build/outputs/apk/release/app-release.apk`
4. Sign with `apksigner`.

`OpenVpnService.kt` demonstrates VpnService with Builder API, DoH DNS (1.1.1.1), TLS-wrapped OPSP inside `wss://`.
