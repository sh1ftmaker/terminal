#!/usr/bin/env bash
# Start the whole demo under sbg: the private tmux servers, sample sessions,
# the stand-in preview page and the app server. Stop it with stop.sh.
#
#   <name>-tmux      tmux servers (admin + one per agent account)
#   <name>-preview   static page on $DEMO_PREVIEW_PORT
#   <name>           the app on http://127.0.0.1:$DEMO_PORT
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

command -v sbg >/dev/null 2>&1 || { echo "start.sh needs sbg; without it run the run-*.sh scripts under your own supervisor" >&2; exit 1; }
cd "$DEMO_REPO"
if [ ! -f server/dist/server.js ] || [ ! -f frontend/dist/index.html ]; then
  echo "build first: (cd server && npx tsc) && (cd frontend && npm run build)" >&2; exit 1
fi

sbg start "${DEMO_NAME}-tmux" -- ./scripts/demo/run-tmux.sh
for _ in $(seq 1 40); do [ -S "$DEMO_TMUX_SOCKET" ] && break; sleep 0.1; done
sleep 0.5   # the agent accounts' servers come up alongside
./scripts/demo/seed.sh
sbg start "${DEMO_NAME}-preview" -- ./scripts/demo/run-preview.sh
sbg start "$DEMO_NAME" -- ./scripts/demo/run-server.sh
echo "demo '${DEMO_NAME}' on http://127.0.0.1:${DEMO_PORT}"
