#!/usr/bin/env bash
set -e
echo "OpenPath quick install — server + web preview"
docker compose up --build -d 2>/dev/null || {
  echo "Docker not available — running bare Node:"
  (cd server && npm install && npm run build && PORT=4433 node dist/index.js) &
  (cd client/web && npm install && npm run dev) &
  wait
}
