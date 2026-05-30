# Backend / Daemon Runtime Series

Updated after the 2026-05-23 group-policy and operator-flow work. This memory covers daemon/runtime changes that are not fully represented in the older `architecture` and `environment_variables` memories.

## Current daemon shape

`src/daemon.ts` is still the durable-state owner and remains a large monolith. It now owns more product behavior than the 2026-05-22 memories imply:

- REST route dispatch and validation.
- SQLite repository operations.
- group policy semantics.
- thread and mention normalization.
- event fanout to inbox and live subscribers.
- media filesystem writes.
- `/web` static serving.
- daemon discovery file writes under `SYNCHRONIZE_HOME`.

Important route families now include:

- `/agent-sessions/register`, `/agent-sessions`, `/agent-sessions/:tool/:host_session_id`, `/agent-sessions/rename`.
- `/peers/register`, `/peers/:peer_id/heartbeat`, `/peers`, `/peers/:peer_id` soft-delete.
- `/groups`, `/groups/:name`, `/groups/:name/join`, `/groups/:name/rename`, `/groups/:name/leave`, `/groups/:name/messages`, `/groups/:name/history`.
- `/events/:event_id`, `/events/:peer_id`.
- `/threads/:root_event_id`.
- `/groups/:name/media`, `/media/:media_id`.
- `/peers/:peer_id/inbox`, `/peers/:peer_id/inbox/ack`.
- `/subscriptions` for callback delivery.

## Runtime defaults changed

`DEFAULT_PORT` in `src/constants.ts` is now `58405`. The older memory that says the daemon chooses a random port by default is stale. `SYNCHRONIZE_PORT` can still override the port, but long-lived local clients now expect the pinned default unless tests isolate via `SYNCHRONIZE_HOME`/port config.

`SYNCHRONIZE_SESSION_NAME` was added as `ENV_SESSION_NAME`. It is used by hooks/Pi-style session registration to bind a native session to a stable synchronize peer identity.

## Peer lifecycle

Peers are soft-deleted, not hard-deleted. `peers.deleted_at` was added in `src/db.ts` and all ordinary peer reads filter `deleted_at IS NULL`.

Re-registering a soft-deleted `peer_id` resurrects the peer and clears `deleted_at`. This preserves audit/history while letting a stable peer id come back after deletion.

## Database migrations to remember

Recent schema additions include:

- `agent_sessions` table and indexes for host/native session correlation.
- `events.parent_event_id` for Slack-style threads.
- `events.mentions_json` for resolved peer-id mentions.
- `groups.description` for room/topic metadata.
- `peers.deleted_at` for soft-delete.
- canonical event type CHECK via `EVENT_TYPE_CHECK` in `src/db.ts` / `src/constants.ts`.

## High-risk daemon invariants

- The daemon remains the only durable-state owner. CLI, MCP, Pi extension, and web must go through REST/API facades.
- Inboxes are durable fallback and are still written broadly even when live push is selective.
- Thread replies collapse to the root event. Reply-to-reply does not create nested threads.
- Mention parsing must ignore single-backtick and triple-backtick regions.
- Non-localhost bind still requires bearer-token protection.
- Web static serving uses `SYNCHRONIZE_WEB_DIST` or `../web/dist` and is separate from the web DataSource runtime behavior.

## Useful files

- `src/daemon.ts` — route behavior and validation.
- `src/db.ts` — migrations and canonical event type constraints.
- `src/constants.ts` — default port, env vars, event types.
- `tests/api.test.ts` — best executable spec for server-side behavior.
- `docs/group-sync-integrity.md` — human reference for group registration/sync integrity.
