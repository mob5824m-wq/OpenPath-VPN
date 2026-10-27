#!/usr/bin/env bash
set -e
echo "Build macOS DMG (universal arm64+x86_64, notarized) — OpenPath VPN"
# Requires Xcode + electron-builder
cd "$(dirname $0)/../../desktop"
npm install
npx electron-builder --mac dmg --x64 --arm64 --publish never
echo "DMG at dist-installer/OpenPath VPN-*.dmg — now notarize:"
echo " xcrun notarytool submit dist-installer/*.dmg --apple-id ... --team-id ..."
echo " xcrun stapler staple dist-installer/*.dmg"
