# Native desktop app

This is the release desktop client for Linux, Windows and macOS. Its UI uses PySide6 **Qt Widgets**, not an embedded browser or webview. It has independent controls for the system WireGuard tunnel and the OpenPath WebSocket session. The navigation moves from a desktop sidebar to a compact bottom bar when the window is narrow. See the [root README](../../README.md#device-wide-wireguard-vpn) for OS prerequisites, profile format, DNS behavior and important security limitations.

## Run and test

Python 3.10–3.13 and a graphical desktop are required. Create a virtual environment and install `requirements.txt`, then:

```bash
python client/native/entry.py
PYTHONPATH=client/native python -m unittest discover -s client/native/tests -v
```

On Windows PowerShell use `$env:PYTHONPATH = 'client/native'` before the test command. In a headless environment install the Qt system libraries and set `QT_QPA_PLATFORM=offscreen`; this tests controls, not a full desktop environment. Most tests use fake keychains, WireGuard tools and platform authorization; the workflow also tests a real Linux kernel tunnel through TLS in isolated namespaces. Windows and macOS CI also exercise local peer handshakes through TLS, but not public egress or physical-network changes. The WebSocket PSK is held only in memory; the separate WireGuard private profile is stored in the OS keychain.

## Build the native bundle

On the target operating system and architecture:

```bash
python client/native/make_icons.py
python -m PyInstaller --noconfirm --clean --distpath client/native/dist --workpath client/native/build/pyinstaller client/native/OpenPath.spec
```

Linux produces `dist/OpenPath/OpenPath`; Windows produces `dist/OpenPath/OpenPath.exe`; macOS produces `dist/OpenPath.app`. These are Qt/Python native binaries, not Electron apps. The build includes the relevant keyring backend, but not WireGuard itself. Run the executable with `--smoke-test` and `QT_QPA_PLATFORM=offscreen` to exercise bundle imports and window creation without changing VPN settings.

The [Native Installers workflow](../../.github/workflows/native-installers.yml) runs platform tests, creates the bundles and packages `.deb`/`.tar.gz`, NSIS/`.zip`, and `.dmg`/`.zip` respectively. It also installs and smoke-tests the Linux `.deb` and Windows NSIS installer before removing them. The Linux build uses an Ubuntu 22.04 container (glibc 2.35 baseline); the portable archive requires system Qt platform libraries and the prerequisites in the root README. Windows and macOS builds are architecture-specific. The generated installers are unsigned and macOS builds are not notarized.

A direct WireGuard tunnel remains active when this window closes. Stealth requires the app's relay to remain running; disconnect it before closing the app. Stealth requires a configured WSS relay, and Windows Stealth explicitly disables WireGuard's block-untunneled firewall. See the [Stealth guide](../../docs/STEALTH.md). On macOS, WireGuard's runtime directory may be root-only. The app records the utun name during the authorized start; without a readable record, status is shown as unverified and `wg-quick` checks for name collisions. If a crash or interrupted privilege prompt leaves ambiguous ownership, use system tools to inspect the interface/service and remove it if appropriate. The local ownership marker is a safety aid, not a security boundary.
