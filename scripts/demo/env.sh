#!/usr/bin/env bash
# Shared settings for the isolated demo instance (scripts/demo/*).
#
# Everything the server or tmux would otherwise share with a production
# install is pointed at a private path here. The launchers start from an EMPTY
# environment (env -i): a shell opened inside a production terminal session
# inherits that server's PORT / TMUX_SOCKET / CONTEXTS_CONFIG / CLAUDE_META_DIR
# / TERMINAL_SHARE_ORIGIN, and a naive `node dist/server.js` would attach to
# the production tmux socket and unlink its share socket.

DEMO_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEMO_NAME="${DEMO_NAME:-bt-fable}"
DEMO_PORT="${DEMO_PORT:-3102}"
DEMO_TMUX_SOCKET="/tmp/${DEMO_NAME}-tmux.sock"
DEMO_META_DIR="/tmp/${DEMO_NAME}-meta"
DEMO_RUNTIME_DIR="/tmp/${DEMO_NAME}-run"
DEMO_WORKSPACE="${DEMO_REPO}/demo-workspace"

# Minimal, explicit environment shared by the server and the tmux server.
demo_base_env=(
  "HOME=${HOME}"
  "USER=${USER:-$(id -un)}"
  "LOGNAME=${USER:-$(id -un)}"
  "SHELL=${SHELL:-/bin/bash}"
  "PATH=${PATH}"
  "LANG=${LANG:-en_US.UTF-8}"
  "TERM=xterm-256color"
  "XDG_RUNTIME_DIR=${DEMO_RUNTIME_DIR}"
)
