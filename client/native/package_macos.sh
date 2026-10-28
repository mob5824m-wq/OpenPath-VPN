#!/usr/bin/env bash
# Package the native Qt Widgets application built on the same architecture.
set -euo pipefail
cd "$(dirname "$0")"
TAG=${1:?Usage: package_macos.sh TAG ARCH}
ARCH=${2:?Usage: package_macos.sh TAG ARCH}
[[ "$TAG" =~ ^v[0-9A-Za-z.-]+$ ]] || { echo 'Invalid tag' >&2; exit 1; }
[[ "$ARCH" = arm64 || "$ARCH" = x64 ]] || { echo 'Invalid architecture' >&2; exit 1; }
[[ -d dist/OpenPath.app ]] || { echo 'Build dist/OpenPath.app first' >&2; exit 1; }
STAGE="$PWD/build/dmg"
OUT="$PWD/dist-installer"
rm -rf "$STAGE"
mkdir -p "$STAGE" "$OUT"
ditto dist/OpenPath.app "$STAGE/OpenPath.app"
ln -s /Applications "$STAGE/Applications"
hdiutil create -volname 'OpenPath VPN' -srcfolder "$STAGE" -ov -format UDZO "$OUT/openpath-$TAG-macos-$ARCH.dmg"
ditto -c -k --sequesterRsrc --keepParent dist/OpenPath.app "$OUT/openpath-$TAG-macos-$ARCH.zip"
