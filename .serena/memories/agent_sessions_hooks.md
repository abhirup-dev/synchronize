# Agent Sessions, Hooks, And AOE Launch

Search terms: agent sessions, hooks, AOE, launch, bridge_launch, reconcileLaunch, pendingLaunches, Haiku, SYNCHRONIZE_LAUNCH_ID.

## Agent-session binding

- `src/db.ts` stores native host sessions in `agent_sessions` with `peer_id`, `host_tool`, `host_session_id`, `model`, `agent_type`, `metadata_json`, and optional `launch_id`.
- `src/api/agent-sessions.ts` exposes `registerAgentSession`, `listAgentSessions`, `renameAgentSession`, `launchAgent`, and `stopAgent` client helpers.
- `src/daemon.ts` serves `/agent-sessions/register`, `/agent-sessions`, `/agent-sessions/:tool/:host_session_id`, `/agent-sessions/rename`, `/agent-sessions/launch`, and `/agent-sessions/stop`.

## Claude/Pi hooks

- `scripts/claude-hooks-config.ts` installs env-gated Claude hooks: `SessionStart` -> `synchronize hook claude-session`; `UserPromptSubmit` and `PreToolUse` -> working activity; `Stop` -> idle activity.
- `src/cli/commands/hook.ts` ingests Claude SessionStart JSON, requires `session_id`, and registers the binding. It forwards `SYNCHRONIZE_LAUNCH_ID`, `SYNCHRONIZE_PEER_ID`, `SYNCHRONIZE_SESSION_NAME`, cwd, transcript path, source, model, and agent type when available.
- Pi hook ingestion uses the same `launch_id` / `peer_id` / `session_name` environment shape.

## AOE-backed launch flow

- MCP `bridge_launch` in `src/mcp/tools/launch.ts` calls `launchAgent`, which posts to daemon `/agent-sessions/launch`.
- `LaunchService.launch()` mints `launchId` and pinned `peerId`, resolves a `LaunchSpec`, records a pending intent before spawning, and deletes the intent on backend spawn failure.
- `src/launch/backend.ts` uses an AOE profile derived from `SYNCHRONIZE_HOME`, runs `aoe add --cmd-override env ... <agent argv>`, then `aoe session start <title>`. It never uses `add --launch` because headless launch can report terminal-open failures.
- Launched agents inherit `SYNCHRONIZE_HOOK_ENABLE=1`, `SYNCHRONIZE_LAUNCH_ID`, `SYNCHRONIZE_PEER_ID`, `SYNCHRONIZE_SESSION_NAME`, and `SYNCHRONIZE_HOME`.
- Claude launch commands add dev-channel live push flags and, unless the caller provides `--model`, default to `--model haiku` in `src/launch/service.ts`. This is the Haiku/Hiku launch-path default only; foreground `synchronize launch` is not forced to Haiku.
- On `/agent-sessions/register`, `reconcileLaunch(ctx, launch_id, peer_id)` consumes the pending intent only when the registering `peer_id` matches the pinned peer id. If a group was requested, it creates the group if needed and joins the peer as alias = launch name with fresh history.
- Alias collisions during auto-join are logged as `join_failed` and do not block registration; the launched session remains alive but unjoined.
- `bridge_stop` / `/agent-sessions/stop` can stop by explicit AOE title or by peer id. Stop-by-title is more reliable before registration or after peer rename.

## Current gotchas

- Model override detection currently checks only a literal `--model` arg. A caller using `--model=opus` style args may still get the default `--model haiku` prepended.
- MCP env-bound bootstrap currently tries `launch_id` before `SYNCHRONIZE_PEER_ID`; launched sessions carry both, so prefer peer-id filtering if hardening this path.
- Pending launch intents are in-memory only. They clear on consume, spawn failure, or stop-by-title; a launched agent that never registers leaves an operator-visible pending warning until manually cleaned up.
