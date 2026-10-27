#!/usr/bin/env bash
# OpenPath VPN — MAIN HOST setup (Linux / macOS / WSL)
#   git clone https://github.com/mob5824m-wq/OpenPath-VPN && cd OpenPath-VPN
#   chmod +x setup-main.sh && ./setup-main.sh
# Main = directory: app GET /api/hosts gets list of sub-hosts.
# Sub-hosts register via POST /api/hosts/register and heartbeat.
# No secrets needed.
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
SERVER="$ROOT/server"
PORT="${PORT:-4433}"
HOST="${HOST:-0.0.0.0}"
DEMO_PSK_DEFAULT="demo-student-key-do-not-use-prod"
if [ -t 1 ]; then BOLD="\033[1m"; GREEN="\033[92m"; CYAN="\033[96m"; YELLOW="\033[93m"; RED="\033[91m"; RESET="\033[0m"; else BOLD="";GREEN="";CYAN="";YELLOW="";RED="";RESET=""; fi
log(){ echo -e "${2:-}$1${RESET}"; }
cat <<'BANNER'
  ___                    ____        _   _     __   ____  _   _
                     [MAIN HOST — directory for sub-hosts]
BANNER
log "Root: $ROOT  $(uname -s)" "$BOLD"
CUSTOM_PORT=""; CUSTOM_PSK=""; CUSTOM_NAME=""; CUSTOM_REGION=""; NO_BUILD=""; OPEN_BROWSER=""
for arg in "$@"; do case "$arg" in --port=*)CUSTOM_PORT="${arg#--port=}";; --psk=*)CUSTOM_PSK="${arg#--psk=}";; --name=*)CUSTOM_NAME="${arg#--name=}";; --region=*)CUSTOM_REGION="${arg#--region=}";; --no-build)NO_BUILD=1;; --duckdns-domain=*)DUCKDNS_DOMAIN="${arg#--duckdns-domain=}";; --duckdns-token=*)DUCKDNS_TOKEN="${arg#--duckdns-token=}";; --no-duckdns)NO_DUCKDNS=1;; --open)OPEN_BROWSER=1;; --help|-h)echo "Usage: ./setup-main.sh [--port=4433] [--psk=XXX] [--name=MyMain] [--region=us-east] [--no-build] [--open]";exit 0;; esac; done
[ -n "$CUSTOM_PORT" ] && PORT="$CUSTOM_PORT"
log "\n[1/5] Checking Node.js ..." "$BOLD"
command -v node >/dev/null 2>&1 || { log "Node not found https://nodejs.org" "$RED"; exit 1; }
log "  Node $(node -v) npm $(npm -v)" "$GREEN"
if [ -z "$NO_BUILD" ]; then
  log "\n[2/5] Installing deps ..." "$BOLD"; (cd "$SERVER" && npm install)
  log "\n[3/5] Building ..." "$BOLD"; (cd "$SERVER" && npm run build 2>&1 || npx tsc --outDir dist) || (cd "$SERVER" && npx tsc --outDir dist)
fi
if [ -n "$CUSTOM_PSK" ]; then PSK="$CUSTOM_PSK"; log "\n[4/5] PSK: $PSK" "$GREEN"; else
  PSK=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"); log "\n[4/5] Generated PSK: $PSK" "$GREEN"; fi
echo "$PSK" > "$ROOT/.psk" 2>/dev/null || true
# DuckDNS for MAIN
if [ -z "$NO_DUCKDNS" ] && [ -z "$DUCKDNS_DOMAIN" ] && [ -t 0 ]; then
  echo ""; log "[DuckDNS] Public URL for MAIN? (https://www.duckdns.org)" "$BOLD"; printf "  DuckDNS domain (empty to skip): "; read -r ans || true; if [ -n "$ans" ]; then DUCKDNS_DOMAIN=$(echo "$ans" | sed "s/\.duckdns\.org//g" | xargs); printf "  DuckDNS token: "; read -r tok || true; [ -n "$tok" ] && DUCKDNS_TOKEN="$tok"; fi; fi
if [ -n "$DUCKDNS_DOMAIN" ]; then
  envf="$ROOT/.env"; [ ! -f "$envf" ] && [ -f "$ROOT/.env.duckdns.example" ] && cp "$ROOT/.env.duckdns.example" "$envf"
  upsert(){ if grep -q "^$1=" "$3" 2>/dev/null; then tmp=$(mktemp); sed "s|^$1=.*|$1=$2|" "$3" > "$tmp" && mv "$tmp" "$3"; else echo "$1=$2" >> "$3"; fi; };
  upsert "DUCKDNS_DOMAIN" "$DUCKDNS_DOMAIN" "$envf"; upsert "PUBLIC_URL" "wss://$DUCKDNS_DOMAIN.duckdns.org/ops" "$envf"; [ -n "$DUCKDNS_TOKEN" ] && upsert "DUCKDNS_TOKEN" "$DUCKDNS_TOKEN" "$envf" && upsert "CADDY_DUCKDNS_TOKEN" "$DUCKDNS_TOKEN" "$envf"; upsert "DEMO_PSK" "$PSK" "$envf"; log "  DuckDNS .env written ($DUCKDNS_DOMAIN.duckdns.org)" "$GREEN"; fi
if command -v ip >/dev/null 2>&1; then LOCAL_IP=$(ip route get 1.1.1.1 2>/dev/null | grep -oP 'src \K[0-9.]+' | head -1); fi
[ -z "$LOCAL_IP" ] && LOCAL_IP="localhost"
log "\n==============================================================" "$GREEN"
log "  MAIN HOST ready — apps fetch sub-host list here" "$GREEN$BOLD"
log "==============================================================" "$GREEN"
log "  Health: http://localhost:$PORT/health" "$CYAN"
log "  Hosts:  http://localhost:$PORT/api/hosts  <- app calls this" "$CYAN"
log "  LAN:    http://$LOCAL_IP:$PORT/api/hosts" "$CYAN"
log "  PSK: $PSK" "$BOLD"
log "  Subs run: ./setup-sub.sh --main http://$LOCAL_IP:$PORT --port 4434" "$YELLOW"
log "==============================================================" "$GREEN"
[ -n "$OPEN_BROWSER" ] && (command -v xdg-open >/dev/null && xdg-open "http://localhost:$PORT/api/hosts" & ) || true
export PORT HOST DEMO_PSK="$PSK" ROLE="main" HOST_NAME="${CUSTOM_NAME:-OpenPath Main}" HOST_ID="main-$HOST-$PORT" HOST_REGION="${CUSTOM_REGION:-us-east}" OPS_PATH="/ops"
log "\n[5/5] Starting MAIN on $HOST:$PORT (Ctrl+C to stop)\n" "$BOLD"
exec node "$SERVER/dist/index.js"
