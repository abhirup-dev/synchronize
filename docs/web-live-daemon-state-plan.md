# Web Live Daemon State Plan

## Summary

Wire the demo web UI to production daemon state by adding a daemon read-model endpoint and a browser-friendly live invalidation stream. The React UI keeps the existing `DataSource` abstraction, but the default `/web` experience uses daemon state instead of seed data. Performance details are governed by `docs/high-performance-design.md`.

The implementation should optimize for smoothness with large event histories: the daemon sends compact invalidation events, the client refetches bounded state, and the UI renders bounded/virtualized lists instead of thousands of DOM rows.

## Key Changes

- Add daemon web state APIs:
  - `GET /web/state` without `room=` returns peers, groups, active memberships, room summaries, daemon metadata, and a durable event cursor.
  - `GET /web/state?room=group:<id>` and `GET /web/state?room=dm:<peer_id>` return bounded room-scoped event history using existing indexes.
  - `GET /web/events` returns an SSE stream of coarse `state_changed` invalidations.
  - Mutating daemon routes call a shared state-change notifier after successful writes.
- Implement `DaemonDataSource`:
  - Register or reuse a sticky `web:` peer from `localStorage`.
  - Load `/web/state`, map daemon rows into UI `Agent`, `Room`, `Message`, `TimelineEvent`, and `Artifact` types, and update `useSyncExternalStore` snapshots.
  - Listen to `/web/events`; on invalidation, refetch state. Fall back to polling when the stream disconnects.
  - Send group and DM messages through daemon REST APIs.
- Update app boot:
  - Default to daemon mode under `/web`.
  - Keep mock mode available through `localStorage.SYNCHRONIZE_DATA_SOURCE = "mock"`.
  - Show connection/auth errors instead of silently rendering fake data.
- Performance pass:
  - Bound daemon state responses by default and avoid global event snapshots.
  - Lazy-load only hot room/thread streams.
  - Coalesce SSE invalidations before refetching.
  - Virtualize chat/thread rows and keep row rendering memo-friendly.
  - Prefer SSE as invalidation, not as a bulk payload transport.

## Interfaces

- `WebStateResponse`:
  - `ok`, `generated_at`, `cursor`, `daemon`
  - `peers`
  - `groups`
  - `memberships`
  - `events`
  - `media`
- `WebStateChange`:
  - `cursor`
  - `type`: `connected | state_changed`
  - `domains`
  - optional `event_id`, `group_id`, `peer_id`
- `DaemonDataSourceOptions`:
  - `baseUrl?: string`
  - `token?: string`
  - `pollMs?: number`
  - `stateLimit?: number`

## Test Plan

- Daemon tests:
  - `/web/state` reflects registered peers, groups, memberships, messages, DMs, thread replies, and media.
  - `/web/events` emits after a message is written.
  - Auth-protected daemon rejects missing tokens and accepts valid tokens.
- Web adapter tests or integration smoke:
  - `DaemonDataSource.connect()` registers a sticky web peer and populates snapshots.
  - Sending a group message round-trips through daemon APIs and refreshes snapshots.
  - SSE disconnect falls back to polling.
- Quality gates:
  - `bun test`
  - `bun run typecheck`
  - `cd web && bun run typecheck && bun run build`

## Assumptions

- Production `/web` should not silently fall back to mock data when the daemon is unavailable.
- Correctness takes priority over fine-grained patching; invalidation plus bounded refetch is the first production implementation.
- Mock mode remains explicit for design and demo work.
