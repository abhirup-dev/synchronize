# glossary.md

Fast lookup index — concepts → code locations, terms → meaning, env vars →
effects. Use this when you need to dive into the code from a symptom or
concept.

> **For deeper architectural exploration, read the serena series memories
> at `.serena/memories/`.** Those contain narrative architecture context
> that this glossary intentionally omits — entries like
> `architecture.md`, `backend_daemon_runtime.md`, `backend_threads_mentions.md`,
> `mcp_adapter_surface.md`, `pi_extension_surface.md`, `web_ui_overview.md`,
> `codebase_layout.md`. Load them on demand, not preemptively.

## Concept → code location

| Concept | Primary file(s) |
|---|---|
| Peer register / heartbeat / delete REST | `src/api/peers.ts` |
| Peer lifecycle in MCP adapter (incl. borrowed-peer guard) | `src/mcp/lifecycle.ts` |
| Pi extension peer ownership (session_start / session_shutdown handlers) | `extensions/pi-synchronize/src/index.ts` |
| MCP adapter state + mode (codex/claude) | `src/mcp/state.ts`, `src/mcp/util.ts` |
| MCP tools (one file per tool) | `src/mcp/tools/*.ts` |
| Daemon HTTP server + route wiring | `src/daemon.ts` |
| REST handlers grouped by resource | `src/api/{peers,groups,media,inbox,events,status,agent-sessions}.ts` |
| CLI argv + dispatch | `src/cli.ts` + `src/cli/commands/*` |
| CLI terminal rendering | `src/cli/render/*` |
| Shared REST client (CLI + MCP) | `src/client.ts` |
| Daemon discovery + auto-spawn | `src/client.ts` (discoverDaemon / ensureDaemon) |
| SQLite schema + migrations | `src/db.ts` |
| Filesystem media store | `src/media-store.ts` |
| Mention regex + resolution | `src/daemon.ts` (`MENTION_TOKEN_RE`, around line 1388) |
| Thread normalization (parent_event_id collapse) | `src/daemon.ts` (search for `parent_event_id`) |
| Subscriber callback map (push delivery) | `src/daemon.ts` (`ctx.subscribers`) |
| Event types + DB CHECK constraint coupling | `src/constants.ts` (`EVENT_TYPES`) ↔ `src/db.ts` |
| Web UI bundle + assets | `src/web/*` |
| Demo seed script | `scripts/seed-demo.ts` |
| Diagnostic doctor script | `scripts/doctor.sh` |

## Surface map

| Surface | Files |
|---|---|
| REST API | `src/api/*.ts`, mounted in `src/daemon.ts` |
| MCP tools (stdio) | `src/mcp/tools/*.ts` |
| CLI commands | `src/cli/commands/*.ts` |
| Web UI | `src/web/*` (bundled by `scripts/build-web.ts` if present) |
| Pi extension | `extensions/pi-synchronize/src/*.ts` |
| Claude Code skills | `skills/synchronize-claude/`, deployed to `$CLAUDE_DIR/skills/` |
| Codex skills | `skills/synchronize-codex/` |
| Pi skills | `skills/synchronize-pi/` |

## Glossary of terms (as used in this codebase)

| Term | Meaning |
|---|---|
| **peer** | A registered agent identity. Has a UUID `peer_id`, a `tool` (claude/codex/pi/web), and a `session_name`. Stored in `peers` table. |
| **agent_session** | A binding between a peer and a host session (Pi session id, Claude Code session id). One peer can have multiple agent_sessions over time. |
| **group_member** | Membership of a peer in a group, with an `alias` that's unique-per-group-when-active. |
| **channel** | The push delivery path. Real-time only; only fires for subscribed callbacks. |
| **inbox** | The durable delivery path. Always written for targeted recipients regardless of push success. |
| **subscriber** | An in-memory entry in the daemon's `ctx.subscribers` map mapping `peer_id` → callback URL. Lost on daemon restart; re-registered by clients on connect. |
| **borrowed peer** | A peer whose `peer_id` was registered by one process (the owner, typically Pi extension) but reused by a subprocess (the borrower, typically the MCP adapter spawned by Pi) via `SYNCHRONIZE_PEER_ID` env var. |
| **lease** | `lease_expires_at` column on peers; refreshed by heartbeat. Daemon considers peer online while lease > now. |
| **soft-delete** | `peers.deleted_at` set instead of physical row deletion (migration v2 / `sync-dmc`). Reads filter `deleted_at IS NULL`. |
| **alias vs session_name** | `alias` is per-group, used for `@mentions`. `session_name` is per-peer, used as the global display name. They can diverge after `bridge_rename_in_group`. |
| **thread root** | The first event in a thread. Replies have `parent_event_id = root.event_id`. The daemon collapses reply-to-reply onto the root (1-level-deep). |
| **mention** | `@alias` token in a message body, resolved against `group_members.alias` (case-sensitive). Drives push fan-out. |
| **ephemeral group** | `groups.durable = 0`. Pruned on daemon startup. (Default groups are durable.) |
| **deliver-as** | Pi-specific concept: how an injected event is presented in Pi's TUI (`steer`, `followUp`, `nextTurn`). See `mapEventToDelivery` in `extensions/pi-synchronize/src/delivery.ts`. |

## Env var reference

All from `src/constants.ts`:

| Env var | Default | Effect |
|---|---|---|
| `SYNCHRONIZE_HOME` | `~/.synchronize` | Root of all runtime state (DB, media, logs, discovery) |
| `SYNCHRONIZE_BIND` | `127.0.0.1` | Daemon HTTP bind host. Non-localhost requires `SYNCHRONIZE_TOKEN` |
| `SYNCHRONIZE_PORT` | `58405` | Daemon HTTP port. `0` picks a free port |
| `SYNCHRONIZE_TOKEN` | (unset) | Bearer auth token required for non-localhost binds |
| `SYNCHRONIZE_PEER_ID` | (unset) | Set by Pi extension to share peer with spawned MCP subprocess (the "borrowed peer" mechanism) |
| `SYNCHRONIZE_SESSION_NAME` | (unset) | Override the auto-derived session name for a Pi session |
| `SYNCHRONIZE_MCP_MODE` | `codex` | Selects MCP notification path: `codex` (per-peer polling) or `claude` (event-callback channel) |
| `SYNCHRONIZE_STARTED_BY_CLIENT` | (unset) | Set by clients when they auto-spawn the daemon; informational only |
| `SYNCHRONIZE_HOOK_ENABLE` | (unset) | Enables the Claude Code SessionStart hook integration. Leaks into test subprocesses — known issue |
| `SYNCHRONIZE_LAUNCH_ID` | (unset) | Launch-scoped correlation key for `synchronize launch` → SessionStart → MCP discovery |

For Makefile env conventions:

| Var | Default | Purpose |
|---|---|---|
| `SYNC_HOME` | `$HOME/.synchronize` | Prod runtime location used by `daemon-*`, `clean-slate`, `doctor`, etc. |
| `DEV_SYNC_HOME` | `$(CURDIR)/.dev-synchronize` | Dev runtime used by `dev-daemon-*`, `dev-clean-slate` |
| `DEMO_HOME` | `$(CURDIR)/.demo-synchronize` | Demo-data location for `make demo` |

## Quick "where would I find X?"

| Question | File to read |
|---|---|
| Where does `daemon.json` get written? | `src/client.ts` (`ensureDaemon` / startup writer) |
| Where is the heartbeat interval? | `src/constants.ts` (`MCP_HEARTBEAT_MS`) |
| Where is the lease set? | `src/api/peers.ts` (registerPeer/heartbeatPeer use `DEFAULT_LEASE_MS`) |
| Where are inbox rows created? | `src/daemon.ts` event-write path; `src/api/inbox.ts` for read |
| Where is `pushed_to` decided? | `src/daemon.ts` send path — search for `pushed_to` |
| Where does the web UI get its data? | `src/web/data/*` (DaemonDataSource polling) |
| Where is the MCP notification format chosen? | `src/mcp/state.ts` (`getMode()`), wired in `src/mcp/lifecycle.ts` |

## See also

- `peer-lifecycle.md`, `daemon-forensics.md`, `delivery-forensics.md`,
  `dev-server-mode.md`, `db-queries.md` — per-topic skill detail files
- `reference-v0-plans.md` — index of historical plans and handoffs
  (load gated — high context cost)
- `.serena/memories/*.md` — narrative architecture series; load specific
  entries on demand
