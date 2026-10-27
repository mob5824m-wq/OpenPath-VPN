#!/usr/bin/env bash
# Install systemd timer (or cron fallback) to refresh DuckDNS every 5 minutes.
# Usage: sudo ./scripts/install-duckdns-cron.sh [DOMAIN] [TOKEN]
#        If DOMAIN/TOKEN omitted, reads .env
# Requires: systemd (most modern distros) — falls back to crontab on non-systemd hosts.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DOMAIN="${1:-${DUCKDNS_DOMAIN:-}}"
TOKEN="${2:-${DUCKDNS_TOKEN:-}}"

# Try .env if not passed
if [ -z "$DOMAIN" ] || [ -z "$TOKEN" ]; then
  if [ -f "$ROOT/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    source "$ROOT/.env" 2>/dev/null || true
    set +a
    DOMAIN="${DOMAIN:-${DUCKDNS_DOMAIN:-}}"
    TOKEN="${TOKEN:-${DUCKDNS_TOKEN:-}}"
  fi
fi

if [ -z "$DOMAIN" ] || [ -z "$TOKEN" ]; then
  echo "Usage: sudo $0 [DOMAIN] [TOKEN]" >&2
  echo "  or set DUCKDNS_DOMAIN/DUCKDNS_TOKEN env or in $ROOT/.env" >&2
  echo "  Copy template: cp .env.duckdns.example .env && nano .env" >&2
  exit 2
fi

echo "→ Installing DuckDNS updater for $DOMAIN.duckdns.org every 5 minutes"

# Ensure script is executable
chmod +x "$ROOT/scripts/duckdns-update.sh"

# Make sure log dir writable
mkdir -p "$ROOT/logs"
touch "$ROOT/logs/duckdns.log"
chmod a+rw "$ROOT/logs/duckdns.log" 2>/dev/null || true

if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
  # systemd timer+service
  SERVICE="/etc/systemd/system/duckdns-update.service"
  TIMER="/etc/systemd/system/duckdns-update.timer"
  WRAPPER="/usr/local/bin/duckdns-update-wrapper.sh"

  cat > "$WRAPPER" <<WRAP
#!/usr/bin/env bash
set -euo pipefail
export DUCKDNS_DOMAIN="$DOMAIN"
export DUCKDNS_TOKEN="$TOKEN"
exec "$ROOT/scripts/duckdns-update.sh"
WRAP
  chmod +x "$WRAPPER"

  cat > "$SERVICE" <<EOF
[Unit]
Description=DuckDNS IP updater for $DOMAIN.duckdns.org (OpenPath VPN)
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
ExecStart=$WRAPPER
User=root
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

  cat > "$TIMER" <<EOF
[Unit]
Description=Refresh DuckDNS every 5 minutes

[Timer]
OnBootSec=1min
OnUnitActiveSec=5min
RandomizedDelaySec=30
Persistent=true

[Install]
WantedBy=timers.target
EOF

  systemctl daemon-reload
  systemctl enable --now duckdns-update.timer
  systemctl start duckdns-update.service || true
  echo ""
  echo "✓ Installed systemd timer:"
  systemctl status duckdns-update.timer --no-pager | head -20
  echo ""
  echo "  Logs:  journalctl -u duckdns-update -f"
  echo "         cat $ROOT/logs/duckdns.log"
  echo "  Test:  sudo systemctl start duckdns-update.service && journalctl -u duckdns-update -n 20"
else
  # cron fallback
  if ! command -v crontab >/dev/null 2>&1; then
    echo "No systemd and no crontab — install cron or run manually:" >&2
    echo "  DUCKDNS_DOMAIN=$DOMAIN DUCKDNS_TOKEN=*** $ROOT/scripts/duckdns-update.sh" >&2
    exit 1
  fi
  # Write token into a protected file read by cron job (cron env not persistent)
  ENV_FILE="/etc/duckdns.env"
  cat > "$ENV_FILE" <<EOF
DUCKDNS_DOMAIN=$DOMAIN
DUCKDNS_TOKEN=$TOKEN
EOF
  chmod 600 "$ENV_FILE"
  CRON_LINE="*/5 * * * * set -a; source $ENV_FILE; $ROOT/scripts/duckdns-update.sh >> $ROOT/logs/duckdns.log 2>&1"
  # Avoid duplicates
  (crontab -l 2>/dev/null | grep -v duckdns-update.sh; echo "$CRON_LINE") | crontab -
  echo "✓ Installed crontab (*/5 min):"
  crontab -l | grep duckdns
  echo "  Logs: cat $ROOT/logs/duckdns.log ; journal: n/a (cron)"
fi

echo ""
echo "  Public URL: https://$DOMAIN.duckdns.org"
echo "  Check: nslookup $DOMAIN.duckdns.org"
echo "  One-shot test: DUCKDNS_DOMAIN=$DOMAIN DUCKDNS_TOKEN=*** $ROOT/scripts/duckdns-update.sh"
