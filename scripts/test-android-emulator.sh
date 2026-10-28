#!/usr/bin/env bash
# Called by the emulator workflow. All keys and addresses here are disposable test values.
set -euo pipefail
TMP=$(mktemp -d)
LISTENER=''
cleanup() {
  if [ -n "$LISTENER" ]; then kill "$LISTENER" 2>/dev/null || true; fi
  sudo ip link del optest0 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT
wg genkey | tee "$TMP/server.key" | wg pubkey > "$TMP/server.pub"
wg genkey | tee "$TMP/client.key" | wg pubkey > "$TMP/client.pub"
sudo ip link add optest0 type wireguard
sudo ip address add 10.203.0.1/24 dev optest0
sudo wg set optest0 listen-port 51820 private-key "$TMP/server.key" \
  peer "$(cat "$TMP/client.pub")" allowed-ips 10.203.0.2/32
sudo ip link set optest0 up
cat > "$TMP/profile.conf" <<PROFILE
[Interface]
PrivateKey = $(cat "$TMP/client.key")
Address = 10.203.0.2/32, fd70::2/128
DNS = 1.1.1.1
[Peer]
PublicKey = $(cat "$TMP/server.pub")
Endpoint = 10.0.2.2:51820
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25
PROFILE
python3 -u - <<'PY' > "$TMP/server.log" 2>&1 &
import socket
with socket.socket() as server:
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(('10.203.0.1', 19430))
    server.listen(1)
    server.settimeout(90)
    conn, _ = server.accept()
    with conn:
        if conn.recv(8) != b'openpath':
            raise RuntimeError('Unexpected test message')
        conn.sendall(b'ok')
PY
LISTENER=$!
adb install -r client/android/app/build/outputs/apk/debug/app-debug.apk
adb install -r client/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb shell appops set com.openpath.vpn ACTIVATE_VPN allow
PROFILE=$(base64 -w0 "$TMP/profile.conf")
set +e
adb shell am instrument -w -r -e class com.openpath.vpn.VpnIntegrationTest -e profile "$PROFILE" \
  com.openpath.vpn.test/androidx.test.runner.AndroidJUnitRunner 2>&1 | tee "$TMP/test.log"
status=${PIPESTATUS[0]}
set -e
if [ "$status" -ne 0 ] || ! grep -Eq '^OK \(1 test\)' "$TMP/test.log"; then
  echo "::error::Android emulator WireGuard test failed: $(tail -n 12 "$TMP/test.log" | tr '\n\r' '  ')"
  cat "$TMP/server.log"
  exit 1
fi
HANDSHAKE=$(sudo wg show optest0 latest-handshakes | awk '{print $2}')
if [ "${HANDSHAKE:-0}" = 0 ]; then
  echo '::error::The local WireGuard server did not record a handshake'
  exit 1
fi
echo 'Android Keystore, VPN permission, WireGuard handshake, TCP traffic and disconnect verified on emulator.'
