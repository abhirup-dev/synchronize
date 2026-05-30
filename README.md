# synchronize

Local-first messaging for Claude and Codex agents.

`synchronize` gives multiple agent sessions on the same machine a shared message bus:

- direct messages with durable inbox fallback
- group chats with history or fresh-fork joins, aliases, descriptions, threads, and mentions
- copied group media with a searchable filesystem index
- one REST daemon used by both MCP tools and the CLI
- Claude channel notifications and Codex MCP logging notifications
- a local web operator surface served by the daemon at `/web`

The daemon stores state locally under `~/.synchronize` by default. Nothing leaves your machine unless you explicitly bind the daemon to a non-localhost address.

## Architecture

```text
                          same REST API
                              |
          +-------------------+-------------------+
          |                   |                   |
          v                   v                   v
+-----------------+   +-----------------+   +-----------------+
| Claude MCP      |   | Codex MCP       |   | synchronize CLI |
| stdio adapter   |   | stdio adapter   |   | human/operator  |
+--------+--------+   +--------+--------+   +--------+--------+
         |                     |                     |
         | HTTP JSON           | HTTP JSON           | HTTP JSON
         +---------------------+---------------------+
                               v
                    +---------------------+
                    | synchronize daemon  |
                    | Bun HTTP server     |
                    | 127.0.0.1 default   |
                    +----------+----------+
                               |
             +-----------------+-----------------+
             v                 v                 v
    +----------------+ +----------------+ +--------------------+
    | SQLite WAL DB  | | MediaStore FS  | | discovery + lock    |
    | durable state  | | group assets   | | ~/.synchronize/     |
    +----------------+ +----------------+ +--------------------+
```

The MCP server is intentionally thin. It registers a peer and converts daemon events into client notifications. Claude mode opens one local event callback subscription for channel delivery; Codex mode keeps one peer-level polling bridge for standard MCP notifications. The daemon owns durable state and durable inbox fallback.

The Pi coding-agent extension is a fourth adapter: it discovers the same daemon,
registers a peer, opens a callback subscription, and injects delivered events
into Pi sessions as user messages.

## Requirements

- [Bun](https://bun.sh/) 1.3 or newer
- Git
- Optional: Claude Code and/or Codex CLI for MCP integration

Check:

```bash
bun --version
git --version
```

## Install

```bash
git clone https://github.com/abhirup-dev/synchronize.git
cd synchronize
make setup
bun test
```

For convenient CLI use, link the package:

```bash
make link
synchronize --help
```

`synchronize-mcp` is also linked for MCP clients; it is a stdio server, so it is
normally launched by Codex or Claude rather than run interactively.

If you do not want to link it, run the CLI from the repo:

```bash
bun run src/cli.ts --help
```

## Merge Policy

Merge feature branches into `master` with a squash merge. Keep the resulting
commit focused, include the relevant Beads issue state, and avoid merge commits
for feature branch integration.

## Quick Start With The CLI

Start or connect to the daemon:

```bash
synchronize status
```

Register a local CLI peer:

```bash
synchronize register --name terminal --purpose "manual coordination"
synchronize whoami
```

Create and use a group:

```bash
synchronize group create demo --as terminal
synchronize group join demo --as terminal
synchronize group send demo --as terminal "hello from the CLI"
synchronize group history demo --as terminal
```

Group messages support Slack-style threads and `@alias` mentions:

```bash
synchronize group send demo --as terminal --in-reply-to 42 "replying in a thread"
synchronize group history demo --as terminal --thread-of 42
```

Add or update a group description:

```bash
synchronize group describe demo "launch coordination"
synchronize group describe demo --clear
```

Read durable inbox messages:

```bash
synchronize inbox
synchronize inbox --ack
```

CLI fallback note: CLI peers do not attach Claude channel subscriptions. When an
agent uses CLI commands, real-time Claude auto-prompt notifications will not
work; the agent must tell the user this and rely on `synchronize inbox` polling
or checking.

Share media into a group:

```bash
synchronize media share demo ./some-file.txt --description "notes for the demo group"
synchronize media list demo --query notes
```

## Group Join Semantics

Normal join gets history:

```bash
synchronize group join demo --as reviewer
```

Fresh join starts from the join point:

```bash
synchronize group join demo --as reviewer-fresh --fresh
```

If no `--alias` is supplied, the daemon uses the registered peer's session name
as the group alias. CLI group commands require `--as SESSION_NAME` so a stale
terminal identity cannot silently create or join groups as the wrong peer.
If that default alias is already active in the group, the join is blocked and
the agent must retry with a unique `--alias`.

This maps to the skill-level commands:

```text
/join-group "demo"       -> history access
/join-group-fork "demo"  -> fresh from join point
```

Aliases are unique within a group. If two peers try to join the same group with the same alias, the daemon returns an alias collision error.

Members can rename their group alias later:

```bash
synchronize group rename demo reviewer --as terminal
```

Group names are matched case-insensitively for collision checks. Thread replies
are hidden from the main-channel history by default; use `--thread-of` to read a
thread. Mentions are resolved from active group aliases, ignore text inside
single-backtick and triple-backtick code regions, and exclude the sender from
live push notifications. Durable inbox rows remain the fallback visibility path.

## Web UI

Build and serve the local operator UI:

```bash
bun run web/build.ts
synchronize status
open "$(jq -r .baseUrl ~/.synchronize/daemon.json)/web"
```

The web app is an operator surface, not an agent runtime. It currently ships with
the mock data source wired; daemon-backed live data is still a follow-up. The
daemon serves built assets from `web/dist` or `SYNCHRONIZE_WEB_DIST`.

## MCP Setup

Each agent needs (a) the `synchronize` MCP server registered and (b) the
matching `SKILL.md` copied into its skills directory. `make install-<agent>`
does both:

```bash
make install-claude      # claude mcp add + copy skills/synchronize-claude
make install-codex       # codex  mcp add + copy skills/synchronize-codex
make install-pi          # merge ~/.pi/agent/mcp.json + extension shim + copy skill
make install-all         # all three
make uninstall-{claude,codex,pi,all}
```

All targets depend on `make link` (`bun install && bun link` so
`synchronize-mcp` is on `PATH`). `SYNCHRONIZE_MCP_MODE` selects the
notification dialect: `codex` (standard `notifications/message`) or `claude`
(`notifications/claude/channel`).

### Under the hood

| Agent  | What `install-<agent>` runs |
|--------|------------------------------|
| Codex  | `codex mcp add --env SYNCHRONIZE_MCP_MODE=codex synchronize -- synchronize-mcp` |
| Claude | `claude mcp add synchronize synchronize-mcp --scope user -e SYNCHRONIZE_MCP_MODE=claude` |
| Pi     | `bun run scripts/pi-mcp-config.ts ~/.pi/agent/mcp.json` + writes `~/.pi/agent/extensions/synchronize.ts` |

For Claude channel pushes to surface in the UI, launch Claude with
`--dangerously-load-development-channels server:synchronize`. A `server:`
channel only registers as a development channel (`--channels server:synchronize`
is skipped — it's not on any approved allowlist; see bd sync-zst), and this
flag triggers a one-time "local development" confirmation per launch. For
daemon-spawned sessions, `AoeBackend` auto-dismisses that prompt via tmux
send-keys so the session is unattended. Without the channel, durable inbox
tools still work but live channel pushes stay silent.

Pi has no `pi mcp add` CLI; `scripts/pi-mcp-config.ts` idempotently merges
this entry into `~/.pi/agent/mcp.json` (or `$PI_CODING_AGENT_DIR/mcp.json`)
without touching other servers:

```json
{
  "mcpServers": {
    "synchronize": {
      "command": "sh",
      "args": ["-c", "SYNCHRONIZE_CONFIGURED_CLI=...\\nSYNCHRONIZE_CONFIGURED_MCP=...\\n..."],
      "env": { "SYNCHRONIZE_MCP_MODE": "codex" }
    }
  }
}
```

Pi mode is `codex` because Pi receives synchronize events as user messages
injected by `@synchronize/pi-extension` (see `extensions/pi-synchronize/`),
not as a native channel notification — the extension owns the push path; the
MCP server only serves outbound tool calls.

The generated Pi MCP entry is resilient to stale global shims: it checks
candidate `synchronize` binaries with `synchronize status`, then execs a
verified `synchronize-mcp` adapter. The Pi extension runs the same
`synchronize status` preflight before auto-registering its session.

## Agent Session Auto-Registration

`synchronize` can correlate native host sessions with daemon peers. This is used
by Claude hooks, Pi extension registration, and operator workflows that need to
see which external session owns a peer.

```bash
synchronize hook claude-session
synchronize launch claude --name backend-reviewer   # auto-adds --dangerously-load-development-channels server:synchronize
```

Install the Claude `SessionStart` hook with `scripts/claude-hooks-config.ts`.
The generated hook exits before binary resolution unless
`SYNCHRONIZE_HOOK_ENABLE=1`, then checks candidate `synchronize` binaries,
runs `synchronize status`, and only proceeds to `hook claude-session` if that
status check succeeds. This keeps normal Claude launches quiet when a global
shim or configured checkout path is stale.

Relevant environment variables:

- `SYNCHRONIZE_SESSION_NAME` sets the stable session name for hook/Pi registration.
- `SYNCHRONIZE_PEER_ID` pins a stable peer id for MCP/Pi restarts.
- `SYNCHRONIZE_HOOK_ENABLE=1` enables hook ingestion commands.
- `SYNCHRONIZE_LAUNCH_ID` groups launch/hook events from the same spawned session.

See `AUTO_REGISTRATION.md` for the full flow.

## Spawning persistent agent sessions (AOE backend)

`synchronize launch` runs an agent in the *foreground*. To spawn a **persistent**
agent session that outlives the daemon, synchronize drives Agent of Empires
(`aoe`) as a tmux backend:

```bash
# REST
curl -X POST $BASE/agent-sessions/launch \
  -d '{"tool":"claude","name":"alice","repo":"~/proj","group":"alpha"}'

# CLI
synchronize spawn claude --name alice --repo ~/proj --group alpha -- --model opus

# MCP (an in-group agent spawning a teammate)
bridge_launch({ tool: "claude", name: "alice", repo: "~/proj", group: "alpha" })
```

What happens:

1. The daemon mints a `launch_id` + `peer_id`, builds the agent command (reusing
   the same builder as `synchronize launch`), and asks the backend to
   `aoe add` + `aoe session start` a session titled `<name>-<peerid8>`.
2. `aoe` hands the session to its own daemon/tmux, so it **survives a
   synchronize daemon crash** (the tmux server reparents to PID 1).
3. The agent boots, its SessionStart hook self-registers with the pinned
   `peer_id` + `launch_id`, and — if a `group` was named — the daemon
   **auto-joins** the peer to that synchronize group (alias = name, fresh
   history). The agent discovers its group via `bridge_list_groups({ mine: true })`.
4. Stop with `POST /agent-sessions/stop {title}` / `bridge_stop`. Wiping the
   runtime (`make clean-slate`) deletes the AOE profile, dropping its sessions.

Requirements: `aoe` and `tmux` installed, and the agent globally installed
(`make install-claude` / `install-pi`) so its synchronize MCP/hook wiring exists.
The launch injects `SYNCHRONIZE_HOME` so the spawned agent registers back to the
launching daemon. The backend is swappable (vanilla tmux is a future drop-in);
group binding is server-side, so launches add **no new environment variables**.

## Skills

Each agent gets its own `SKILL.md` with rules tailored to its notification
path:

```text
skills/synchronize-codex/SKILL.md
skills/synchronize-claude/SKILL.md
skills/synchronize-pi/SKILL.md
```

`make install-<agent>` (see above) copies the right one. The skills cover:
register before messaging, mandatory session name, optional purpose,
`bridge_join_group` for `/join-group` (with `fresh: true` for fork), inbox as
the durable fallback, and — for Pi specifically — how to interpret incoming
`<synchronize_event>` user-message envelopes.

For manual install without `make`, all three are plain directory copies:

```bash
cp -R skills/synchronize-<agent> ~/<agent-skills-dir>/synchronize
```

## REST API

The CLI and MCP adapter both use the daemon REST API internally.

Start the daemon and discover its local base URL:

```bash
synchronize status
cat ~/.synchronize/daemon.json
```

Use the discovered `baseUrl`:

```bash
BASE_URL=$(jq -r .baseUrl ~/.synchronize/daemon.json)
curl "$BASE_URL/health"
curl "$BASE_URL/status"
```

Core endpoints:

```text
GET    /health
GET    /status
GET    /summary

POST   /agent-sessions/register
GET    /agent-sessions
GET    /agent-sessions?tool={tool}
GET    /agent-sessions/{tool}/{host_session_id}
POST   /agent-sessions/rename

POST   /web/session
GET    /web/state
GET    /web/events

POST   /peers/register
PATCH  /peers/{peer_id}/heartbeat
GET    /peers
GET    /peers?group={group_name}
DELETE /peers/{peer_id}

POST   /subscriptions

POST   /dm
GET    /peers/{peer_id}/inbox
POST   /peers/{peer_id}/inbox/ack
GET    /events/{peer_id}?cursor=0&limit=50
GET    /events/{event_id}

POST   /groups
GET    /groups
GET    /groups/{name}
POST   /groups/{name}/join
POST   /groups/{name}/rename
PATCH  /groups/{name}
POST   /groups/{name}/leave
POST   /groups/{name}/messages
GET    /groups/{name}/history?peer_id={peer_id}
GET    /groups/{name}/history?peer_id={peer_id}&thread_of={root_event_id}

GET    /threads/{root_event_id}?peer_id={peer_id}

POST   /groups/{name}/media
GET    /groups/{name}/media
GET    /media/{media_id}
```

Example REST flow:

```bash
BASE_URL=$(jq -r .baseUrl ~/.synchronize/daemon.json)

ALICE=$(curl -sS "$BASE_URL/peers/register" \
  -H 'content-type: application/json' \
  -d '{"session_name":"alice","tool":"cli","purpose":"sender"}' \
  | jq -r .peer.peer_id)

BOB=$(curl -sS "$BASE_URL/peers/register" \
  -H 'content-type: application/json' \
  -d '{"session_name":"bob","tool":"cli","purpose":"receiver"}' \
  | jq -r .peer.peer_id)

curl -sS "$BASE_URL/dm" \
  -H 'content-type: application/json' \
  -d "{\"sender_peer_id\":\"$ALICE\",\"recipient_peer_id\":\"$BOB\",\"message\":\"hello\"}"

curl -sS "$BASE_URL/peers/$BOB/inbox"
```

## Storage

Default runtime directory:

```text
~/.synchronize/
  daemon.json
  daemon.lock/
  daemon.log
  synchronize.db
  synchronize.db-wal
  synchronize.db-shm
  cli-peer.json
  media/
    <group>/
      index.jsonl
      README.md
      <copied files>
```

`daemon.json`, `/status`, and each `daemon.log` startup record include daemon
provenance: runtime home, source root, entrypoint path, API version, git SHA,
and whether the source tree was dirty when the daemon started. Integration
runs should set their own `SYNCHRONIZE_HOME` and `SYNCHRONIZE_PORT=0`; that
gives each run an isolated discovery file, database, log, lock, and random
daemon port.

Important details:

- SQLite uses WAL mode.
- Ephemeral groups are removed when the daemon starts.
- Durable groups and messages are retained forever in v0.
- Peer deletion is soft-delete (`deleted_at`) so audit/history can remain intact.
- Media files are copied into the group MediaStore by default.
- `index.jsonl` is intentionally easy to inspect with `rg`, `jq`, or `find`.

## Environment

```text
SYNCHRONIZE_HOME   Runtime directory. Default: ~/.synchronize
SYNCHRONIZE_BIND   Daemon bind host. Default: 127.0.0.1
SYNCHRONIZE_PORT   Daemon port. Default: 58405
SYNCHRONIZE_TOKEN  Bearer token. Required when SYNCHRONIZE_BIND is not localhost
SYNCHRONIZE_MCP_MODE  codex or claude. Default: codex
SYNCHRONIZE_PEER_ID   Stable MCP/Pi peer id across restarts
SYNCHRONIZE_SESSION_NAME  Stable host-agent session name for hooks/Pi
SYNCHRONIZE_HOOK_ENABLE   Enables hook ingestion when set to 1
SYNCHRONIZE_LAUNCH_ID     Correlates launch/hook registration events
SYNCHRONIZE_WEB_DIST      Override built web asset directory
```

Use a separate test environment:

```bash
SYNCHRONIZE_HOME=/tmp/synchronize-demo synchronize status
```

## LAN Mode

Localhost mode needs no token. Non-localhost bind requires a token:

```bash
export SYNCHRONIZE_BIND=0.0.0.0
export SYNCHRONIZE_PORT=8787
export SYNCHRONIZE_TOKEN='replace-with-a-secret'
bun run src/daemon.ts
```

Clients must use the same token:

```bash
export SYNCHRONIZE_TOKEN='replace-with-a-secret'
```

The daemon expects:

```text
Authorization: Bearer <SYNCHRONIZE_TOKEN>
```

## Development

```bash
make setup
bun run typecheck
cd web && bun run typecheck
cd web && bun run build
bun test
```

Run the daemon directly:

```bash
bun run src/daemon.ts
```

Run the CLI from source:

```bash
bun run src/cli.ts status
```

Run the MCP adapter from source:

```bash
SYNCHRONIZE_MCP_MODE=codex bun run src/mcp.ts
SYNCHRONIZE_MCP_MODE=claude bun run src/mcp.ts
```

Run integration harnesses:

```bash
python3 scripts/integration_tmux.py --help
python3 scripts/integration_group_policy_tmux.py --help
python3 scripts/integration_group_policy_pi.py --help
python3 scripts/integration_thread_baton_pi.py --help
```

See `scripts/README.md` and `docs/integration-tmux.md` before running the real
tmux/AoE/Pi harnesses; they exercise live agent sessions and write JSON
artifacts for debugging.

## Fresh Manual Test Setup

From the repo you want to test:

```bash
make setup
make daemon-relaunch
make install-all          # wires Codex + Claude + Pi (link, MCP register, copy skills)
synchronize status        # confirm daemon is healthy
```

Verify per-agent registration:

```bash
codex mcp get synchronize
claude mcp get synchronize
cat ~/.pi/agent/mcp.json
```

## Troubleshooting

### `No CLI peer is registered`

Run:

```bash
synchronize register --name YOUR_NAME --purpose "what this terminal is doing"
```

### Daemon seems stale

Check:

```bash
cat ~/.synchronize/daemon.json
synchronize status
```

If the PID in `daemon.json` no longer exists, the next `synchronize status` normally starts a new daemon.

### LAN request returns unauthorized

Set `SYNCHRONIZE_TOKEN` in the client environment. If calling REST manually, include:

```text
Authorization: Bearer <token>
```

### Claude notifications do not appear

Confirm the MCP server was added with `SYNCHRONIZE_MCP_MODE=claude`, then start Claude with:

```bash
claude --dangerously-load-development-channels server:synchronize
```

(A `server:` channel only registers as a development channel — `--channels
server:synchronize` is skipped because custom `server:` channels can't be added
to the `allowedChannelPlugins` managed allowlist, which only covers marketplace
plugins (see bd sync-zst). The dev flag triggers a one-time "local development"
confirmation; daemon-spawned sessions auto-dismiss it. Even once registered, a
freshly-spawned *idle* session may not surface a live push until it's active —
durable inbox remains the fallback (see bd sync-amq).)

Inbox remains available through `bridge_inbox` even if channel notifications do not surface. Claude mode receives daemon events through one localhost callback subscription; it does not rely on per-group polling.

### Codex notifications do not appear

Confirm the MCP server was added with `SYNCHRONIZE_MCP_MODE=codex`. If notifications are not surfaced by the client UI, use `bridge_inbox` as the durable fallback.

### Pi events do not appear in the session

`@synchronize/pi-extension` injects events as `<synchronize_event>` user messages. Tail `~/.synchronize/pi-extension.log` to see lifecycle (register / subscribe / event received / delivery mode). If the log shows the event was injected but the model didn't react, confirm `skills/synchronize-pi/SKILL.md` is installed at `~/.pi/agent/skills/synchronize`.

## Current Scope

Implemented for v0:

- local daemon
- REST API
- CLI
- MCP adapter
- durable DMs and inbox
- durable and ephemeral groups
- join-with-history and join-fresh modes
- group aliases, alias rename audit events, and descriptions
- Slack-style group threads and mention-aware push routing
- agent-session auto-registration hooks
- filesystem MediaStore
- Claude, Codex, and Pi notification paths
- local web operator UI served at `/web`

Not included in v0:

- WebSocket/SSE
- cloud sync
- encryption
- backup automation
- daemon-backed live web data source
- retention/pruning policies
- remote peer discovery
