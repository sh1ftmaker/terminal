#!/usr/bin/env bash
# A stand-in "dev server" for the demo: one session registers it as its
# preview URL, which makes the Preview tab appear.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
exec env -i "${demo_base_env[@]}" \
  python3 -m http.server "$DEMO_PREVIEW_PORT" --bind 127.0.0.1 --directory "$DEMO_WORKSPACE/site"
