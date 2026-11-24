#!/usr/bin/env bash
# Create demo tmux sessions (and agent metadata for them) on the private
# sockets: a few in the admin context and, when agent accounts are available,
# a couple running as those accounts. Idempotent: existing sessions are left
# alone. Agent sessions only run `whoami`; nothing is written to their homes.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

mkdir -p "$DEMO_META_DIR"

session() { # name cwd [command]
  local name="$1" cwd="$2" cmd="${3:-}"
  demo_tmux has-session -t "=$name" 2>/dev/null && return 0
  demo_tmux new-session -d -s "$name" -c "$cwd" -x 100 -y 40
  [ -n "$cmd" ] && demo_tmux send-keys -t "=$name:" "$cmd" Enter
  return 0
}

meta_json() { # status task [cwd] [preview_url]
  local extra=""
  [ -n "${3:-}" ] && extra="$extra, \"cwd\": \"$3\""
  [ -n "${4:-}" ] && extra="$extra, \"preview_url\": \"$4\""
  printf '{"status": "%s", "task": "%s", "updated_at": %s%s}\n' "$1" "$2" "$(date +%s)" "$extra"
}

meta() { # name status task cwd [preview_url]
  meta_json "$2" "$3" "$4" "${5:-}" > "$DEMO_META_DIR/$1.json"
}

# Same flags the server uses when it creates a session in a context.
agent_session() { # user name status task
  local u="$1" name="$2"
  demo_agent_tmux "$u" has-session -t "=$name" 2>/dev/null || {
    demo_agent_tmux "$u" new-session -d -s "$name" -c /tmp -x 100 -y 40 \
      -e "CLAUDE_META_DIR=$(demo_ctx_meta "$u")" -e "TMUX_SOCKET=$(demo_ctx_socket "$u")"
    demo_agent_tmux "$u" send-keys -t "=$name:" 'clear; echo "session of $(whoami)"' Enter
  }
  [ -n "${3:-}" ] && meta_json "$3" "$4" | sudo -n -u "$u" -- tee "$(demo_ctx_meta "$u")/$name.json" >/dev/null
  return 0
}

LOG_LOOP='clear; n=0; while :; do n=$((n+1)); for l in "\033[32m200\033[0m GET  /healthz            3ms" "\033[32m200\033[0m GET  /api/items?page=$n  41ms" "\033[33m429\033[0m POST /api/items         1ms  rate limited" "\033[32m201\033[0m POST /api/items        58ms"; do printf "\033[90m%s\033[0m  $l\n" "$(date +%T)"; sleep 4; done; done'

session api-server "$DEMO_WORKSPACE/api" "$LOG_LOOP"
session web-ui     "$DEMO_WORKSPACE/web" "clear; ls -la --color=always; git -C '$DEMO_REPO' log --oneline --color=always | head -8"
session deploy     "$DEMO_WORKSPACE"     "clear; printf 'build 415 \033[32mok\033[0m\ndeployed to \033[36mstaging\033[0m in 48s\n'"
session scratch    "$DEMO_WORKSPACE"

meta api-server working  "Adding rate limiting to the request handler" "$DEMO_WORKSPACE/api"
meta web-ui     waiting  "Should the status page poll or use server-sent events?" "$DEMO_WORKSPACE/web" \
  "http://localhost:${DEMO_PREVIEW_PORT}/"
meta deploy     finished "Deployed build 415 to staging" "$DEMO_WORKSPACE"

for u in $(demo_agent_users); do
  mkdir_ok=1; sudo -n -u "$u" -- mkdir -p -m 755 "$(demo_ctx_meta "$u")" || mkdir_ok=0
  [ "$mkdir_ok" = 1 ] || continue
  case "$(demo_ctx_name "$u")" in
    work)      agent_session "$u" billing-api working  "Migrating invoices to the new ledger schema"
               agent_session "$u" docs-site   finished "Published the API reference" ;;
    untrusted) agent_session "$u" scraper-sandbox waiting "Allow fetching 40 more changelog pages?" ;;
    john)      agent_session "$u" paper-notes "" "" ;;
  esac
done

echo "admin:"; demo_tmux list-sessions -F '  #{session_name}'
for u in $(demo_agent_users); do
  echo "$(demo_ctx_name "$u") (as $u):"; demo_agent_tmux "$u" list-sessions -F '  #{session_name}' 2>/dev/null || echo "  (none)"
done
