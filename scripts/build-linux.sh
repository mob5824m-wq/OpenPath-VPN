#!/usr/bin/env bash
set -e
ROOT=$(cd "$(dirname $0)/.." && pwd)
echo "Building Linux (CLI + GUI) — OpenPath v1"
# CLI
(cd "$ROOT/client/linux/cli" && npm install && npx tsc -p tsconfig.json && echo "CLI built → cli/dist/cli.js (try: node cli/dist/cli.js --help)")
# GUI deps
if command -v npm >/dev/null 2>&1; then
  (cd "$ROOT/client/linux" && npm install && echo "GUI deps ready — run: npm run dev  or  npm run pack:appimage")
else
  echo "npm missing — install Node 20 first"
fi
