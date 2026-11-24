#!/usr/bin/env bash
# Start the isolated demo server in the foreground (run it under a process
# supervisor). Serves the built frontend + API on 127.0.0.1:$DEMO_PORT, in
# coordinator mode when agent accounts are available.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

mkdir -p "$DEMO_META_DIR" "$DEMO_RUNTIME_DIR" "$DEMO_WORKSPACE"
chmod 700 "$DEMO_RUNTIME_DIR"

contexts_env=()
contexts_file="$(demo_write_contexts)"
[ -n "$contexts_file" ] && contexts_env=("CONTEXTS_CONFIG=$contexts_file")

cd "$DEMO_REPO/server"

# TERMINAL_TCP=1 serves the app on TCP (no Unix socket, no notify listener).
# The share listener always starts, so it gets a private socket and no origin.
exec env -i "${demo_base_env[@]}" "${contexts_env[@]}" \
  NODE_ENV=production \
  PORT="$DEMO_PORT" HOST=127.0.0.1 TERMINAL_TCP=1 \
  TMUX_SOCKET="$DEMO_TMUX_SOCKET" \
  TERMINAL_SOCKET="${DEMO_RUNTIME_DIR}/server.sock" \
  TERMINAL_SHARE_SOCKET="${DEMO_RUNTIME_DIR}/share.sock" \
  SHARE_STATE_FILE="${DEMO_REPO}/config/share-state-${DEMO_NAME}.json" \
  CLAUDE_META_DIR="$DEMO_META_DIR" \
  WORKSPACE_ROOT="$DEMO_WORKSPACE" \
  node dist/server.js
