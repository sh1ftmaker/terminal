# Demo checks

Browser-driven checks for the isolated demo instance (`scripts/demo/start.sh`).
They emulate a phone (390x844, touch, iPhone UA) in a Chromium reached over
CDP, and read the truth from tmux itself on the demo's private sockets. They
never touch a production socket.

```bash
npm install                      # playwright-core, in this directory only
# a Chromium with --remote-debugging-port=9222 (or set CDP_URL)

node verify.mjs                  # typing, key bar, modifiers, composer, select
                                 # mode, resize, text size, theme, create/kill
node verify-contexts.mjs         # coordinator mode: list, switch, create,
                                 # attach, type, files (read-only), kill as
                                 # another Linux account
node verify-files.mjs            # files tab incl. create / upload / edit / zip
node verify-reconnect.mjs        # restarts the demo server under a terminal
node screenshots.mjs             # writes <repo>/screenshots
node icons.mjs                   # re-rasterises the app icons
```

Under a path prefix: start a second instance as the "host" and point `BASE`
at the first one through its proxy.

```bash
DEMO_NAME=bt-fable-host DEMO_PORT=3122 DEMO_AGENT_USERS= sbg start bt-fable-host-tmux -- ../run-tmux.sh
tmux -S /tmp/bt-fable-host-tmux.sock new-session -d -s HOST-ONLY
DEMO_NAME=bt-fable-host DEMO_PORT=3122 DEMO_AGENT_USERS= sbg start bt-fable-host -- ../run-server.sh

node verify-prefix.mjs                                  # nothing escapes the prefix
BASE=http://localhost:3122/lp/3102 node verify.mjs
BASE=http://localhost:3122/lp/3102 node verify-contexts.mjs

DEMO_NAME=bt-fable-host DEMO_AGENT_USERS= ../stop.sh
```

The harness refuses, at the network layer, any request that would stop a
process or publish a port (`/api/ports/*/stop`, non-GET `/api/share`).
