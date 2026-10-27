#!/usr/bin/env bash
set -e
echo "OpenPath — build all platforms (GUI + CLI + installers)"
ROOT=$(cd "$(dirname $0)/.." && pwd)
echo "Root: $ROOT"

# Server
echo "→ Server build..."
(cd "$ROOT/server" && npm install && npx tsc --outDir dist && echo "  server ok")

# Core
echo "→ Core build..."
(cd "$ROOT/client/core" && npm install && echo "  core ok")

# Web (PWA)
echo "→ Web build..."
(cd "$ROOT/client/web" && npm install && npm run build && echo "  web ok")

# Linux CLI + GUI
echo "→ Linux CLI + GUI..."
if [ -d "$ROOT/client/linux/cli" ]; then
  (cd "$ROOT/client/linux/cli" && npm install && npx tsc -p tsconfig.json && chmod +x bin/openpath 2>/dev/null || true && echo "  linux cli ok" || echo "  linux cli skip (no npm)")
fi
if [ -d "$ROOT/client/linux" ]; then
  (cd "$ROOT/client/linux" && npm install 2>/dev/null && echo "  linux gui deps ok" || echo "  linux gui skip")
fi

# CLI universal
if [ -d "$ROOT/client/cli" ]; then
  (cd "$ROOT/client/cli" && npm install 2>/dev/null && echo "  cli ok" || true)
fi

echo ""
echo "✓ Done. Installers:"
echo "  Linux deb/rpm/AppImage:  cd client/linux && npm run pack:all"
echo "  Windows NSIS:            cd client/desktop && npx electron-builder --win nsis"
echo "  macOS DMG:               cd client/desktop && npx electron-builder --mac dmg"
echo "  Android APK:             cd client/android && ./gradlew assembleRelease"
echo "  iOS IPA:                 Xcode archive (client/ios + client/macos)"
echo "All binaries use TLS over TCP:443 + HTTPS mimicry — school sees standard web."
