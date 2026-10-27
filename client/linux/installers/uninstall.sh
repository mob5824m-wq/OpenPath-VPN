#!/usr/bin/env bash
set -e
echo "Removing OpenPath VPN (Linux)..."
sudo rm -f /usr/local/bin/openpath /usr/bin/openpath-gui /opt/openpath/openpath.AppImage
sudo rm -f /usr/share/applications/openpath.desktop
sudo dpkg -r openpath-vpn 2>/dev/null || sudo rpm -e openpath-vpn 2>/dev/null || true
rm -rf ~/.config/openpath/openpath.pid
echo "Removed. Config kept at ~/.config/openpath/config.json (delete manually to wipe PSK)."
