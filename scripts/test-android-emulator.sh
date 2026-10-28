#!/usr/bin/env bash
# Called by the emulator workflow. All keys and addresses here are disposable test values.
set -euo pipefail
TMP=$(mktemp -d)
LISTENER=''
RELAY=''
TAP=''
UNTRUSTED_RELAY=''
cleanup() {
  if [ -n "$LISTENER" ]; then kill "$LISTENER" 2>/dev/null || true; fi
  if [ -n "$TAP" ]; then kill "$TAP" 2>/dev/null || true; wait "$TAP" 2>/dev/null || true; fi
  if [ -n "$UNTRUSTED_RELAY" ]; then kill "$UNTRUSTED_RELAY" 2>/dev/null || true; wait "$UNTRUSTED_RELAY" 2>/dev/null || true; fi
  if [ -n "$RELAY" ]; then kill "$RELAY" 2>/dev/null || true; wait "$RELAY" 2>/dev/null || true; fi
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
# Debug-only CA and key are public CI fixtures. Release builds do not trust them.
# The TCP tap observes the encrypted outer stream, then forwards to the real TLS relay.
mkfifo "$TMP/relay-ready" "$TMP/tap-ready" "$TMP/untrusted-ready"
exec 3<>"$TMP/relay-ready" 4<>"$TMP/tap-ready" 5<>"$TMP/untrusted-ready"
(cd server && exec env TEST_TLS_PORT=18444 node --import tsx tests/fixtures/stealth-test-server.ts) >&3 2>"$TMP/relay.err" &
RELAY=$!
if ! read -r -t 30 line <&3 || [ "$line" != 'TEST RELAY READY' ]; then
  cat "$TMP/relay.err"
  echo '::error::TLS relay failed to start'
  exit 1
fi
(cd server && exec env TEST_TAP_OUTPUT="$TMP/tls-observation.json" node tests/fixtures/stealth-tls-tap.mjs) >&4 2>"$TMP/tap.err" &
TAP=$!
if ! read -r -t 30 line <&4 || [ "$line" != 'TEST TLS TAP READY' ]; then
  cat "$TMP/tap.err"
  echo '::error::TLS observation tap failed to start'
  exit 1
fi
# A real relay with an otherwise valid IP certificate signed by an unknown CA:
# accepting it would bring up the VPN, so the test detects TLS trust regressions.
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj '/CN=OpenPath untrusted CI relay' \
  -addext 'subjectAltName=IP:10.0.2.2' -keyout "$TMP/untrusted.key" -out "$TMP/untrusted.crt" >/dev/null 2>&1
(cd server && exec env TEST_TLS_PORT=18445 TEST_TLS_KEY_FILE="$TMP/untrusted.key" \
  TEST_TLS_CERT_FILE="$TMP/untrusted.crt" TEST_TLS_ERRORS_FILE="$TMP/untrusted-handshake.log" \
  node --import tsx tests/fixtures/stealth-test-server.ts) >&5 2>"$TMP/untrusted.err" &
UNTRUSTED_RELAY=$!
if ! read -r -t 30 line <&5 || [ "$line" != 'TEST RELAY READY' ]; then
  cat "$TMP/untrusted.err"
  echo '::error::Untrusted TLS test relay failed to start'
  exit 1
fi
python3 -u - <<'PY' > "$TMP/server.log" 2>&1 &
import socket
with socket.socket() as server:
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(('10.203.0.1', 19430))
    server.listen(2)
    server.settimeout(120)
    for _ in range(2):
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
  cat "$TMP/server.log" "$TMP/relay.err" "$TMP/tap.err" "$TMP/untrusted.err"
  exit 1
fi
if [ ! -s "$TMP/untrusted-handshake.log" ]; then
  echo '::error::The untrusted-certificate test did not reach the TLS test relay'
  exit 1
fi
if ! node - "$TMP/tls-observation.json" <<'NODE'
const fs = require('node:fs');
const observations = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (observations.length < 2 || observations.some(s => !s.clientHello || !s.validRecords ||
    !s.applicationData || s.plaintextHttp || s.truncated)) {
  console.error('Unexpected TCP observation:', JSON.stringify(observations));
  process.exit(1);
}
console.log('Android outer connections used TLS records; the HTTP upgrade was not visible in TCP bytes.');
NODE
then
  echo '::error::Android Stealth did not produce the expected TLS-only outer connection'
  exit 1
fi
HANDSHAKE=$(sudo wg show optest0 latest-handshakes | awk '{print $2}')
if [ "${HANDSHAKE:-0}" = 0 ]; then
  echo '::error::The local WireGuard server did not record a handshake'
  exit 1
fi
ENDPOINT=$(sudo wg show optest0 endpoints | awk '{print $2}')
if [[ "$ENDPOINT" != 127.0.0.1:* ]]; then
  echo "::error::The final WireGuard endpoint was not the local Stealth relay: $ENDPOINT"
  exit 1
fi
echo 'Android Keystore, VPN permission, direct and TLS-relayed WireGuard traffic, no-fallback failure and disconnect verified on emulator.' 
