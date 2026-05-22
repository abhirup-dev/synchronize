# Synchronize Agent Session Hooks Plan

Date: 2026-05-22

## Context

Goal: make `synchronize` aware of the native session IDs for Claude Code and Pi coding-agent sessions so those sessions can later be resumed or correlated back to the exact running peer.

The current architecture is daemon-centered: the Bun daemon owns durable state in SQLite, while CLI, MCP, and Pi are thin adapters. Host-agent session correlation should therefore be stored in the daemon, not only in hook process memory or temporary adapter state.

Relevant existing behavior:

- Pi already has a `session_start` integration in `extensions/pi-synchronize/src/index.ts`.
- Pi reads `ctx.sessionManager?.getSessionId?.()`, registers a synchronize peer, sets `SYNCHRONIZE_PEER_ID`, and writes a debug marker under `~/.synchronize/pi-sessions`.
- MCP peer reuse already honors `SYNCHRONIZE_PEER_ID` in `src/mcp/lifecycle.ts`.
- The current `peers` table has no native host session mapping fields.
- Claude currently has only `bd prime` hooks in `.claude/settings.json`.

External documentation findings:

- Claude Code hooks receive JSON on stdin, including common fields such as `session_id`, `transcript_path`, `cwd`, and event name.
- Claude `SessionStart` also includes fields like `source`, `model`, and optional `agent_type`.
- Claude hooks can persist environment variables for later Bash tool executions through `CLAUDE_ENV_FILE`, but hook invocations are separate executions. Durable cross-process state should live in files or the synchronize daemon.
- Pi extensions support `session_start`.
- Pi session files are JSONL under `~/.pi/agent/sessions/.../<timestamp>_<uuid>.jsonl`, and the first header line contains the session `id`.
- Pi extension instances can be reloaded across session switch/new/resume, so durable state should not rely only on extension memory.

## Proposed Design

Add a daemon-owned "host session binding" concept that links a synchronize peer to a native Claude or Pi session ID.

Keep `peers` as the messaging identity. Store Claude/Pi native session IDs in a separate mapping table.

Core principles:

- The daemon is the only durable owner of host session bindings.
- Hooks are ingestion paths, not long-running state managers.
- MCP remains the interactive messaging adapter, but it can attach to a daemon-known host session.
- Claude hook behavior should be opt-in through synchronize-controlled launch/config. A normal `claude` launch should not silently register unless the user has explicitly installed/enabled that hook path.
- The implementation should support both eager registration from controlled launch paths and lazy attachment from MCP if a binding exists. Lazy attachment is a fallback for synchronize-launched sessions that did not finish eager registration; it is not a reason to globally hook every plain Claude launch.
- Timestamp fields may exist for future diagnostics, but v0 should not build a live update system around them.

Proposed table:

```sql
CREATE TABLE IF NOT EXISTS agent_sessions (
  binding_id TEXT PRIMARY KEY,
  peer_id TEXT NOT NULL REFERENCES peers(peer_id) ON DELETE CASCADE,
  host_tool TEXT NOT NULL,
  host_session_id TEXT NOT NULL,
  host_session_file TEXT,
  cwd TEXT,
  pid INTEGER,
  source TEXT,
  model TEXT,
  agent_type TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(host_tool, host_session_id)
);
```

Implementation note: `updated_at` and `last_seen_at` are intentionally future-facing fields. v0 can write them on register/upsert and maybe on explicit hook calls, but should not add a polling or heartbeat loop just to keep them fresh.

Field meanings:

- `host_tool`: `claude` or `pi`.
- `host_session_id`: native session ID from Claude hook input or Pi session manager/session file.
- `host_session_file`: Claude `transcript_path` or Pi JSONL path if known.
- `peer_id`: synchronize peer representing the agent session.
- `metadata_json`: escape hatch for hook-specific fields without requiring schema churn.

Lease state should remain derivable through `peers.lease_expires_at`. The mapping table does not need its own expiry behavior in v0, but list/read APIs should be able to show whether the linked peer lease is currently expired.

## Lifecycle Diagrams

### Claude, Controlled Launch With Eager Registration

This is the preferred and default-supported path. The Claude hook should only be active when Claude is started through a synchronize-aware launcher, alias, or explicitly generated hook config.

```text
user
  |
  | sync-claude NAME
  v
synchronize launch claude
  |
  | 1. ensure daemon is running
  | 2. choose requested alias/session_name
  | 3. launch claude with synchronize hook config/env enabled
  | 4. pass Claude flags:
  |    --dangerously-skip-permissions
  |    --dangerously-load-development-channels server:synchronize
  v
Claude Code starts
  |
  | SessionStart hook receives JSON on stdin
  | { session_id, transcript_path, cwd, source, model, agent_type }
  v
synchronize hook claude-session
  |
  | POST /agent-sessions/register
  | includes requested alias if launcher supplied one
  v
synchronize daemon
  |
  | upsert peer
  | upsert agent_sessions(host_tool='claude', host_session_id=session_id)
  v
SQLite
  |
  | later: model uses bridge_register / bridge_whoami
  v
MCP adapter
  |
  | asks daemon for binding by host session hints
  | reuses attached peer_id
  v
same synchronize peer is used for messaging
  |
  | verification: bridge_whoami must show
  | native session_id, peer_id, session_name, tool, lease status
```

### Claude, Plain Launch With Hook Disabled

The user preference is that `claude` launched directly should not automatically register in synchronize.

```text
user
  |
  | claude
  v
Claude Code starts
  |
  | no synchronize-controlled launcher/env
  v
Claude runs normally
  |
  | synchronize hook is not configured or exits no-op
  v
daemon receives no session binding
```

Implementation options:

- Preferred: the launcher uses a temporary Claude config directory or generated settings file that contains the synchronize hook, so the user's normal Claude config remains unhooked.
- Acceptable fallback: install the hook globally but require an opt-in environment variable such as `SYNCHRONIZE_HOOK_ENABLE=1`; if absent, `synchronize hook claude-session` exits successfully without registering.

### Claude, Synchronize Launch With Lazy Attachment

This is the fallback path when Claude was started through synchronize, but the eager path cannot set the final human alias up front.

```text
user
  |
  | synchronize launch claude
  v
Claude starts with synchronize hook explicitly enabled
  |
  | SessionStart hook fires
  v
synchronize hook claude-session
  |
  | POST /agent-sessions/register
  | no final alias available
  v
daemon stores binding with provisional alias
  |
  | binding has native session_id + transcript_path + cwd
  | peer_id is assigned once by daemon
  v
model later calls bridge_register(session_name='chosen-name')
  |
  v
MCP adapter
  |
  | asks daemon for recent Claude binding matching cwd/session hints
  | renames the existing peer to chosen-name
  v
daemon updates peer.session_name only
  |
  | peer_id remains unchanged
```

### Claude Rename Flow

The rename operation should be explicit and daemon-backed. `peer_id` remains the primary identifier; native session ID is an alternate lookup key for convenience.

```text
agent/model/operator
  |
  | bridge_register or future bridge_rename_session
  | { peer_id, new_session_name }
  | optional: { host_tool, host_session_id } as alternate lookup
  v
MCP/CLI
  |
  | POST /agent-sessions/rename
  v
daemon
  |
  | find peer by peer_id
  | optionally verify host session binding if supplied
  | update linked peers.session_name
  | preserve same peer_id
  v
future resume/lookups still find the renamed peer
```

### Pi Registration

Pi already has a direct extension API, so it can provide stronger data at startup than Claude MCP can.

```text
Pi coding-agent starts or switches session
  |
  | extension session_start(ctx)
  v
extensions/pi-synchronize
  |
  | ctx.sessionManager.getSessionId()
  | ctx.sessionManager.getSessionName()
  | process.pid
  v
register peer through daemon REST
  |
  | peer_id returned
  | SYNCHRONIZE_PEER_ID set for child MCP process
  v
POST /agent-sessions/register
  |
  | host_tool='pi'
  | host_session_id=<Pi session id>
  | peer_id=<registered synchronize peer>
  v
daemon persists binding in SQLite
  |
  | Pi MCP adapter later starts with SYNCHRONIZE_PEER_ID
  v
bridge_register reuses the same peer_id
```

### Pi Resume / Switch

```text
Pi session_before_switch / session_shutdown
  |
  | stop subscription and peer heartbeat
  v
binding remains durable in daemon
  |
  | later resume same Pi session
  v
session_start gets same native Pi session id
  |
  | upsert agent_sessions(host_tool='pi', host_session_id)
  v
same native session can be correlated to new or reused peer
```

## Codebase Structure

Use the repo's existing domain split instead of adding a parallel one-off path.

Suggested files:

- `src/api/agent-sessions.ts`: typed client helpers for registration, lookup, and rename.
- `src/api/types.ts`: DTOs for `AgentSessionBinding`, register input, and list response.
- `src/cli/commands/hook.ts`: `synchronize hook claude-session` and `synchronize hook pi-session`.
- `src/cli/commands/launch.ts`: optional future `synchronize launch claude/pi`.
- `src/daemon.ts`: v0 route implementation can land here, but if daemon split begins first, use `src/daemon/routes/agent-sessions.ts` and a repository helper.
- `src/db.ts`: schema migration for `agent_sessions`.
- `src/mcp/tools/register.ts`: attach/rename behavior around `bridge_register`.
- `extensions/pi-synchronize/src/index.ts`: replace file-only session marker with daemon-backed binding registration.
- `skills/synchronize-claude/SKILL.md` and `skills/synchronize-pi/SKILL.md`: teach agents how to inspect additional context or call the right MCP tool to confirm their bound session.

Best-practice constraints:

- Do not move CLI identity guardrails into the daemon. The daemon should expose primitives; adapters decide how to use them.
- Keep hooks fast and non-interactive. They should log and return rather than block agent startup.
- Avoid storing host-specific JSON in `peers`; use `agent_sessions.metadata_json`.
- Preserve `peer_id` as the durable messaging identity even when a human-facing alias/session name is renamed.
- Use `peer_id` as the primary identifier for updates. Native `host_session_id` is a secondary lookup and correlation key.
- Keep v0 retention simple: retain mappings by default and expose expired lease status through joins to `peers`.

## API Surface

Add typed API helpers under `src/api/agent-sessions.ts`, then expose daemon routes:

- `POST /agent-sessions/register`
- `POST /agent-sessions/heartbeat`
- `GET /agent-sessions?tool=claude|pi`
- Optional: `GET /agent-sessions/:host_tool/:host_session_id`
- Optional: `POST /agent-sessions/rename`

The registration payload should allow a caller to provide either an existing `peer_id` or enough identity data for the daemon to create or reuse a peer.

Primary rename payload shape:

```json
{
  "peer_id": "sync-peer-id",
  "session_name": "new-alias"
}
```

Alternate rename payload shape, for cases where the caller only has the native host session ID:

```json
{
  "host_tool": "claude",
  "host_session_id": "native-session-id",
  "session_name": "new-alias"
}
```

The daemon should prefer `peer_id` when present. If only `host_tool` and `host_session_id` are supplied, it should resolve the binding to a `peer_id`, update the linked peer's `session_name`, and return the updated binding plus peer summary.

## Hook Command

Add a shared CLI entrypoint:

```bash
synchronize hook claude-session
synchronize hook pi-session
```

Behavior:

- Read JSON from stdin.
- Check opt-in guardrails. For Claude, if the hook is installed globally but `SYNCHRONIZE_HOOK_ENABLE=1` or an equivalent launcher token is absent, exit 0 without registering.
- Validate known fields.
- Discover or start the synchronize daemon.
- Register or upsert an `agent_sessions` binding.
- Exit quickly and non-fatally if the daemon is unavailable, logging enough context for debugging.

This keeps host hook config simple and avoids shell-based JSON parsing.

## Claude Integration

Install a Claude `SessionStart` hook only in the synchronize-controlled launch/config path. Do not make plain `claude` launches auto-register unless the user explicitly installs a global hook and accepts that behavior.

Hook command shape:

```json
{
  "type": "command",
  "command": "synchronize hook claude-session",
  "matcher": ""
}
```

Use hook input fields:

- `session_id`
- `transcript_path`
- `cwd`
- `source`
- `model`
- `agent_type`

Add a `UserPromptSubmit` hook only if real testing shows Claude creates or updates transcript metadata later than `SessionStart`. `SessionStart` should be the primary discovery point; `UserPromptSubmit` can serve as a first-message ingestion point but should not become a live heartbeat system.

## Claude Peer Correlation

The hard part is correlating a Claude hook-created binding with the MCP process.

Do not rely only on `SYNCHRONIZE_PEER_ID` propagation for Claude MCP. Claude hooks can write `CLAUDE_ENV_FILE`, but that does not necessarily update the already-running MCP server process environment.

Support both eager and lazy correlation, while keeping hook activation opt-in:

1. Eager path: `synchronize launch claude` or an alias supplies the desired session name before startup. The `SessionStart` hook registers a synchronize peer immediately and binds it to the native Claude `session_id`.
2. Lazy attachment path: a synchronize-enabled launch stores a provisional binding. When `bridge_register` is called, the MCP adapter asks the daemon for a recent unclaimed Claude binding matching cwd and other available hints, then renames the existing peer.
3. Rename path: if the user wants a better alias later, MCP or CLI calls a daemon rename endpoint using `peer_id` as the primary identifier. The daemon updates the peer's `session_name` while preserving `peer_id` and the host session binding.

Fallback approach:

- The Claude hook injects `additionalContext` or writes a local marker so the model is told the recommended session name/peer binding before it calls `bridge_register`.
- The Claude skill should explicitly teach the model to check that context and prefer the daemon-known session binding before inventing a fresh identity.

## Pi Integration

Replace the current ad hoc `~/.synchronize/pi-sessions/*.json` marker with daemon-backed `agent_sessions` registration.

Keep the file marker only as optional debug output if useful.

Pi already has the right input data because the extension runs inside the Pi process and receives a session context object at `session_start`. Unlike Claude MCP, it does not need to infer the native session from a separate hook process and then correlate it later.

Available Pi-side inputs:

- native Pi session ID
- native Pi session name, when available
- process pid
- resolved synchronize session name
- synchronize peer id returned by peer registration

Expected Pi flow:

1. On `session_start`, the Pi extension calls `ctx.sessionManager.getSessionId()`.
2. It resolves the human-facing session name from Pi's session name, `SYNCHRONIZE_SESSION_NAME`, or a generated fallback.
3. It registers a synchronize peer with tool `pi`.
4. It sets `SYNCHRONIZE_PEER_ID` so child MCP processes reuse the same peer.
5. It calls `POST /agent-sessions/register` with `host_tool='pi'`, the native Pi session ID, and the synchronize `peer_id`.
6. On resume/switch, it upserts the same binding instead of relying on a stale local marker.

The Pi skill should also mention that `bridge_whoami` should reflect the extension-registered peer and that the model should not invent a second identity unless the binding is missing.

## Spawn / Wrapper Path

Add wrapper commands that warm and configure synchronize before launching agents. These are real convenience entrypoints, not merely shell aliases, because they need to perform multiple checks before delegating to the underlying agent binary.

```bash
synchronize launch claude [--name NAME] [--] [additional claude args]
synchronize launch pi [--name NAME] [--] [additional pi args]
```

The `--` delimiter means "stop parsing synchronize flags; pass everything after this directly to the underlying agent command." For example:

```bash
synchronize launch claude --name backend-review -- --model sonnet
```

Responsibilities:

- Run `synchronize status` to start the daemon.
- Ensure MCP, extension, skill, and env-gated hook config are installed.
- Set `SYNCHRONIZE_HOOK_ENABLE=1` only for the launched agent process so normal `claude` launches remain unregistered.
- Optionally set stable environment variables such as `SYNCHRONIZE_SESSION_NAME`.
- Launch `claude` or `pi`.
- For Claude, pass these defaults unless explicitly overridden:
  - `--dangerously-skip-permissions`
  - `--dangerously-load-development-channels server:synchronize`

The development-channel flag is required for local custom Claude channel testing during the research preview. The documented shape is `--dangerously-load-development-channels server:<name>`; this repo's MCP server name is `synchronize`, so use `server:synchronize`.

Possible shell aliases can wrap these commands later:

```bash
alias sclaude='synchronize launch claude --'
alias spi='synchronize launch pi --'
```

This is useful but secondary. Hooks should still work when the user launches the agent normally.

## Verification Plan

Add tests for:

- daemon migration and session binding CRUD
- CLI hook command consuming Claude-like stdin JSON
- Pi extension registering `agent_sessions`
- MCP `bridge_register` reusing or associating with a daemon-known binding
- daemon-backed rename preserving `peer_id` and updating `session_name`
- `bridge_whoami` returning the native host session ID, `peer_id`, `session_name`, tool, and lease/expiry state after a synchronize-launched Claude session starts
- plain `claude` launch does not register unless the synchronize hook is explicitly enabled
- resume behavior: same host session ID updates existing binding instead of creating duplicate rows

Manual verification:

- Start Claude through `synchronize launch claude --name NAME`.
- Confirm daemon has a Claude `agent_sessions` row with native `session_id` and `transcript_path`.
- Call `bridge_whoami` and confirm it shows the expected `session_id`, `peer_id`, `session_name`, tool, and lease state.
- Register over MCP and confirm the binding is attached to the same peer.
- Rename the session alias and confirm native session lookup still resolves to the same peer.
- Start Claude directly without the synchronize launcher and confirm no binding is created.
- Start Pi with extension installed and confirm the same path works for Pi.
- Resume a known session and confirm the previous native session ID can be located.

## Decisions From Annotation

1. Support both eager and lazy Claude attachment, but keep Claude hook activation opt-in through an env-gated global hook. The hook may be present in Claude settings, but it should no-op unless `SYNCHRONIZE_HOOK_ENABLE=1` is present.
2. Keep session mappings retained by default in v0.
3. Expose whether the linked peer lease is expired, but do not implement pruning yet.
4. Add an explicit rename path so a peer can be mapped to a better human-facing alias after startup. `peer_id` is primary; native session ID is secondary.
5. Treat `synchronize launch claude/pi` as real subcommands. Shell aliases can be thin wrappers over those commands.
6. Default generated Claude aliases can use a three-part pattern such as `adjective-verb-noun`. Prefer a small TypeScript-friendly generator package if it is lightweight enough; `unique-names-generator` is a candidate because it ships TypeScript declarations, has built-in dictionaries, and can generate dashed names from selected dictionaries.
7. Expose rename both as a dedicated MCP tool and as behavior folded into `bridge_register` when it detects a provisional binding.
8. Remove debug marker files from the plan unless implementation proves they are needed; daemon-backed state is the source of truth.
9. The exact alias word lists are not architecturally important. Pick a simple built-in or local dictionary during implementation, then verify generated aliases are readable and collision-handled.
