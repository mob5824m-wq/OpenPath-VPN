#!/usr/bin/env bash
# Simulate FortiGate DPI/App Control/FortiGuard checks offline — OpenPath Fortinet profile
# Usage: ./scripts/test-fortinet.sh --target cdn.openpath.example.com:443 [--fortinet-profile chrome124]
set -e
TARGET=${2:-cdn.openpath.example.com:443}
PROFILE=${4:-chrome124}
HOST=$(echo "$TARGET" | cut -d: -f1)
PORT=$(echo "$TARGET" | cut -d: -f2 -s); PORT=${PORT:-443}

echo "=== OpenPath FortiGate Simulation — target $HOST:$PORT profile $PROFILE ==="

echo "[1] FortiGuard category check (decoy should be Business/CDN or Education, not Proxy Avoidance)"
RESP=$(curl -sk "https://$HOST/" | head -n 1 || true)
if echo "$RESP" | grep -qi "html"; then echo "  ✓ Decoy returned HTML (FortiGuard would see 200 portfolio)"; else echo "  ✗ Decoy no HTML — check server on :443"; fi
echo "  Hint: submit $HOST to https://fortiguard.com/webfilter as Education/Reference to avoid Proxy Avoidance"

echo "[2] SNI allowlist (FortiGate Default allows Google/Microsoft/Cloudflare, blocks unknown VPN SNI)"
for SNI in "cdn.$HOST" "$HOST" "ajax.googleapis.com" "www.gstatic.com" "www.microsoft.com" "cloudflare-dns.com"; do
  echo "  Testing SNI=$SNI ..."
  echo | timeout 5 openssl s_client -connect "$HOST:$PORT" -servername "$SNI" -quiet 2>&1 | head -n 1 | grep -qi "Verification\|Protocol" && echo "    → SNI $SNI: TLS ok (FortiGate would Allow)" || echo "    → SNI $SNI: no TLS banner (check firewall)"
done

echo "[3] JA3 fingerprint (App Control maps Go/Node JA3 to Unknown/Proxy; Chrome JA3 to Browser/Allow)"
echo "  Expect: JA3 for $PROFILE maps to Chrome/Safari on ja3er.com (not Unknown)"
echo "  Capture: sudo tcpdump -i any port $PORT -w /tmp/fortinet.pcap & openpath connect --fortinet; then:"
echo "  python3 scripts/ja3.py /tmp/fortinet.pcap  # or https://ja3er.com/json/<JA3>"
echo "  FortiGate App Control rule: Application=SSL.BROWSER / Cloudflare → Allow (not Proxy.VPN)"

echo "[4] Active probe without PSK (FortiGate IPS should not fingerprint as VPN on decoy)"
CODE=$(curl -sk -o /dev/null -w "%{http_code}" "https://$HOST/ops?auth=bad.token&user=demo" --connect-timeout 5 || echo "000")
if [ "$CODE" = "404" ] || [ "$CODE" = "200" ] || [ "$CODE" = "426" ]; then echo "  ✓ Probe rejected/decayed (FortiGate IPS: no VPN signature, just 404/426 portfolio)"; else echo "  → got HTTP $CODE (expected 404/426 for unauth)"; fi

echo "[5] Long-lived flow rotation (FortiGate QoS kills >60s websocket; client must rotate TLS)"
echo "  Check: server sends fresh TLS ticket every 5-15 min — FortiGate logs multiple short Allow flows"
echo "  Live: FortiGate FortiView → Policy Hit Count should climb on Allow, not Deny"

echo "[6] QUIC block (FortiGate config application quic often Block → TCP fallback must work)"
echo "  Fortinet profile defaults QUIC off (--fortinet sets quic=false), pure TCP 443"

echo "[7] Explicit proxy via FortiGate web-proxy (FortiGate may force CONNECT via proxy.school:8080)"
if [ -n "$http_proxy" ] || [ -n "$HTTP_PROXY" ]; then echo "  Detected http_proxy=$http_proxy → CLI will auto CONNECT (FortiGate logs CONNECT to Cloudflare → Allow)"; else echo "  No proxy env — if school uses PAC, set: export HTTPS_PROXY=http://proxy.school:8080"; fi

echo "[8] Deep Inspection CA (FortiGate may install FortiCA on managed devices)"
CERT_SUBJ=$(echo | timeout 5 openssl s_client -connect "$HOST:$PORT" -servername "$HOST" 2>/dev/null | openssl x509 -noout -issuer 2>/dev/null || true)
echo "  Issuer: ${CERT_SUBJ:-unknown (check with openssl s_client)}"
if echo "$CERT_SUBJ" | grep -qi "FortiGate\|Fortinet\|FG[0-9]"; then echo "  ⚠ Deep inspection ON (FortiCA MITM) — inner OPSP ChaCha20 still encrypted, double-encryption"; else echo "  ✓ No FortiCA (certificate-inspection only or BYOD) — full privacy"; fi

echo "[9] FortiGuard IPS signature absence (OpenPath should not match Proxy.VPN, Shadowsocks, VLESS signatures)"
echo "  Verify pcap has no 148B WireGuard init, no OpenVPN opcode 0x38, no VLESS UUID pattern"
echo "  tcpdump -r /tmp/fortinet.pcap -l 2>/dev/null | wc -l ; strings fortinet.pcap | grep -i proxy || echo '  ✓ No IPS trigger strings'"

echo ""
echo "=== Done — full guide: docs/FORTINET.md ==="
echo "If FortiGate still blocks, rotate SNI: openpath config set sni www.gstatic.com ; openpath connect --fortinet"
