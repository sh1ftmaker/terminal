#!/usr/bin/env bash
# Run the demo's private tmux servers in the foreground: one for the admin
# context and one per agent account (as that account, via sudo). Keeping them
# here, rather than letting the Node server spawn them on demand, means
#   - demo sessions outlive restarts of the Node server, and
#   - stopping this script takes every one of them down, including the ones
#     that run as other users and that a supervisor could not signal itself.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

mkdir -p "$DEMO_RUNTIME_DIR" "$DEMO_WORKSPACE"
chmod 700 "$DEMO_RUNTIME_DIR"
agents="$(demo_agent_users)"

stop_all() {
  trap - TERM INT EXIT
  demo_tmux kill-server 2>/dev/null || true
  rm -f "$DEMO_TMUX_SOCKET"
  for u in $agents; do
    demo_agent_tmux "$u" kill-server 2>/dev/null || true
    sudo -n -u "$u" -- rm -f "$(demo_ctx_socket "$u")" 2>/dev/null || true
  done
}
trap 'stop_all; exit 0' TERM INT
trap stop_all EXIT

( cd "$DEMO_WORKSPACE" && exec env -i "${demo_base_env[@]}" CLAUDE_META_DIR="$DEMO_META_DIR" \
    tmux -S "$DEMO_TMUX_SOCKET" -D ) &
for u in $agents; do
  # sudo resets the environment; / is a directory every account can stand in.
  ( cd / && exec sudo -n -u "$u" -- tmux -S "$(demo_ctx_socket "$u")" -D ) &
done

# If any server exits, take the rest down too rather than limp along.
wait -n || true
