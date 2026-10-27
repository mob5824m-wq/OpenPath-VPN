#!/usr/bin/env bash
# OpenPath VPN — SUB HOST setup (Linux / macOS / WSL)
#   git clone https://github.com/mob5824m-wq/OpenPath-VPN && cd OpenPath-VPN
#   ./setup-sub.sh --main http://MAIN_IP:4433 [--port 4434] [--psk SAME_AS_MAIN]
# Sub registers with main, heartbeats every 25s, appears in GET /api/hosts.
# App flow: GET main/api/hosts -> pick sub wssUrl -> connect.
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
SERVER="$ROOT/server"
PORT="${PORT:-4434}"
HOST="${HOST:-0.0.0.0}"
DEMO_PSK_DEFAULT="demo-student-key-do-not-use-prod"
if [ -t 1 ]; then BOLD="\033[1m"; GREEN="\033[92m"; CYAN="\033[96m"; YELLOW="\033[93m"; RED="\033[91m"; RESET="\033[0m"; else BOLD="";GREEN="";CYAN="";YELLOW="";RED="";RESET=""; fi
log(){ echo -e "${2:-}$1${RESET}"; }
cat <<'BANNER'
  ___                    ____        _   _     __   ____  _   _
                     [SUB HOST — registers with MAIN]
BANNER
MAIN_URL=""; CUSTOM_PORT=""; CUSTOM_PSK=""; CUSTOM_NAME=""; CUSTOM_REGION=""; PUBLIC_HOST=""; DUCKDNS_DOMAIN=""; DUCKDNS_TOKEN=""; USE_DOCKER=""; NO_BUILD=""; OPEN_BROWSER=""
for arg in "$@"; do case "$arg" in --main=*)MAIN_URL="${arg#--main=}";; --main)shift;MAIN_URL="$1";; --port=*)CUSTOM_PORT="${arg#--port=}";; --psk=*)CUSTOM_PSK="${arg#--psk=}";; --name=*)CUSTOM_NAME="${arg#--name=}";; --region=*)CUSTOM_REGION="${arg#--region=}";; --public-host=*)PUBLIC_HOST="${arg#--public-host=}";; --duckdns-domain=*)DUCKDNS_DOMAIN="${arg#--duckdns-domain=}";; --duckdns-token=*)DUCKDNS_TOKEN="${arg#--duckdns-token=}";; --docker)USE_DOCKER=1;; --no-build)NO_BUILD=1;; --open)OPEN_BROWSER=1;; --help|-h)echo "Usage: ./setup-sub.sh --main http://MAIN:4433 [--port=4434] [--psk=XXX] [--name=Sub1] [--region=home] [--public-host=IP] [--duckdns-domain=openpath-sub1] [--duckdns-token=xxx] [--docker]";exit 0;; esac; done
[ -z "$MAIN_URL" ] && { log "ERROR: --main required e.g. --main http://192.168.1.10:4433" "$RED"; exit 1; }
[ -n "$CUSTOM_PORT" ] && PORT="$CUSTOM_PORT"
log "Main: $MAIN_URL  Root: $ROOT" "$BOLD"
command -v node >/dev/null 2>&1 || { log "Node not found https://nodejs.org" "$RED"; exit 1; }
log "\n[1/5] Node $(node -v)" "$GREEN"
if [ -z "$NO_BUILD" ]; then log "\n[2/5] Installing ..." "$BOLD"; (cd "$SERVER" && npm install); log "\n[3/5] Building ..." "$BOLD"; (cd "$SERVER" && npm run build 2>&1 || npx tsc --outDir dist) || (cd "$SERVER" && npx tsc --outDir dist); fi
if [ -n "$CUSTOM_PSK" ]; then PSK="$CUSTOM_PSK"; log "\n[4/5] PSK: $PSK" "$GREEN";
elif [ -f "$ROOT/.psk" ]; then PSK=$(cat "$ROOT/.psk" | tr -d '\n'); log "\n[4/5] Reused PSK from .psk: $PSK" "$GREEN";
else PSK="$DEMO_PSK_DEFAULT"; log "\n[4/5] Demo PSK (shared with main): $PSK" "$YELLOW"; log "  Use --psk SAME_AS_MAIN for private" "$CYAN"; fi
if [ -n "$USE_DOCKER" ]; then
  [ -z "$DUCKDNS_DOMAIN" ] && { log "ERROR: --docker needs --duckdns-domain openpath-subX" "$RED"; exit 1; }
  log "\n[docker] Sub via docker-compose.sub.duckdns.yml for $DUCKDNS_DOMAIN.duckdns.org" "$BOLD"
  export SUB_DUCKDNS_DOMAIN="$DUCKDNS_DOMAIN" DUCKDNS_DOMAIN="$DUCKDNS_DOMAIN" DUCKDNS_TOKEN="${DUCKDNS_TOKEN:-$DUCKDNS_TOKEN}" MAIN_URL="$MAIN_URL" DEMO_PSK="$PSK" HOST_NAME="${CUSTOM_NAME:-Sub $DUCKDNS_DOMAIN}" HOST_REGION="${CUSTOM_REGION:-home}"
  if [ -f .env.sub ]; then docker compose --env-file .env.sub -f docker-compose.sub.duckdns.yml up -d --build; else docker compose -f docker-compose.sub.duckdns.yml up -d --build; fi
  log "  Done! https://$DUCKDNS_DOMAIN.duckdns.org/health -> registers to $MAIN_URL" "$GREEN"
  exit 0
fi
if [ -n "$DUCKDNS_DOMAIN" ]; then
  PUBLIC_HOST="$DUCKDNS_DOMAIN.duckdns.org"
  WSS_URL="wss://$PUBLIC_HOST/ops"
  log "\n==============================================================" "$GREEN"
  log "  SUB HOST (DuckDNS) will register with MAIN" "$GREEN$BOLD"
  log "==============================================================" "$GREEN"
  log "  Main:    $MAIN_URL" "$CYAN"
  log "  Sub DuckDNS: https://$PUBLIC_HOST → $WSS_URL" "$CYAN"
  log "  App: GET $MAIN_URL/api/hosts -> wss://$PUBLIC_HOST/ops" "$CYAN"
  log "==============================================================" "$GREEN"
  [ -n "$OPEN_BROWSER" ] && (command -v xdg-open >/dev/null && xdg-open "http://localhost:$PORT/health" & ) || true
  export PORT HOST DEMO_PSK="$PSK" ROLE="sub" MAIN_URL="$MAIN_URL" HOST_NAME="${CUSTOM_NAME:-Sub $PUBLIC_HOST}" HOST_ID="sub-$PUBLIC_HOST-$PORT" PUBLIC_HOST="$PUBLIC_HOST" PUBLIC_WSS="$WSS_URL" DUCKDNS_DOMAIN="$DUCKDNS_DOMAIN" SUB_DUCKDNS_DOMAIN="$DUCKDNS_DOMAIN" DUCKDNS_TOKEN="$DUCKDNS_TOKEN" HOST_REGION="${CUSTOM_REGION:-home}" OPS_PATH="/ops"
else
  if [ -z "$PUBLIC_HOST" ]; then if command -v ip >/dev/null 2>&1; then PUBLIC_HOST=$(ip route get 1.1.1.1 2>/dev/null | grep -oP 'src \K[0-9.]+' | head -1); fi; [ -z "$PUBLIC_HOST" ] && PUBLIC_HOST="localhost"; fi
  WSS_URL="wss://$PUBLIC_HOST:$PORT/ops"
  log "\n==============================================================" "$GREEN"
  log "  SUB HOST will register with MAIN" "$GREEN$BOLD"
  log "==============================================================" "$GREEN"
  log "  Main:    $MAIN_URL" "$CYAN"
  log "  Sub URL: $WSS_URL" "$CYAN"
  log "  Health:  http://$PUBLIC_HOST:$PORT/health" "$CYAN"
  log "  App: GET $MAIN_URL/api/hosts -> sees this sub -> wss://$PUBLIC_HOST:$PORT/ops" "$CYAN"
  log "  Tip: give this sub its own DuckDNS: --duckdns-domain openpath-sub1 --duckdns-token xxx" "$CYAN"
  log "==============================================================" "$GREEN"
  [ -n "$OPEN_BROWSER" ] && (command -v xdg-open >/dev/null && xdg-open "http://localhost:$PORT/health" & ) || true
  export PORT HOST DEMO_PSK="$PSK" ROLE="sub" MAIN_URL="$MAIN_URL" HOST_NAME="${CUSTOM_NAME:-Sub $PUBLIC_HOST:$PORT}" HOST_ID="sub-$PUBLIC_HOST-$PORT" PUBLIC_HOST="$PUBLIC_HOST" PUBLIC_WSS="$WSS_URL" HOST_REGION="${CUSTOM_REGION:-home}" OPS_PATH="/ops"
fi
log "\n[5/5] Starting SUB on $HOST:$PORT -> $MAIN_URL (Ctrl+C to stop)\n" "$BOLD"
exec node "$SERVER/dist/index.js"
