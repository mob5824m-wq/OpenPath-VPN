#!/usr/bin/env bash
# Update DuckDNS with current public IP — for OpenPath VPN DuckDNS hosting.
# Reads DUCKDNS_DOMAIN + DUCKDNS_TOKEN from env or .env in repo root.
# Usage:  DUCKDNS_DOMAIN=foo DUCKDNS_TOKEN=xxx ./scripts/duckdns-update.sh
#         ./scripts/duckdns-update.sh   # reads .env at OpenPath-VPN root
# Returns: prints OK or KO from DuckDNS; exit 0 on OK, 1 on KO.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$ROOT/logs"
LOG_FILE="$LOG_DIR/duckdns.log"

# Load .env if present and vars not already in env
if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env" 2>/dev/null || true
  set +a
fi

DOMAIN="${DUCKDNS_DOMAIN:-}"
TOKEN="${DUCKDNS_TOKEN:-}"
# Caddy variant env name
if [ -z "$TOKEN" ] && [ -n "${CADDY_DUCKDNS_TOKEN:-}" ]; then
  TOKEN="$CADDY_DUCKDNS_TOKEN"
fi

if [ -z "$DOMAIN" ] || [ -z "$TOKEN" ]; then
  echo "ERROR: DUCKDNS_DOMAIN and DUCKDNS_TOKEN must be set (env or $ROOT/.env)" >&2
  echo "  Create domain at https://www.duckdns.org and copy your token." >&2
  echo "  cp .env.duckdns.example .env && edit DUCKDNS_DOMAIN + DUCKDNS_TOKEN" >&2
  exit 2
fi

# Detect current public IP (try several providers, prefer v4)
detect_ip() {
  local ip=""
  for url in "https://api.ipify.org" "https://checkip.amazonaws.com" "https://ifconfig.me/ip" "https://api.myip.com"; do
    ip=$(curl -fsS --max-time 5 "$url" 2>/dev/null | tr -d '[:space:]' | head -c 64 || true)
    # Validate roughly looks like IP
    if [[ "$ip" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]] || [[ "$ip" =~ ^[0-9a-fA-F:]+$ ]]; then
      # myip.com returns json like {"ip":"x","cc":".."} — extract
      if [[ "$ip" == *"\"ip\""* ]]; then
        ip=$(echo "$ip" | grep -oE '[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}' | head -1 || true)
      fi
      if [ -n "$ip" ]; then
        echo "$ip"
        return 0
      fi
    fi
  done
  # Fallback: DuckDNS empty ip param means auto-detect on their side
  echo ""
}

# Allow manual IP override
IP="${DUCKDNS_IP:-}"
if [ -z "$IP" ]; then
  IP="$(detect_ip || true)"
fi

# Some DuckDNS setups accept comma-separated domains (max 5). Pass as-is.
# Verbose flag for debugging: DUCKDNS_VERBOSE=1
VERBOSE="${DUCKDNS_VERBOSE:-}"

# Build URL
UPDATE_URL="https://www.duckdns.org/update?domains=${DOMAIN}&token=${TOKEN}"
if [ -n "$IP" ]; then
  UPDATE_URL="${UPDATE_URL}&ip=${IP}"
fi
# Optional ipv6
if [ -n "${DUCKDNS_IPV6:-}" ]; then
  UPDATE_URL="${UPDATE_URL}&ipv6=${DUCKDNS_IPV6}"
fi

# Call DuckDNS
RESP=$(curl -fsS --max-time 10 "$UPDATE_URL" 2>&1 || echo "CURL_FAIL:$?")
# DuckDNS replies with exactly "OK" or "KO" (with optional IP echo in some cases)
RESP_TRIM=$(echo "$RESP" | tr -d ' \r\n' | head -c 32)

TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

# Log
mkdir -p "$LOG_DIR"
LOG_LINE="[$TIMESTAMP] domain=$DOMAIN ip=${IP:-auto} resp=$RESP_TRIM"
echo "$LOG_LINE" >> "$LOG_FILE"
if [ -n "${VERBOSE:-}" ]; then
  echo "  url: https://www.duckdns.org/update?domains=$DOMAIN&token=***&ip=${IP:-auto}" >&2
fi

# Rotate log if huge (>5MB)
if [ -f "$LOG_FILE" ] && [ "$(wc -c < "$LOG_FILE")" -gt 5242880 ]; then
  mv "$LOG_FILE" "$LOG_FILE.1" 2>/dev/null || true
fi

if [[ "$RESP_TRIM" == OK* ]]; then
  echo "OK ${IP:-auto} — $DOMAIN.duckdns.org updated"
  exit 0
else
  echo "KO — DuckDNS update failed: $RESP_TRIM (check DUCKDNS_DOMAIN/TOKEN)" >&2
  echo "  Response was: $RESP" >&2
  exit 1
fi
