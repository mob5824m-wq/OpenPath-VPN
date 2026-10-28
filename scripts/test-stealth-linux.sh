#!/usr/bin/env bash
# Run under sudo unshare -mn. All network interfaces, keys and CA are disposable.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
RELAY=''
cleanup() {
  if [ -n "$RELAY" ]; then kill "$RELAY" 2>/dev/null || true; wait "$RELAY" 2>/dev/null || true; fi
  ip netns del openpathclient 2>/dev/null || true
  ip netns del openpathserver 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT
mkdir -p /run/netns
mount -t tmpfs tmpfs /run/netns
ip netns add openpathclient
ip netns add openpathserver
ip link add ceth type veth peer name seth
ip link set ceth netns openpathclient
ip link set seth netns openpathserver
ip -n openpathclient link set lo up
ip -n openpathserver link set lo up
ip -n openpathclient addr add 192.0.2.2/24 dev ceth
ip -n openpathserver addr add 192.0.2.1/24 dev seth
ip -n openpathclient link set ceth up
ip -n openpathserver link set seth up
ip -n openpathclient route add default via 192.0.2.1 dev ceth
ip -n openpathserver addr add 198.51.100.1/32 dev lo
ip -n openpathserver addr add 198.18.0.1/32 dev lo
wg genkey | tee "$TMP/client.key" | wg pubkey > "$TMP/client.pub"
wg genkey | tee "$TMP/server.key" | wg pubkey > "$TMP/server.pub"
ip -n openpathserver link add wgsrv type wireguard
ip -n openpathserver addr add 10.203.0.1/24 dev wgsrv
ip netns exec openpathserver wg set wgsrv listen-port 51820 private-key "$TMP/server.key" \
  peer "$(cat "$TMP/client.pub")" allowed-ips 10.203.0.2/32
ip -n openpathserver link set wgsrv up
mkfifo "$TMP/ready"
exec 3<>"$TMP/ready"
(cd "$ROOT/server" && exec ip netns exec openpathserver node --import tsx tests/fixtures/stealth-test-server.ts) >&3 2>"$TMP/relay.err" &
RELAY=$!
if ! read -r -t 30 line <&3 || [ "$line" != 'TEST RELAY READY' ]; then
  cat "$TMP/relay.err"
  echo 'Relay did not start' >&2
  exit 1
fi
ip netns exec openpathclient env CLIENT_KEY="$TMP/client.key" SERVER_PUBLIC="$(cat "$TMP/server.pub")" RELAY_PID="$RELAY" \
  SSL_CERT_FILE="$ROOT/client/android/app/src/debug/res/raw/stealth_test_ca.pem" \
  PYTHONPATH="$ROOT/client/native${PYTHONPATH:+:$PYTHONPATH}" python3 "$ROOT/scripts/test-stealth-linux.py"
ip netns exec openpathserver wg show wgsrv latest-handshakes
