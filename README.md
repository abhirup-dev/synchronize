# synchronize

Local-first messaging for Claude and Codex agents.

`synchronize` gives multiple agent sessions on the same machine a shared message bus:

- direct messages with durable inbox fallback
- group chats with history or fresh-fork joins
- copied group media with a searchable filesystem index
- one REST daemon used by both MCP tools and the CLI
- Claude channel notifications and Codex MCP logging notifications

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
bun install
bun test
```

For convenient CLI use, link the package:

```bash
bun link
synchronize --help
```

`synchronize-mcp` is also linked for MCP clients; it is a stdio server, so it is
normally launched by Codex or Claude rather than run interactively.

If you do not want to link it, run the CLI from the repo:

```bash
bun run src/cli.ts --help
```

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

## MCP Setup

The MCP adapter command is:

```bash
synchronize-mcp
```

Run `bun link` from this repo first so the `synchronize` and `synchronize-mcp`
binaries are available on `PATH`.

For a resilient MCP client config, resolve the linked binary once and store its
absolute path:

```bash
SYNCHRONIZE_MCP_BIN="$(command -v synchronize-mcp)"
```

Set `SYNCHRONIZE_MCP_MODE` to choose notification behavior:

- `codex`: standard MCP `notifications/message`
- `claude`: `notifications/claude/channel`

### Codex

From anywhere:

```bash
codex mcp add \
  --env SYNCHRONIZE_MCP_MODE=codex \
  synchronize \
  -- "$SYNCHRONIZE_MCP_BIN"
```

Then start Codex and use the MCP tools:

- `bridge_register`
- `bridge_dm`
- `bridge_inbox`
- `bridge_create_group`
- `bridge_join_group`
- `bridge_send_group`
- `bridge_group_history`
- `bridge_share_media`

### Claude Code

```bash
claude mcp add \
  synchronize "$SYNCHRONIZE_MCP_BIN" \
  --scope user \
  -e SYNCHRONIZE_MCP_MODE=claude
```

For Claude channel notifications, start Claude with the development channel enabled:

```bash
claude --dangerously-load-development-channels server:synchronize
```

Without that flag, durable inbox tools still work, but channel push behavior may not surface in the UI.

## Skills

Skill files are included for agents that support local `SKILL.md` directories:

```text
skills/synchronize-codex/SKILL.md
skills/synchronize-claude/SKILL.md
```

Install by copying the relevant directory into your agent's skills folder.

Example for Codex:

```bash
mkdir -p ~/.codex/skills
cp -R skills/synchronize-codex ~/.codex/skills/synchronize
```

Example for Claude-style skill folders:

```bash
mkdir -p ~/.claude/skills
cp -R skills/synchronize-claude ~/.claude/skills/synchronize
```

The skills instruct agents to:

- register before messaging
- provide a mandatory session name
- optionally provide a purpose
- use `bridge_join_group` for `/join-group`
- use `bridge_join_group` with `fresh: true` for `/join-group-fork`
- treat inbox as the durable fallback

## REST API

The CLI and MCP adapter both use the daemon REST API internally.

Start the daemon and discover its random local port:

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

POST   /peers/register
PATCH  /peers/{peer_id}/heartbeat
GET    /peers
GET    /peers?group={group_name}
DELETE /peers/{peer_id}

POST   /dm
GET    /peers/{peer_id}/inbox
POST   /peers/{peer_id}/inbox/ack
GET    /events/{peer_id}?cursor=0&limit=50

POST   /groups
GET    /groups
GET    /groups/{name}
POST   /groups/{name}/join
POST   /groups/{name}/leave
POST   /groups/{name}/messages
GET    /groups/{name}/history?peer_id={peer_id}

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

Important details:

- SQLite uses WAL mode.
- Ephemeral groups are removed when the daemon starts.
- Durable groups and messages are retained forever in v0.
- Media files are copied into the group MediaStore by default.
- `index.jsonl` is intentionally easy to inspect with `rg`, `jq`, or `find`.

## Environment

```text
SYNCHRONIZE_HOME   Runtime directory. Default: ~/.synchronize
SYNCHRONIZE_BIND   Daemon bind host. Default: 127.0.0.1
SYNCHRONIZE_PORT   Daemon port. Default: 0, random free port
SYNCHRONIZE_TOKEN  Bearer token. Required when SYNCHRONIZE_BIND is not localhost
SYNCHRONIZE_MCP_MODE  codex or claude. Default: codex
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
bun install
bun run typecheck
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

## Fresh Manual Test Setup

From the repo you want to test:

```bash
bun install
bun link
make daemon-relaunch

SYNCHRONIZE_MCP_BIN="$(command -v synchronize-mcp)"

codex mcp remove synchronize || true
codex mcp add --env SYNCHRONIZE_MCP_MODE=codex synchronize -- "$SYNCHRONIZE_MCP_BIN"

claude mcp remove synchronize -s user || true
claude mcp add synchronize "$SYNCHRONIZE_MCP_BIN" --scope user -e SYNCHRONIZE_MCP_MODE=claude
```

Verify:

```bash
codex mcp get synchronize
claude mcp get synchronize
synchronize status
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

Inbox remains available through `bridge_inbox` even if channel notifications do not surface. Claude mode receives daemon events through one localhost callback subscription; it does not rely on per-group polling.

### Codex notifications do not appear

Confirm the MCP server was added with `SYNCHRONIZE_MCP_MODE=codex`. If notifications are not surfaced by the client UI, use `bridge_inbox` as the durable fallback.

## Current Scope

Implemented for v0:

- local daemon
- REST API
- CLI
- MCP adapter
- durable DMs and inbox
- durable and ephemeral groups
- join-with-history and join-fresh modes
- filesystem MediaStore
- Claude and Codex notification paths

Not included in v0:

- WebSocket/SSE
- cloud sync
- encryption
- backup automation
- GUI
- retention/pruning policies
- remote peer discovery
