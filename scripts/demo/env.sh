#!/usr/bin/env bash
# Shared settings for the isolated demo instance (scripts/demo/*).
#
# Everything the server or tmux would otherwise share with a production
# install is pointed at a private path here. The launchers start from an EMPTY
# environment (env -i): a shell opened inside a production terminal session
# inherits that server's PORT / TMUX_SOCKET / CONTEXTS_CONFIG / CLAUDE_META_DIR
# / TERMINAL_SHARE_ORIGIN, and a naive `node dist/server.js` would attach to
# the production tmux sockets and unlink its share socket.
#
# Private resources, all derived from DEMO_NAME (default "bt-fable"):
#   /tmp/<name>-tmux.sock            admin tmux socket
#   /tmp/<name>-<context>.sock       one tmux socket per agent context
#   /tmp/<name>-meta[-<context>]     agent-metadata dirs
#   /tmp/<name>-run/                 server + share listener sockets
#   <repo>/.<name>/contexts.json     generated coordinator config

DEMO_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEMO_NAME="${DEMO_NAME:-bt-fable}"
DEMO_PORT="${DEMO_PORT:-3102}"
DEMO_PREVIEW_PORT="${DEMO_PREVIEW_PORT:-3112}"
DEMO_TMUX_SOCKET="/tmp/${DEMO_NAME}-tmux.sock"
DEMO_META_DIR="/tmp/${DEMO_NAME}-meta"
DEMO_RUNTIME_DIR="/tmp/${DEMO_NAME}-run"
DEMO_WORKSPACE="${DEMO_REPO}/demo-workspace"
DEMO_STATE_DIR="${DEMO_REPO}/.${DEMO_NAME}"
DEMO_CONTEXTS_FILE="${DEMO_STATE_DIR}/contexts.json"

# Linux accounts that each get a context ("agent-work" -> context "work"),
# reached with `sudo -n -u`. Set DEMO_AGENT_USERS="" for single-context mode.
DEMO_AGENT_USERS="${DEMO_AGENT_USERS-agent-work agent-john agent-untrusted agent-tom}"

case "$DEMO_NAME" in
  ''|*[!A-Za-z0-9_-]*|terminal|orchestrator|claude-terminal)
    echo "demo: refusing DEMO_NAME='$DEMO_NAME'" >&2; exit 1 ;;
esac

# Minimal, explicit environment shared by the server and the admin tmux server.
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

demo_ctx_name()   { echo "${1#agent-}"; }
demo_ctx_socket() { echo "/tmp/${DEMO_NAME}-$(demo_ctx_name "$1").sock"; }
demo_ctx_meta()   { echo "/tmp/${DEMO_NAME}-meta-$(demo_ctx_name "$1")"; }

# The agent accounts that exist here and that we may become without a password.
demo_agent_users() {
  local u
  for u in $DEMO_AGENT_USERS; do
    if id "$u" >/dev/null 2>&1 && sudo -n -u "$u" -- true 2>/dev/null; then echo "$u"; fi
  done
}

# tmux on the admin socket / on an agent's socket (as that agent).
demo_tmux()       { env -u TMUX -u TMUX_PANE tmux -S "$DEMO_TMUX_SOCKET" "$@"; }
demo_agent_tmux() { local u="$1"; shift; sudo -n -u "$u" -- tmux -S "$(demo_ctx_socket "$u")" "$@"; }

# Write the private coordinator config: the admin context plus one context
# per available agent account. Echoes the path, or nothing when there are no
# agent accounts (single-context mode).
demo_write_contexts() {
  local users u first=1
  users="$(demo_agent_users)"
  [ -n "$users" ] || return 0
  mkdir -p "$DEMO_STATE_DIR" "$DEMO_META_DIR"
  {
    printf '{\n  "contexts": [\n'
    printf '    { "name": "admin", "user": null, "label": "Admin", "tmuxSocket": "%s", "metaDir": "%s", "cwd": "%s" }' \
      "$DEMO_TMUX_SOCKET" "$DEMO_META_DIR" "$DEMO_WORKSPACE"
    for u in $users; do
      local name label
      name="$(demo_ctx_name "$u")"
      label="$(tr '[:lower:]' '[:upper:]' <<<"${name:0:1}")${name:1}"
      # The meta dir belongs to the agent: its sessions' hooks write there.
      sudo -n -u "$u" -- mkdir -p -m 755 "$(demo_ctx_meta "$u")"
      printf ',\n    { "name": "%s", "user": "%s", "label": "%s", "tmuxSocket": "%s", "metaDir": "%s", "cwd": "/home/%s/Desktop" }' \
        "$name" "$u" "$label" "$(demo_ctx_socket "$u")" "$(demo_ctx_meta "$u")" "$u"
    done
    printf '\n  ]\n}\n'
  } > "$DEMO_CONTEXTS_FILE.tmp"
  mv "$DEMO_CONTEXTS_FILE.tmp" "$DEMO_CONTEXTS_FILE"
  echo "$DEMO_CONTEXTS_FILE"
}
