# SQL Event Query Surface and Thread Discovery Plan

## Goal

Make Synchronize's durable event log queryable through a guarded SQL surface,
while adding first-class thread discovery and thread-status workflows for agents.
The implementation should improve MCP and CLI ergonomics without turning every
bounded domain operation into SQL.

## Current State

- Events already live in SQLite in the daemon-owned `events` table.
- Delivery/read state lives in `inbox`.
- Existing access is fixed-shape: inbox reads, peer event cursor reads, group
  history, event-by-id, and a daemon-only `GET /threads/:root_event_id` route.
- The dedicated thread route is tested but is not yet exposed through the typed
  API facade, CLI, or MCP tools.
- There is no general SQL query endpoint today.

## Product Decisions

- Thread discovery is first-class, not SQL-only.
- A discoverable thread is a root group message with at least one reply.
- Thread status is a dedicated API/MCP capability, not primarily a SQL view.
- Thread status is derived activity/statistics only; it is not a workflow state
  such as open, resolved, or blocked.
- V0 thread discovery/status uses global daemon visibility. Peer-scoped
  visibility can be added later.
- The SQL query surface accepts raw read-only SQL with strict guardrails.
- SQL may expose raw daemon tables, but should also provide friendlier read-only
  views for common agent queries.
- Thread retrieval should support both structured JSON and deterministic
  transcript output.

## Thread Surfaces

### Dedicated API

Add typed REST support for:

```text
GET /threads
GET /threads/:root_event_id
GET /threads/:root_event_id/status
```

`GET /threads` supports:

```ts
{
  group?: string;
  started_by_peer_id?: string;
  started_by_session_name?: string;
  participated_by_peer_id?: string;
  participated_by_session_name?: string;
  active_since?: string;
  limit?: number;
}
```

Results are ordered by:

```text
last_activity_at DESC, root_event_id DESC
```

Discovery rows include:

```ts
{
  root_event_id: number;
  group_name: string;
  root_sender_peer_id: string | null;
  root_sender_session_name: string | null;
  root_sender_alias: string | null;
  created_at: string;
  last_activity_at: string;
  reply_count: number;
  participant_count: number;
  preview: string | null;
}
```

Thread status includes:

```ts
{
  root_event_id: number;
  group_id: number;
  group_name: string;
  root_sender_peer_id: string | null;
  root_sender_session_name: string | null;
  root_sender_alias: string | null;
  created_at: string;
  last_event_id: number;
  last_activity_at: string;
  reply_count: number;
  event_count: number;
  participant_count: number;
  participants: Array<{
    peer_id: string;
    session_name: string | null;
    alias: string | null;
    active: boolean;
    event_count: number;
    first_event_id: number;
    last_event_id: number;
    last_activity_at: string;
  }>;
}
```

Thread retrieval returns:

```ts
{
  status: ThreadStatus;
  events: Event[];
  transcript?: string;
}
```

### MCP Tools

Add:

```text
bridge_list_threads
bridge_get_thread_status
bridge_get_thread
```

`bridge_get_thread` should accept:

```ts
{
  root_event_id: number;
  format?: "json" | "transcript";
}
```

MCP thread tools are the preferred agent workflow for common thread operations.

### CLI Commands

Add:

```bash
synchronize threads list [--group NAME] [--started-by SESSION_OR_PEER] [--participated-by SESSION_OR_PEER] [--active-since ISO] [--limit N]
synchronize threads status ROOT_EVENT_ID
synchronize threads show ROOT_EVENT_ID --format json|transcript
```

## SQL Query Surface

### Endpoint and Facade

Add:

```text
POST /query/events
src/api/query.ts
```

Request:

```ts
{
  sql: string;
  params?: unknown[];
  limit?: number;
}
```

Response:

```ts
{
  columns: string[];
  rows: Record<string, unknown>[];
  row_count: number;
  truncated: boolean;
  elapsed_ms: number;
}
```

### Guardrails

Allow:

```text
SELECT ...
WITH ... SELECT ...
```

Reject:

```text
INSERT, UPDATE, DELETE, DROP, ALTER, CREATE
PRAGMA
ATTACH, DETACH
VACUUM
multiple statements
```

Use bound parameters for caller-provided values. Enforce a default result limit
and a hard max result limit.

### Friendly Views

Expose raw daemon tables and add read-only views:

```text
event_log
thread_events
discoverable_threads
```

`event_log` should join event rows with useful group/sender/recipient context.

`thread_events` should support:

```sql
select *
from thread_events
where thread_root_event_id = ?
order by created_at, event_id;
```

`discoverable_threads` should include root group messages with at least one
reply and lightweight discovery fields.

### CLI

Add:

```bash
synchronize query --format json|table|csv 'select * from event_log limit 10'
```

## Skills Track

Agents need to know these capabilities exist, so documentation and skill packs
are part of the implementation, not follow-up polish.

Update:

```text
skills/synchronize-claude/SKILL.md
skills/synchronize-codex/SKILL.md
skills/synchronize-pi/SKILL.md
```

Each skill should teach:

- Use `bridge_list_threads` to discover deeper conversations.
- Use `bridge_get_thread_status` when given a root event id and needing compact
  activity/statistics.
- Use `bridge_get_thread` with `format: "transcript"` when the agent needs to
  quickly understand the conversation.
- Use `bridge_query_events` for deeper ad hoc SQL inspection.
- Prefer dedicated thread tools for common workflows; use SQL when the question
  requires custom filtering, joins, or broader event-log context.
- Root messages without replies are not discoverable threads; query general
  events when inspecting standalone messages.

Also update:

```text
README.md
src/cli/help.ts
MCP tool descriptions
```

The CLI help and skill docs should include examples for:

```text
bridge_list_threads({ group: "demo" })
bridge_get_thread_status({ root_event_id: 123 })
bridge_get_thread({ root_event_id: 123, format: "transcript" })
bridge_query_events({ sql: "select * from thread_events where thread_root_event_id = ?", params: [123] })
```

## Implementation Steps

1. Add query DTOs and thread DTOs to `src/api/types.ts`.
2. Add read-only query infrastructure under `src/query/`.
3. Add database views in migration setup.
4. Add `src/api/query.ts` and `src/api/threads.ts`, then export them from
   `src/api/index.ts`.
5. Add daemon routes for `POST /query/events`, `GET /threads`, and
   `GET /threads/:root_event_id/status`; adapt the existing thread route into
   the typed facade.
6. Add MCP tools for event query and thread operations.
7. Add CLI `query` and `threads` commands.
8. Update README, CLI help, MCP descriptions, and skill packs.
9. Add tests for daemon routes, API facade, MCP tools, CLI commands, query
   guardrails, friendly views, and transcript formatting.

## Test Coverage

Cover:

- SQL guard rejects mutation/control/multiple-statement input.
- Bound params work.
- Result limit and truncation work.
- `event_log` exposes sender/group context.
- `thread_events` returns root and replies in chronological order.
- `discoverable_threads` excludes root messages with zero replies.
- Dedicated thread discovery filters by group, starter, participant, active
  since, and limit.
- Thread status returns the minimum agreed shape.
- Thread transcript is deterministic.
- MCP tools return agent-friendly payloads.
- CLI commands support JSON/table/transcript formats.

