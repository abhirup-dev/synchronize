# delivery-forensics.md

Use this for "message X did not arrive" across DMs, groups, threads, mentions,
media, web, and MCP/Pi push surfaces.

## Mental Model

```text
send request
  |
  +--> events row
  |
  +--> inbox rows       durable fallback
  |
  +--> push callbacks   best-effort live channel
```

`pushed_to: []` with inbox rows present means the message was delivered
durably but no live callback fired. That is usually a peer/subscription problem,
not missing data.

## First Checks

1. Inspect the send response if available: `delivery.pushed_to`, `inbox_only`,
   and `warnings`.
2. Run `make inspect-events N=50` and confirm the event exists.
3. Query inbox rows for the recipient(s); use `docs/debugging/sql-queries.md`.
4. If the peer is online but never pushed, switch to `peer-lifecycle.md`.

## Current Delivery Sources

| Surface | Source |
|---|---|
| DM send | `src/daemon/routes/messaging.ts` |
| Group send and group replies | `src/daemon/routes/groups.ts` |
| Shared send helpers, mention parsing, target selection | `src/daemon/server.ts` |
| Push subscription registry | `src/daemon/routes/subscriptions.ts`, `src/daemon/services/subscriptions.ts` |
| Inbox reads/acks | `src/daemon/routes/inbox.ts`, `src/api/inbox.ts` |
| Thread APIs | `src/daemon/routes/threads.ts`, `src/daemon/repo/threads.ts` |
| Media route/repo | `src/daemon/routes/media.ts`, `src/daemon/repo/media.ts` |
| Query recipes | `docs/debugging/sql-queries.md` |

## Common Traps

| Trap | Diagnostic |
|---|---|
| Mention used `session_name` instead of group alias | Check `group_members.alias`; mentions resolve by alias. |
| Peer is alive by lease but has no callback | `pushed_to: []`; inspect subscriptions/logs and use `peer-lifecycle.md`. |
| Reply-to-reply looks nested | Threads are normalized to one root via `parent_event_id`; exact direct target is `reply_to_event_id`. |
| Missed push after daemon restart | Subscriber map is in-memory; clients must reconnect/resubscribe. Inbox remains durable. |
| Looking for historical push outcome | Push fan-out is not persisted; only the send response records it. |

## Decision Tree

```text
recipient did not see message
  |
  +-- event missing? ----------> send path failed; inspect sender/tool response
  |
  +-- inbox row exists? -------> durable delivery worked; inspect push/subscriber path
  |
  +-- group mention involved? -> validate alias and warnings
  |
  +-- thread involved? -------> inspect parent_event_id and reply_to_event_id
```

## See Also

- `docs/debugging/sql-queries.md` for copy-paste queries.
- `reply-target-forensics.md` for direct reply target reporting.
- `glossary.md` for current code locations.
