#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
PYTHON=${PYTHON:-python3}

# The Electron directories are legacy and are not desktop release artifacts.
for project in server client/web; do
  echo "→ Installing and testing $project"
  (cd "$ROOT/$project" && npm ci --no-audit --no-fund && npm test)
done
(cd "$ROOT/server" && npm run build)
(cd "$ROOT/client/web" && npm run typecheck && npm run build)

if ! "$PYTHON" -c 'import PySide6.QtWidgets, keyring, websockets' >/dev/null 2>&1; then
  echo 'Install native dependencies first: pip install -r client/native/requirements.txt' >&2
  exit 1
fi
QT_QPA_PLATFORM=${QT_QPA_PLATFORM:-offscreen} PYTHONPATH="$ROOT/client/native${PYTHONPATH:+:$PYTHONPATH}" \
  "$PYTHON" -m unittest discover -s "$ROOT/client/native/tests" -v

if [[ ${INCLUDE_LEGACY:-0} = 1 ]]; then
  for project in client/linux client/desktop; do
    (cd "$ROOT/$project" && npm ci --ignore-scripts --no-audit --no-fund && npm test)
  done
fi
echo 'Tests and server/preview builds complete. Native installers are built separately on each target platform.'
