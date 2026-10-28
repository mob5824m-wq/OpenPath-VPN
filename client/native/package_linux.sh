#!/usr/bin/env bash
# Package the PyInstaller Qt Widgets build, not the web preview.
set -euo pipefail
cd "$(dirname "$0")"
VERSION=${1:?Usage: package_linux.sh VERSION TAG}
TAG=${2:?Usage: package_linux.sh VERSION TAG}
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([~-][0-9A-Za-z.]+)?$ ]] || { echo 'Invalid Debian version' >&2; exit 1; }
[[ "$TAG" =~ ^v[0-9A-Za-z.-]+$ ]] || { echo 'Invalid tag' >&2; exit 1; }
[[ -x dist/OpenPath/OpenPath ]] || { echo 'Build dist/OpenPath first' >&2; exit 1; }
command -v dpkg-deb >/dev/null
STAGE="$PWD/build/deb-root"
OUT="$PWD/dist-installer"
rm -rf "$STAGE"
mkdir -p "$STAGE/DEBIAN" "$STAGE/opt" "$STAGE/usr/share/applications" "$STAGE/usr/share/icons/hicolor/512x512/apps" "$OUT"
cp -a dist/OpenPath "$STAGE/opt/openpath"
install -m 644 ../../assets/icon-512.png "$STAGE/usr/share/icons/hicolor/512x512/apps/openpath.png"
cat > "$STAGE/DEBIAN/control" <<EOF
Package: openpath-vpn
Version: $VERSION
Section: net
Priority: optional
Architecture: amd64
Maintainer: OpenPath contributors <opensource@openpath.invalid>
Depends: libc6 (>= 2.35), libstdc++6, libglib2.0-0, libfontconfig1, libfreetype6, libgl1, libegl1, libx11-6, libx11-xcb1, libxkbcommon0, libxkbcommon-x11-0, libxcb1, libxcb-cursor0, libxcb-icccm4, libxcb-image0, libxcb-keysyms1, libxcb-randr0, libxcb-render0, libxcb-render-util0, libxcb-shape0, libxcb-shm0, libxcb-sync1, libxcb-xfixes0, libxcb-xinerama0, libxcb-xkb1, libdbus-1-3, wireguard-tools, iproute2, pkexec, resolvconf | openresolv
Description: OpenPath native WireGuard desktop client
 Qt Widgets client for controlling a separately configured WireGuard tunnel.
EOF
cat > "$STAGE/usr/share/applications/openpath-vpn.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Name=OpenPath VPN
Comment=Native WireGuard desktop client
Exec=/opt/openpath/OpenPath
Icon=openpath
Terminal=false
Categories=Network;Security;
EOF
dpkg-deb --root-owner-group --build "$STAGE" "$OUT/openpath-$TAG-linux-amd64.deb"
tar -czf "$OUT/openpath-$TAG-linux-amd64.tar.gz" -C dist OpenPath
