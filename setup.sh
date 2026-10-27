#!/usr/bin/env bash
# OpenPath VPN — one-command server setup (Linux / macOS / WSL)
#   git clone https://github.com/mob5824m-wq/OpenPath-VPN && cd OpenPath-VPN
#   chmod +x setup.sh && ./setup.sh
# No secrets needed — auto-installs, builds, generates PSK, starts server.
# Requires Node.js 18+ and npm.
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
SERVER="$ROOT/server"
PORT="${PORT:-4433}"
HOST="${HOST:-0.0.0.0}"
DEMO_PSK_DEFAULT="demo-student-key-do-not-use-prod"

# colors (disable on no-tty)
if [ -t 1 ]; then BOLD="\033[1m"; GREEN="\033[92m"; CYAN="\033[96m"; YELLOW="\033[93m"; RED="\033[91m"; RESET="\033[0m"; else BOLD=""; GREEN=""; CYAN=""; YELLOW=""; RED=""; RESET=""; fi
log(){ echo -e "${2:-}$1${RESET}"; }

cat <<'BANNER'
  ___                    ____        _   _     __   ____  _   _
 / _ \  _ __    ___  _  |  _ \  __ _| |_| |__  \ \ / / _ \| \ | |
| | | || '_ \  / _ \| '_|| |_) |/ _` | __| '_ \  \ V / | | |  \| |
| |_| || |_) ||  __/| |  |  __/| (_| | |_| | | |  | |  |_| | |\  |
 \___/ | .__/  \___||_|  |_|    \__,_|\__|_| |_|  |_| \___/|_| \_|
       |_|      GhostPath stealth VPN — git clone & go
BANNER
log "Root: $ROOT  Platform: $(uname -s) $(uname -m)" "$BOLD"

# args
NO_BUILD=""
USE_DOCKER=""
CUSTOM_PSK=""
CUSTOM_PORT=""
OPEN_BROWSER=""
for arg in "$@"; do case "$arg" in
  --no-build) NO_BUILD=1 ;;
  --docker) USE_DOCKER=1 ;;
  --psk=*) CUSTOM_PSK="${arg#--psk=}" ;;
  --port=*) CUSTOM_PORT="${arg#--port=}" ;;
  --duckdns-domain=*) DUCKDNS_DOMAIN="${arg#--duckdns-domain=}" ;;
  --duckdns-token=*) DUCKDNS_TOKEN="${arg#--duckdns-token=}" ;;
  --no-duckdns) NO_DUCKDNS=1 ;;
  --open) OPEN_BROWSER=1 ;;
  --help|-h) echo "Usage: ./setup.sh [--port=4433] [--psk=XXX] [--duckdns-domain=openpath42] [--duckdns-token=xxx] [--docker] [--no-build] [--open]"; exit 0 ;;
esac; done
[ -n "$CUSTOM_PORT" ] && PORT="$CUSTOM_PORT"

# docker shortcut
if [ -n "$USE_DOCKER" ]; then
  if command -v docker >/dev/null 2>&1; then
    log "\n[docker] docker compose up -d --build" "$BOLD"
    (cd "$ROOT" && docker compose up -d --build)
    log "  Up! Health: http://localhost:4433/health" "$GREEN"
    exit 0
  else
    log "docker not found, falling back to node" "$YELLOW"
  fi
fi

# 1. check node
log "\n[1/5] Checking Node.js + npm ..." "$BOLD"
if ! command -v node >/dev/null 2>&1; then
  log "  Node.js not found. Install from https://nodejs.org (v18+)" "$RED"
  log "  Ubuntu/Debian: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs" "$YELLOW"
  log "  macOS: brew install node@20" "$YELLOW"
  exit 1
fi
NODE_V=$(node -v)
NPM_V=$(npm -v)
log "  Found Node $NODE_V + npm $NPM_V" "$GREEN"
MAJOR=$(echo "$NODE_V" | sed 's/v//' | cut -d. -f1)
if [ "$MAJOR" -lt 18 ]; then log "  Warning: Node < 18, upgrade recommended" "$YELLOW"; fi

# 2. install
if [ -z "$NO_BUILD" ]; then
  log "\n[2/5] Installing server dependencies ..." "$BOLD"
  (cd "$SERVER" && npm install)
  log "\n[3/5] Building server (TypeScript -> dist) ..." "$BOLD"
  (cd "$SERVER" && npm run build 2>&1 || npx tsc --outDir dist) || {
    log "  Build failed — trying npx tsc ..." "$YELLOW"
    (cd "$SERVER" && npx tsc --outDir dist)
  }
else
  log "\n[skip] --no-build, using existing server/dist" "$YELLOW"
fi

# helper: configure duckdns .env
configure_duckdns() {
  local domain="$1" token="$2" psk="$3" port="$4"
  local envf="$ROOT/.env" example="$ROOT/.env.duckdns.example"
  if [ ! -f "$envf" ] && [ -f "$example" ]; then cp "$example" "$envf"; fi
  # set or update keys (portable, no -i differences)
  upsert_env() { # $1=key $2=value $3=file
    if grep -q "^$1=" "$3" 2>/dev/null; then
      tmp=$(mktemp); sed "s|^$1=.*|$1=$2|" "$3" > "$tmp" && mv "$tmp" "$3"
    else
      echo "$1=$2" >> "$3"
    fi
  }
  [ -n "$domain" ] && upsert_env "DUCKDNS_DOMAIN" "$domain" "$envf"
  [ -n "$domain" ] && upsert_env "PUBLIC_URL" "wss://$domain.duckdns.org/ops" "$envf"
  [ -n "$token" ] && upsert_env "DUCKDNS_TOKEN" "$token" "$envf"
  [ -n "$token" ] && upsert_env "CADDY_DUCKDNS_TOKEN" "$token" "$envf"
  [ -n "$psk" ] && upsert_env "DEMO_PSK" "$psk" "$envf"
  upsert_env "PORT" "$port" "$envf"
  upsert_env "OPS_PATH" "/ops" "$envf"
  log "  DuckDNS .env written: $envf (DOMAIN=$domain)" "$GREEN"
  if [ -n "$token" ] && [ -n "$domain" ] && [ -x "$ROOT/scripts/duckdns-update.sh" ]; then
    log "  Updating DuckDNS IP for $domain.duckdns.org ..." "$CYAN"
    DUCKDNS_DOMAIN="$domain" DUCKDNS_TOKEN="$token" bash "$ROOT/scripts/duckdns-update.sh" || log "  updater failed — run manually" "$YELLOW"
  fi
  log "  For TLS: docker compose -f docker-compose.duckdns.yml up -d" "$CYAN"
  log "  For cron: sudo ./scripts/install-duckdns-cron.sh $domain <token>" "$CYAN"
}

# 4. PSK
if [ -n "$CUSTOM_PSK" ]; then
  PSK="$CUSTOM_PSK"
  log "\n[4/5] Using provided PSK: $PSK" "$GREEN"
else
  # generate 32B base64url via node (portable) or openssl
  if command -v node >/dev/null 2>&1; then
    PSK=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")
  elif command -v openssl >/dev/null 2>&1; then
    PSK=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=' | tr -d '\n')
  else
    PSK="$DEMO_PSK_DEFAULT"
  fi
  log "\n[4/5] Generated fresh PSK: $PSK" "$GREEN"
  log "  (demo PSK also works: $DEMO_PSK_DEFAULT)" "$CYAN"
fi
echo "$PSK" > "$ROOT/.psk" 2>/dev/null || true
log "  Saved PSK to .psk (gitignored)" "$CYAN"

# --- DuckDNS installer prompt ---
# args already set DUCKDNS_DOMAIN/TOKEN if provided; allow env override
DUCKDNS_DOMAIN="${DUCKDNS_DOMAIN:-${DOMAIN:-${DUCKDNS_DOMAIN_ENV:-}}}"
DUCKDNS_TOKEN="${DUCKDNS_TOKEN:-${TOKEN:-}}"
# also allow existing .env values
if [ -z "$DUCKDNS_DOMAIN" ] && [ -f "$ROOT/.env" ]; then
  DUCKDNS_DOMAIN=$(grep "^DUCKDNS_DOMAIN=" "$ROOT/.env" 2>/dev/null | cut -d= -f2 | tr -d '"'"'"" | xargs || true)
  DUCKDNS_TOKEN=$(grep "^DUCKDNS_TOKEN=" "$ROOT/.env" 2>/dev/null | cut -d= -f2 | tr -d '"'"'"" | xargs || true)
fi
if [ -z "$NO_DUCKDNS" ] && [ -z "$DUCKDNS_DOMAIN" ] && [ -t 0 ]; then
  echo ""
  log "[DuckDNS] Want public URL https://YOURNAME.duckdns.org ? (free, FortiGate-friendly)" "$BOLD"
  log "  Create at https://www.duckdns.org -> add domain -> copy token" "$CYAN"
  printf "  DuckDNS domain (empty to skip, e.g., openpath42): "
  read -r ans || true
  if [ -n "$ans" ]; then
    DUCKDNS_DOMAIN=$(echo "$ans" | sed 's/\.duckdns\.org//g' | xargs)
    printf "  DuckDNS token: "
    read -r tok || true
    [ -n "$tok" ] && DUCKDNS_TOKEN="$tok"
  fi
fi
if [ -n "$DUCKDNS_DOMAIN" ]; then
  configure_duckdns "$DUCKDNS_DOMAIN" "$DUCKDNS_TOKEN" "$PSK" "$PORT"
else
  log "  Skipping DuckDNS (use --duckdns-domain=NAME --duckdns-token=TOKEN or docs/DUCKDNS.md)" "$CYAN"
fi

# pick port if busy
if command -v ss >/dev/null 2>&1; then
  if ss -tln | grep -q ":$PORT "; then
    log "  Port $PORT busy, trying $((PORT+1)) ..." "$YELLOW"
    PORT=$((PORT+1))
  fi
elif command -v lsof >/dev/null 2>&1; then
  if lsof -i :$PORT >/dev/null 2>&1; then
    log "  Port $PORT busy, trying $((PORT+1)) ..." "$YELLOW"
    PORT=$((PORT+1))
  fi
fi

# local IP
LOCAL_IP="localhost"
if command -v hostname >/dev/null 2>&1; then
  if command -v ip >/dev/null 2>&1; then LOCAL_IP=$(ip route get 1.1.1.1 2>/dev/null | grep -oP 'src \K[0-9.]+' | head -1) || LOCAL_IP="localhost"
  elif command -v ifconfig >/dev/null 2>&1; then LOCAL_IP=$(ifconfig | grep -oE 'inet (192\.168|10\.)[0-9.]+' | head -1 | awk '{print $2}') || LOCAL_IP="localhost"
  fi
  [ -z "$LOCAL_IP" ] && LOCAL_IP="localhost"
fi

WS_URL="wss://$LOCAL_IP:$PORT/ops?psk=$PSK&user=demo"
URI="openpath://$LOCAL_IP:$PORT/ops?psk=$PSK&user=demo#demo"

log "\n==============================================================" "$GREEN"
log "  OpenPath VPN Server is ready!  (no secrets needed)" "$GREEN$BOLD"
log "==============================================================" "$GREEN"
log "  Health:  http://localhost:$PORT/health" "$CYAN"
log "  Decoy:   http://localhost:$PORT/  (portfolio)" "$CYAN"
log "  Stats:   http://localhost:$PORT/api/stats" "$CYAN"
log "  Provision: POST http://localhost:$PORT/api/provision {\"user\":\"demo\"}" "$CYAN"
log "" ""
log "  PSK (share with clients): $PSK" "$BOLD"
log "  WSS URL: $WS_URL" "$YELLOW"
log "  URI:     $URI" "$YELLOW"
log "" ""
log "  Clients:" "$BOLD"
log "    openpath connect --server wss://localhost:$PORT/ops --psk $PSK" "$CYAN"
log "    or use URI above in any OpenPath client" "$CYAN"
log "" ""
log "  LAN (phones): http://$LOCAL_IP:$PORT/  wss://$LOCAL_IP:$PORT/ops" "$CYAN"
log "  Docker alt: docker compose up -d" "$CYAN"
log "  DuckDNS:  see docs/DUCKDNS.md" "$CYAN"
log "==============================================================" "$GREEN"

# 5. start
if [ ! -f "$SERVER/dist/index.js" ]; then
  log "  server/dist/index.js missing — build may have failed" "$RED"
fi
log "\n[5/5] Starting server on $HOST:$PORT  (Ctrl+C to stop)\n" "$BOLD"
log "  Demo users: demo / student  (PSK above)" "$YELLOW"
log "  Health: curl http://localhost:$PORT/health" "$CYAN"

if [ -n "$OPEN_BROWSER" ]; then
  (command -v xdg-open >/dev/null 2>&1 && xdg-open "http://localhost:$PORT/" &) || \
  (command -v open >/dev/null 2>&1 && open "http://localhost:$PORT/" &) || true
fi

export PORT HOST DEMO_PSK="$PSK" OPS_PATH="/ops" DECOY_TITLE="Alex Rivera — Photography Portfolio" DUCKDNS_DOMAIN="$DUCKDNS_DOMAIN" DUCKDNS_TOKEN="$DUCKDNS_TOKEN"
exec node "$SERVER/dist/index.js"
