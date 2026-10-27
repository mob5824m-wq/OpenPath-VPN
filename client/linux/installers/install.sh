#!/usr/bin/env bash
set -e
REPO=${REPO:-mob5824m-wq/OpenPath-VPN}
VERSION=${VERSION:-latest}
echo "OpenPath VPN — Linux installer (GUI + CLI + TUN)"
echo "TLS obfuscation inside TCP:443 • HTTPS mimic • Arch: $(uname -m) • Distro: $(lsb_release -is 2>/dev/null || cat /etc/os-release | head -1)"
# Dependencies
if command -v apt-get >/dev/null 2>&1; then
  echo "→ Installing deps via apt..."
  sudo apt-get update -qq
  sudo apt-get install -y iproute2 iptables ca-certificates curl
elif command -v dnf >/dev/null 2>&1; then
  echo "→ dnf deps..."
  sudo dnf install -y iproute iptables ca-certificates curl
elif command -v pacman >/dev/null 2>&1; then
  echo "→ pacman deps..."
  sudo pacman -Sy --noconfirm iproute2 iptables ca-certificates curl
fi

# CLI via npm (universal) — no build needed
if command -v npm >/dev/null 2>&1; then
  echo "→ CLI: npm install"
  # From release tarball or git clone
  if [ -d "./client/linux/cli" ]; then
    (cd client/linux/cli && npm install && npm run build 2>/dev/null || npm install)
    sudo npm link ./client/linux/cli 2>/dev/null || sudo ln -sf $(pwd)/client/linux/cli/dist/cli.js /usr/local/bin/openpath
    sudo chmod +x /usr/local/bin/openpath
  else
    curl -fsSL https://raw.githubusercontent.com/$REPO/main/client/linux/installers/openpath-cli-install.sh | bash
  fi
else
  echo "npm not found — install Node 20: https://nodejs.org"
fi

# GUI: prefer .deb/.rpm/AppImage from Releases
echo "→ GUI:"
if [ -f "./client/linux/dist-installer/OpenPath*.deb" ]; then
  sudo dpkg -i ./client/linux/dist-installer/*.deb || sudo apt-get install -f -y
elif [ -f "./client/linux/dist-installer/*.rpm" ]; then
  sudo rpm -i ./client/linux/dist-installer/*.rpm
elif [ -f "./client/linux/OpenPath-*.AppImage" ]; then
  sudo install -Dm755 ./client/linux/OpenPath-*.AppImage /opt/openpath/openpath.AppImage
  sudo install -Dm644 ./client/linux/installers/openpath.desktop /usr/share/applications/openpath.desktop
else
  echo "  No prebuilt GUI found — run dev GUI: cd client/linux && npm install && npm run dev"
  echo "  Or download from https://github.com/$REPO/releases"
fi

# Desktop file + icon
sudo install -Dm644 client/linux/installers/openpath.desktop /usr/share/applications/openpath.desktop 2>/dev/null || true
sudo update-desktop-database 2>/dev/null || true

# TUN permissions: allow non-root tun creation via group
sudo groupadd -f openpath 2>/dev/null || true
echo "TUN setup: use sudo for kernel TUN, or run unprivileged SOCKS fallback (auto)."

echo ""
echo "✓ Installed! Try:"
echo "  openpath config set psk YOUR_PSK"
echo "  openpath connect --server wss://cdn.yourdomain.com/ops"
echo "  openpath status"
echo "  openpath-gui  # or launcher: OpenPath VPN"
echo "See client/linux/README.md for full guide."
