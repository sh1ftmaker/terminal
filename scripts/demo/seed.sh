#!/usr/bin/env bash
# Create a few demo tmux sessions (and agent metadata for them) on the private
# demo socket. Idempotent: existing sessions are left alone.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

T() { env -u TMUX -u TMUX_PANE tmux -S "$DEMO_TMUX_SOCKET" "$@"; }
mkdir -p "$DEMO_META_DIR"

session() { # name cwd [command]
  local name="$1" cwd="$2" cmd="${3:-}"
  T has-session -t "=$name" 2>/dev/null && return 0
  T new-session -d -s "$name" -c "$cwd" -x 100 -y 40
  [ -n "$cmd" ] && T send-keys -t "=$name:" "$cmd" Enter
  return 0
}

meta() { # name status task cwd [preview_url]
  local preview=""
  [ -n "${5:-}" ] && preview=", \"preview_url\": \"$5\""
  printf '{"status": "%s", "task": "%s", "cwd": "%s", "updated_at": %s%s}\n' \
    "$2" "$3" "$4" "$(date +%s)" "$preview" > "$DEMO_META_DIR/$1.json"
}

LOG_LOOP='clear; n=0; while :; do n=$((n+1)); for l in "\033[32m200\033[0m GET  /healthz            3ms" "\033[32m200\033[0m GET  /api/items?page=$n  41ms" "\033[33m429\033[0m POST /api/items         1ms  rate limited" "\033[32m201\033[0m POST /api/items        58ms"; do printf "\033[90m%s\033[0m  $l\n" "$(date +%T)"; sleep 4; done; done'

session api-server "$DEMO_WORKSPACE/api" "$LOG_LOOP"
session web-ui     "$DEMO_WORKSPACE/web" "clear; ls -la --color=always; git -C '$DEMO_REPO' log --oneline --color=always | head -8"
session deploy     "$DEMO_WORKSPACE"     "clear; printf 'build 415 \033[32mok\033[0m\ndeployed to \033[36mstaging\033[0m in 48s\n'"
session scratch    "$DEMO_WORKSPACE"

meta api-server working  "Adding rate limiting to the request handler" "$DEMO_WORKSPACE/api"
meta web-ui     waiting  "Should the status page poll or use server-sent events?" "$DEMO_WORKSPACE/web" \
  "http://localhost:${DEMO_PORT}/api/files/stream?path=${DEMO_WORKSPACE}/preview.html"
meta deploy     finished "Deployed build 415 to staging" "$DEMO_WORKSPACE"

T list-sessions
