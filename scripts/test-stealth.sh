#!/usr/bin/env bash
# Simulate FortiGate DPI checks against OpenPath server
set -e
TARGET=${1:-localhost:4433}
echo "=== OpenPath Stealth Test against $TARGET ==="
echo "[1] Decoy probe (no auth) should return 200 portfolio..."
curl -s "http://$TARGET/" | head -n 2 | grep -qi "html" && echo "  ✓ Decoy 200 OK" || echo "  ✗ Decoy failed"
echo "[2] Active probe with bad HMAC should get 404/tarpit..."
code=$(curl -s -o /dev/null -w "%{http_code}" "http://$TARGET/ops?auth=bad.token.here&user=demo")
[[ "$code" == "404" ]] && echo "  ✓ Probe rejected (404)" || echo "  → got $code (may be 426 upgrade required — also stealth)"
echo "[3] Valid handshake should upgrade..."
echo "  (Manual: connect via dashboard at http://localhost:5173 — verify TLSv1.3 + WS in Wireshark)"
echo "=== Done — see docs/BYPASS_TECHNIQUES.md ==="
