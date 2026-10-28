# OpenPath for Android

This is a native Android Views app (Android 8.0/API 26 or newer), not a WebView. It uses the official [WireGuard Android tunnel library](https://www.wireguard.com/embedding/) and the system VPN permission. The previous simulated tunnel and fake notification scaffolding has been removed.

## Use

1. Get a WireGuard `.conf` from an operator who runs a real WireGuard server and has configured your peer. OpenPath does not provision a server or supply profiles.
2. Open **Profiles → Choose .conf file**. The app accepts one interface and one peer with `0.0.0.0/0` and `::/0` routes. It rejects script hooks, per-app exclusions and unsupported directives. Your original file remains in its original location; protect or delete it separately.
3. In **Settings**, choose profile DNS (Cloudflare fallback), Quad9 malware filtering, AdGuard DNS filtering, or numeric custom resolvers. These choices affect DNS for the VPN; app-specific DoH and Android Private DNS may bypass filtering.
4. Return to **Home → Connect WireGuard**, and approve Android's VPN dialog. **Interface active** only means Android and WireGuard started the interface; it does not confirm a handshake, reachable server or protected public traffic. Disconnect explicitly when done.

The imported profile is encrypted in app-private storage with an AES-GCM key held by Android Keystore. Android backup is disabled. No plaintext fallback is used if the keystore fails. There is no general kill switch, automatic reconnection/Always-on support, per-app split tunneling, or live peer verification. Android can revoke this VPN when another VPN is enabled or stop it if the process is killed. The OpenPath WebSocket/TLS session is a separate protocol and is **not implemented in this Android app**.

## Build and test

Open `client/android` in Android Studio with Android SDK 36 and JDK 17, or from a terminal:

```bash
cd client/android
./gradlew testDebugUnitTest assembleRelease
```

The Gradle wrapper pins the distribution checksum. The release APK at `app/build/outputs/apk/release/app-release-unsigned.apk` must be signed before installation. For local development, `./gradlew assembleDebug` creates a debug-signed APK; do not use it to protect real secrets.

The [Android workflow](../../.github/workflows/android.yml) runs Robolectric tests and builds a non-debuggable APK, then signs it with a newly generated **temporary test key**. Its `openpath-android-test-apk` CI artifact (and the similarly named future release asset) is installable for evaluation only. It is not production signing, and because each run has a different certificate, the next build cannot update it in place: uninstall first, which deletes the stored profile. A production release needs a securely managed, persistent signing key and release process. No Play Store or F-Droid listing is claimed.

Unit tests validate the parser, DNS selection, encrypted storage with an injected test key and responsive navigation; they do not prove Android Keystore behavior on a device, a real handshake, background reliability or public network routing. Device testing with a real server is still required.
