# Native desktop app

This is the release desktop client for Linux, Windows and macOS. Its UI uses PySide6 **Qt Widgets**, not an embedded browser or webview. It has independent controls for the system WireGuard tunnel and the OpenPath WebSocket session. See the [root README](../../README.md#device-wide-wireguard-vpn) for OS prerequisites, profile format, DNS behavior and important security limitations.

## Run and test

Python 3.10–3.13 and a graphical desktop are required. Create a virtual environment and install `requirements.txt`, then:

```bash
python client/native/entry.py
PYTHONPATH=client/native python -m unittest discover -s client/native/tests -v
```

On Windows PowerShell use `$env:PYTHONPATH = 'client/native'` before the test command. In a headless environment install the Qt system libraries and set `QT_QPA_PLATFORM=offscreen`; this tests controls, not a full desktop environment. Tests use fake keychains, WireGuard tools and platform authorization; they don't prove a live tunnel or an installer's behavior. The WebSocket PSK is held only in memory; the separate WireGuard private profile is stored in the OS keychain.

## Build the native bundle

On the target operating system and architecture:

```bash
python client/native/make_icons.py
python -m PyInstaller --noconfirm --clean --distpath client/native/dist --workpath client/native/build/pyinstaller client/native/OpenPath.spec
```

Linux produces `dist/OpenPath/OpenPath`; Windows produces `dist/OpenPath/OpenPath.exe`; macOS produces `dist/OpenPath.app`. These are Qt/Python native binaries, not Electron apps. The build includes the relevant keyring backend, but not WireGuard itself. Run the executable with `--smoke-test` and `QT_QPA_PLATFORM=offscreen` to exercise bundle imports and window creation without changing VPN settings.

The [Native Installers workflow](../../.github/workflows/native-installers.yml) runs platform tests, creates the bundles and packages `.deb`/`.tar.gz`, NSIS/`.zip`, and `.dmg`/`.zip` respectively. The Linux build uses an Ubuntu 22.04 container (glibc 2.35 baseline); the portable archive requires system Qt platform libraries and the prerequisites in the root README. Windows and macOS builds are architecture-specific. The generated installers are unsigned and macOS builds are not notarized.

A WireGuard tunnel remains active when this window closes; explicitly disconnect it. If a crash or interrupted privilege prompt leaves ambiguous ownership, use system tools to inspect the interface/service and remove it if appropriate. The local ownership marker is a safety aid, not a security boundary.
