#!/usr/bin/env bash
# Run a private tmux server in the foreground on the demo socket, so demo
# sessions outlive restarts of the Node server.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

mkdir -p "$DEMO_RUNTIME_DIR" "$DEMO_WORKSPACE"
chmod 700 "$DEMO_RUNTIME_DIR"
cd "$DEMO_WORKSPACE"
exec env -i "${demo_base_env[@]}" CLAUDE_META_DIR="$DEMO_META_DIR" \
  tmux -S "$DEMO_TMUX_SOCKET" -D
