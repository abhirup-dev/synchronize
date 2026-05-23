# Agent Sessions And Hooks Series

Covers native agent-session correlation, auto-registration, and hook setup. Search terms: agent sessions, hooks, auto registration, Claude, Pi, launch, SYNCHRONIZE_SESSION_NAME.

## Why this exists

Synchronize now correlates external coding-agent sessions with daemon peers. This lets tools recover or display which native host session is attached to a peer, instead of only knowing the peer id/name.

## Backend/API pieces

`src/db.ts` adds an `agent_sessions` table and indexes.

`src/api/agent-sessions.ts` exposes:

- `registerAgentSession(client, input)`.
- `listAgentSessions(client, tool?)`.
- `renameAgentSession(client, input)`.

`src/daemon.ts` serves:

- `POST /agent-sessions/register`.
- `GET /agent-sessions`.
- `GET /agent-sessions/:tool/:host_session_id`.
- `POST /agent-sessions/rename`.

Group member listings can carry `host_session_id` when an `agent_sessions` binding exists.

## Environment and identity

`SYNCHRONIZE_SESSION_NAME` was added as `ENV_SESSION_NAME`. It gives hook/Pi-style integrations an explicit session name override, avoiding unstable fallback names.

`SYNCHRONIZE_PEER_ID` remains the sticky peer-id env var used by MCP/Pi registration paths.

## CLI and scripts

`src/cli/commands/hook.ts` and `src/cli/commands/launch.ts` implement user/operator command surfaces for auto-registration and launch flows.

`scripts/claude-hooks-config.ts` writes/merges Claude hook configuration for synchronize. It is intended to be idempotent, similar in spirit to `scripts/pi-mcp-config.ts`.

`AUTO_REGISTRATION.md` documents the workflow.

## Pi extension tie-in

`extensions/pi-synchronize/src/index.ts` now honors `SYNCHRONIZE_SESSION_NAME` over the Pi session id fallback. This matters for deterministic AoE/Pi integration tests and for stable peer naming in real use.

## Tests and docs

- `tests/api.test.ts` covers agent session bindings upsert/rename and group member host-session surfacing.
- `tests/messaging.test.ts` uses `SYNCHRONIZE_SESSION_NAME` in hook-related paths.
- `scripts/integration-aoe/sync_itest_aoe/scenarios/pi_mcp_dm.py` checks agent-session state from real Pi/AoE runs.
