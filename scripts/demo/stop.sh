#!/usr/bin/env bash
# Stop the demo instance and remove everything it created outside the repo:
# the sbg units (when sbg is available), every private tmux server (the
# agent contexts' servers run as other users), sockets and metadata dirs.
# Only /tmp/<DEMO_NAME>-* paths are touched.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

if command -v sbg >/dev/null 2>&1; then
  for unit in "$DEMO_NAME" "${DEMO_NAME}-preview" "${DEMO_NAME}-tmux"; do sbg stop "$unit" >/dev/null 2>&1 || true; done
fi

demo_tmux kill-server 2>/dev/null || true
rm -f "$DEMO_TMUX_SOCKET"
rm -rf "$DEMO_META_DIR" "$DEMO_RUNTIME_DIR"
for u in $(demo_agent_users); do
  demo_agent_tmux "$u" kill-server 2>/dev/null || true
  sudo -n -u "$u" -- rm -rf "$(demo_ctx_socket "$u")" "$(demo_ctx_meta "$u")" 2>/dev/null || true
done

# Anything still serving one of *our* sockets? (Exact paths: another demo
# instance with a longer name must not count.)
left=""
for sock in "$DEMO_TMUX_SOCKET" $(for u in $(demo_agent_users); do demo_ctx_socket "$u"; done); do
  left+="$(pgrep -af "tmux -S ${sock}( |\$)" || true)"
done
if [ -n "$left" ]; then echo "still running:"; echo "$left"; exit 1; fi
echo "demo '${DEMO_NAME}' stopped; no private tmux servers left"
