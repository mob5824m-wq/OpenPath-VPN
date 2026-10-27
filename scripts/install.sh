#!/usr/bin/env bash
set -e
echo "OpenPath quick install — server + web preview"
# DuckDNS quick config: if DUCKDNS_DOMAIN/TOKEN env set, write .env before up
if [ -n "$DUCKDNS_DOMAIN" ] && [ -f ".env.duckdns.example" ]; then
  echo "→ Configuring DuckDNS $DUCKDNS_DOMAIN.duckdns.org from env"
  cp .env.duckdns.example .env 2>/dev/null || true
  sed -i "s/^DUCKDNS_DOMAIN=.*/DUCKDNS_DOMAIN=$DUCKDNS_DOMAIN/" .env
  if [ -n "$DUCKDNS_TOKEN" ]; then sed -i "s/^DUCKDNS_TOKEN=.*/DUCKDNS_TOKEN=$DUCKDNS_TOKEN/" .env; fi
  bash scripts/duckdns-update.sh 2>/dev/null || true
fi
docker compose up --build -d 2>/dev/null || {
  echo "Docker not available — running bare Node:"
  (cd server && npm install && npm run build && PORT=4433 node dist/index.js) &
  (cd client/web && npm install && npm run dev) &
  wait
}
