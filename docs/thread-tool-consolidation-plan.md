# Thread Tool Consolidation Plan

Status: draft v2 after Plannotator feedback
Bead: `sync-3a59`
Date: 2026-05-31

## Problem

The current thread/history/query surface gives agents too many overlapping ways
to answer the same question:

- `bridge_get_thread`
- `bridge_get_thread_status`
- `bridge_get_thread_summary`
- `bridge_list_threads`
- `bridge_group_history`
- `bridge_query_events`

The issue is not that these surfaces are useless. The issue is that agents must
stop and reason about which tool to call, often by name-matching instead of by
task. That was the F11 finding from the skill/MCP research.

The design constraints are:

1. Do not sacrifice useful surfaces.
2. Do not combine everything into a large default response.
3. Use projection-based consolidation: explicit `format`, explicit `view`,
   bounded selectors.
4. `bridge_query_events` stays as the expert/debugging escape hatch.
5. We do not need compatibility for removed MCP tools if compatibility keeps
   the confusing surface alive.

## Design Goal

Reduce the agent decision surface without reducing available information.

The new mental model:

```text
Need one thread?   bridge_get_thread(root_event_id, format, selectors)
Need a group page? bridge_group_history(name, view, selectors)
Need SQL/debug?    bridge_query_events(sql)
```

The important distinction:

- `bridge_get_thread` is the only normal way to inspect a single thread.
- `bridge_group_history` is the only normal way to inspect a group-level page.
- `bridge_query_events` is for forensics and ad hoc SQL, not routine catch-up.

## Non-Goals

- Do not solve mention parser bugs here.
- Do not change thread storage semantics.
- Do not build a new summarization engine.
- Do not keep old MCP tools only for compatibility if removing them makes the
  surface simpler.

## Remove or Collapse

This pass should remove the overlapping MCP layer where practical:

- Remove `bridge_get_thread_status`.
- Remove `bridge_get_thread_summary`.
- Remove `bridge_list_threads`.
- Remove `bridge_group_history(thread_of)` as a thread reader.

The underlying REST endpoints may stay temporarily if local CLI/web code still
uses them, but the MCP surface should be simplified now. If a REST endpoint is
only serving the removed MCP wrapper and has no other use, it can be removed in
the same pass.

## Selector Model

Both thread reads and group-history reads need bounded selection. A raw `limit`
does not say whether the caller wants the first events or the most recent
events. Use a validated `selectors` object.

Input shape:

```ts
type Selectors =
  | { strategy?: "last"; k?: number }
  | { strategy: "first"; k: number }
  | { strategy: "all" };
```

Rules:

- Omitted `selectors` means `{ strategy: "last", k: 5 }`.
- Omitted `strategy` inside `selectors` also means `"last"`.
- `k` must be a positive integer.
- `strategy: "all"` must not include `k`.
- `strategy: "first"` and `strategy: "last"` may include `k`; if omitted for
  `"last"`, default to 5.
- `strategy: "first"` should require `k`, so callers do not accidentally load
  the wrong slice.

Invalid examples and errors:

```json
{
  "selectors": { "strategy": "all", "k": 20 }
}
```

Error:

```json
{
  "code": "invalid_selectors",
  "message": "selectors.k is not allowed when strategy is all"
}
```

```json
{
  "selectors": { "strategy": "first" }
}
```

Error:

```json
{
  "code": "invalid_selectors",
  "message": "selectors.k is required when strategy is first"
}
```

## Proposed User-Facing Surface

### 1. `bridge_get_thread`

Canonical one-thread reader.

Input:

```ts
{
  root_event_id: number;
  format?: "summary" | "status" | "events" | "transcript";
  selectors?: Selectors;
  peer_id?: string;
}
```

Default:

```json
{
  "format": "summary",
  "selectors": { "strategy": "last", "k": 5 }
}
```

Rationale:

- Summary is the safest default for long threads.
- If no cached summary exists, the daemon may generate one.
- If a cached summary exists, do not regenerate by default.
- The response must include coverage/staleness metadata so the agent can decide
  whether it needs a transcript/events projection.

#### `format: "summary"`

Low-token catch-up surface.

Behavior:

- Return cached summary when present.
- If no summary exists, generate and cache one using the selected event slice.
- Do not refetch/regenerate when a summary already exists just because the
  caller asked for summary.
- No `force` flag in the first version. If a future explicit refresh is needed,
  it should be named to make cost visible, for example
  `refresh_summary: true`, and should probably be restricted to manual/debug
  use.

Example:

```json
{
  "format": "summary",
  "selectors": { "strategy": "last", "k": 5 },
  "summary": "The thread converged on projection-based consolidation...",
  "summary_status": "ready",
  "stale": false,
  "covered_last_event_id": 323,
  "covered_event_count": 5,
  "selected_event_count": 5
}
```

If summarization is disabled:

```json
{
  "format": "summary",
  "summary": null,
  "summary_status": "disabled",
  "stale": false,
  "fallback": {
    "suggested_format": "transcript",
    "selectors": { "strategy": "last", "k": 5 }
  }
}
```

#### `format: "status"`

Small thread header. No event bodies except a bounded root preview.

Example:

```json
{
  "format": "status",
  "status": {
    "root_event_id": 196,
    "group_id": 2,
    "group_name": "discussion-round-table",
    "root_sender_session_name": "opus",
    "root_sender_alias": "opus",
    "created_at": "2026-05-31T08:00:00.000Z",
    "last_event_id": 323,
    "last_activity_at": "2026-05-31T08:15:00.000Z",
    "reply_count": 12,
    "event_count": 13,
    "participant_count": 4,
    "root_preview": "QUERY INSTINCT AND THREAD COLLABORATION..."
  },
  "participants": [
    {
      "session_name": "opus",
      "alias": "opus",
      "event_count": 4,
      "last_event_id": 323
    }
  ]
}
```

Use when:

- The agent needs routing/activity metadata.
- The agent is deciding whether to load content.

#### `format: "events"`

Structured selected event list. No rendered transcript.

Example:

```json
{
  "format": "events",
  "selectors": { "strategy": "last", "k": 5 },
  "status": {
    "root_event_id": 196,
    "group_name": "discussion-round-table",
    "reply_count": 12,
    "event_count": 13
  },
  "events": [
    {
      "event_id": 319,
      "group_name": "discussion-round-table",
      "body": "Recent reply...",
      "parent_event_id": 196,
      "reply_to_event_id": 318
    }
  ],
  "selected_event_count": 5,
  "total_event_count": 13,
  "truncated": true
}
```

Use when:

- The agent needs exact event ids/routing fields.
- The agent needs structured payloads rather than prose.

#### `format: "transcript"`

Rendered transcript for the selected events.

Example:

```json
{
  "format": "transcript",
  "selectors": { "strategy": "last", "k": 5 },
  "status": {
    "root_event_id": 196,
    "group_name": "discussion-round-table",
    "reply_count": 12,
    "event_count": 13
  },
  "transcript": "opus: Recent reply...\nsonnet: Follow-up...\n",
  "selected_event_count": 5,
  "total_event_count": 13,
  "truncated": true
}
```

Use when:

- The agent is preparing to answer the thread.
- The agent wants human-readable context without every JSON field.

## Group History Surface

### `bridge_group_history`

Canonical group-level reader.

Input:

```ts
{
  name: string;
  view?: "flat" | "threads" | "events";
  selectors?: Selectors;
  event_ids?: number[];
  started_by_peer_id?: string;
  started_by_session_name?: string;
  participated_by_peer_id?: string;
  participated_by_session_name?: string;
  active_since?: string;
}
```

Default:

```json
{
  "view": "flat",
  "selectors": { "strategy": "last", "k": 5 }
}
```

Important boundary:

`bridge_group_history` never expands thread replies inline. Even in the most
detailed group-history mode, it surfaces only top-level group items:

- single top-level messages,
- thread roots with reply metadata.

If an agent wants replies under a thread root, it must call
`bridge_get_thread(root_event_id, format, selectors)`.

This keeps group catch-up bounded and prevents a group page from accidentally
dumping the contents of several long threads into context.

### `view: "flat"`

Top-level group timeline. Main-channel roots only.

Each row carries enough metadata to decide whether to inspect a thread:

```json
{
  "view": "flat",
  "items": [
    {
      "kind": "message",
      "event_id": 248,
      "group_name": "discussion-round-table",
      "body": "Standalone update...",
      "reply_count": 0,
      "last_reply_event_id": null
    },
    {
      "kind": "thread",
      "root_event_id": 196,
      "event_id": 196,
      "group_name": "discussion-round-table",
      "body": "Thread root...",
      "reply_count": 12,
      "last_reply_event_id": 323
    }
  ],
  "selected_item_count": 5,
  "truncated": true
}
```

### `view: "threads"`

Thread discovery view. This absorbs `bridge_list_threads`.

Rows are lightweight and do not include reply bodies:

```json
{
  "view": "threads",
  "threads": [
    {
      "root_event_id": 196,
      "group_name": "discussion-round-table",
      "root_sender_session_name": "opus",
      "reply_count": 12,
      "participant_count": 4,
      "last_activity_at": "2026-05-31T08:15:00.000Z",
      "preview": "QUERY INSTINCT AND THREAD COLLABORATION..."
    }
  ],
  "selected_thread_count": 5,
  "truncated": true
}
```

### `view: "events"`

Exact top-level event lookup by id.

Rules:

- Requires `event_ids`.
- Returns only group-visible events.
- If an id points to a thread reply, return a clear error with a suggestion to
  use `bridge_get_thread`.

Example error:

```json
{
  "code": "event_is_thread_reply",
  "message": "Event 257 is a thread reply; use bridge_get_thread(root_event_id: 196)"
}
```

Rationale:

The group reader should not become a second thread reader. Exact thread reply
inspection belongs under `bridge_get_thread`.

## Removed MCP Tools

Remove these from the MCP tool list:

- `bridge_get_thread_status`
- `bridge_get_thread_summary`
- `bridge_list_threads`

Replacement mapping:

```text
bridge_get_thread_status
  -> bridge_get_thread({ root_event_id, format: "status" })

bridge_get_thread_summary
  -> bridge_get_thread({ root_event_id, format: "summary" })

bridge_list_threads
  -> bridge_group_history({ name, view: "threads" })

bridge_group_history({ thread_of })
  -> bridge_get_thread({ root_event_id: thread_of, format: "events" | "transcript" })
```

Because the objective is simplification, do not keep compatibility aliases in
MCP. If old CLI commands still exist, they can either call the new REST/helpers
internally or be updated in the same pass.

## Query Events

`bridge_query_events` remains unchanged.

It should be documented as:

- debugging surface,
- SQL/forensics surface,
- not the default way to catch up or inspect a thread.

This matters because SQL is powerful but shifts schema knowledge and query
planning back onto the agent.

## Agent Flow Diagrams

These diagrams describe the flows the skill should teach. The point is to make
the objective pick the tool, not the tool name.

### Flow 1: Catch Up On A Group

```text
+------------------------------+
| Objective: catch up on group |
+---------------+--------------+
                |
                v
 +-----------------------------+
 | bridge_group_history        |
 | view: flat                  |
 | selectors: last 5 default   |
 +--------------+--------------+
                |
                v
 +-----------------------------+
 | Read top-level items only   |
 | - standalone messages       |
 | - thread roots              |
 | - reply_count metadata      |
 +--------------+--------------+
                |
                v
      +------------------+
      | Need a thread?   |
      +----+--------+----+
           |        |
          no       yes
           |        |
           v        v
 +-------------+   +-------------------------------+
 | Reply or    |   | bridge_get_thread             |
 | continue    |   | format: summary or transcript |
 +-------------+   +-------------------------------+
```

### Flow 2: Reply To A Thread

```text
+--------------------------------+
| Objective: answer thread root  |
+---------------+----------------+
                |
                v
 +-------------------------------+
 | bridge_get_thread             |
 | default: summary              |
 | selectors: last 5             |
 +---------------+---------------+
                 |
                 v
       +---------------------+
       | Enough context?     |
       +-----+----------+----+
             |          |
            yes        no
             |          |
             v          v
 +----------------+   +-------------------------------+
 | bridge_reply   |   | bridge_get_thread             |
 | in_reply_to:   |   | format: transcript/events     |
 | target event   |   | selectors: first/last/all     |
 +----------------+   +---------------+---------------+
                                      |
                                      v
                              +----------------+
                              | bridge_reply   |
                              +----------------+
```

### Flow 3: Discover Active Threads

```text
+--------------------------------+
| Objective: find active threads |
+---------------+----------------+
                |
                v
 +-------------------------------+
 | bridge_group_history          |
 | view: threads                 |
 | selectors: last 5 or last 10  |
 +---------------+---------------+
                 |
                 v
 +-------------------------------+
 | Lightweight thread rows       |
 | - root_event_id               |
 | - preview                     |
 | - reply_count                 |
 | - participant_count           |
 | - last_activity_at            |
 +---------------+---------------+
                 |
                 v
       +----------------------+
       | Need thread content? |
       +-----+-----------+----+
             |           |
            no          yes
             |           |
             v           v
 +----------------+   +-------------------------------+
 | Stop / report  |   | bridge_get_thread             |
 | candidates     |   | format: summary/transcript    |
 +----------------+   +-------------------------------+
```

### Flow 4: Re-Read Known Events

```text
+--------------------------------+
| Objective: inspect known ids   |
+----------------+---------------+
                 |
                 v
 +-------------------------------+
 | bridge_group_history          |
 | view: events                  |
 | event_ids: [...]              |
 +---------------+---------------+
                 |
                 v
       +----------------------+
       | Any id is a reply?   |
       +-----+-----------+----+
             |           |
            no          yes
             |           |
             v           v
 +----------------+   +-------------------------------+
 | Return exact   |   | Error with root_event_id      |
 | top-level rows |   | suggestion: bridge_get_thread |
 +----------------+   +-------------------------------+
```

### Flow 5: Debug Routing Or Thread Placement

```text
+--------------------------------------+
| Objective: forensic routing question |
+------------------+-------------------+
                   |
                   v
 +-------------------------------------+
 | Is this normal catch-up/reply work? |
 +----------+--------------------------+
            |
     +------+------+
     |             |
    yes            no
     |             |
     v             v
+-----------+   +--------------------------------------+
| Use       |   | bridge_query_events                  |
| normal    |   | SQL against thread_events/event_log  |
| readers   |   | reply_to_event_id/direct/thread root |
+-----------+   +--------------------------------------+
```

### Flow 6: Selector Choice

```text
+-------------------------------+
| Need bounded thread/group data |
+--------------+----------------+
               |
               v
       +------------------+
       | Which slice?     |
       +---+----------+---+
           |          |
      newest first   oldest first
           |          |
           v          v
 +----------------+  +----------------+
 | selectors:     |  | selectors:     |
 | {last, k}      |  | {first, k}     |
 +----------------+  +----------------+
           |
           v
 +------------------------------+
 | Need whole thing explicitly? |
 +------------+-----------------+
              |
              v
      +----------------+
      | selectors: all |
      | no k allowed   |
      +----------------+
```

## Before and After Examples

### Example A: "What is happening in this group?"

Before:

```text
Agent considers:
- bridge_group_history?
- bridge_list_threads?
- bridge_query_events?
```

After:

```json
{
  "tool": "bridge_group_history",
  "arguments": {
    "name": "discussion-round-table",
    "view": "flat",
    "selectors": { "strategy": "last", "k": 5 }
  }
}
```

If an item has replies:

```json
{
  "tool": "bridge_get_thread",
  "arguments": {
    "root_event_id": 196,
    "format": "summary"
  }
}
```

### Example B: "Show me active threads."

Before:

```json
{
  "tool": "bridge_list_threads",
  "arguments": {
    "group": "discussion-round-table"
  }
}
```

After:

```json
{
  "tool": "bridge_group_history",
  "arguments": {
    "name": "discussion-round-table",
    "view": "threads",
    "selectors": { "strategy": "last", "k": 10 }
  }
}
```

### Example C: "I need to reply to this thread."

Before:

```text
Agent may call:
- bridge_get_thread_status
- bridge_get_thread
- bridge_group_history(thread_of)
```

After:

```json
{
  "tool": "bridge_get_thread",
  "arguments": {
    "root_event_id": 196,
    "format": "transcript",
    "selectors": { "strategy": "last", "k": 8 }
  }
}
```

Then reply:

```json
{
  "tool": "bridge_reply",
  "arguments": {
    "in_reply_to": 323,
    "message": "..."
  }
}
```

### Example D: "Give me forensic routing data."

Before:

```text
Agent may misuse thread/history tools.
```

After:

```json
{
  "tool": "bridge_query_events",
  "arguments": {
    "sql": "select event_id, reply_to_event_id, direct_body, thread_root_event_id, thread_root_body from thread_events where event_id = ?",
    "params": [323]
  }
}
```

## Response Size Policy

| Projection | Bodies? | Typical Use | Default Selector |
| --- | --- | --- | --- |
| `get_thread(summary)` | summary only | default catch-up | last 5 |
| `get_thread(status)` | root preview only | decide what to load | n/a |
| `get_thread(events)` | selected event bodies | exact structured thread slice | last 5 |
| `get_thread(transcript)` | selected rendered bodies | answer a thread | last 5 |
| `group_history(flat)` | top-level bodies only | group catch-up | last 5 |
| `group_history(threads)` | root preview only | thread discovery | last 5 |
| `group_history(events)` | exact top-level bodies | re-read known top-level ids | id-count bounded |

No group-history projection includes thread replies inline.

## Implementation Plan

### Phase 1: Shared selector validation

Add a small validated selector parser:

- accepts omitted selectors as `{ strategy: "last", k: 5 }`,
- rejects invalid combinations with `invalid_selectors`,
- returns a normalized selector object.

### Phase 2: Thread projection helpers

Create internal helpers:

- `loadThreadStatus(rootEventId)`
- `selectThreadEvents(rootEventId, selector, peerId?)`
- `renderSelectedThreadTranscript(rootEventId, selector, peerId?)`
- `loadOrCreateThreadSummary(rootEventId, selector)`

Summary helper behavior:

- if cache exists, return it,
- if no cache exists and summarization is configured, compute using the selected
  events,
- if no cache exists and summarization is disabled, return disabled with a
  fallback suggestion.

### Phase 3: Group history projections

Update `bridge_group_history` and backing REST/client helpers to support:

- `view: "flat"` top-level items only,
- `view: "threads"` thread discovery rows,
- `view: "events"` exact top-level event lookup.

Remove thread expansion from group history. `thread_of` should go away from the
MCP schema.

### Phase 4: Remove overlapping MCP tools

Remove from MCP registration:

- `bridge_get_thread_status`
- `bridge_get_thread_summary`
- `bridge_list_threads`

Update tests that assert tool lists.

### Phase 5: Skill/reference update

Update the skill/reference docs to teach only:

```text
bridge_get_thread(format, selectors)
bridge_group_history(view, selectors)
bridge_query_events(sql)
```

### Phase 6: Tests

Add tests for:

- omitted `bridge_get_thread.format` returns summary behavior.
- `bridge_get_thread(format: "status")` returns no `events` or `transcript`.
- `bridge_get_thread(format: "events")` returns selected structured events.
- `bridge_get_thread(format: "transcript")` returns selected transcript.
- summary reads cache when present and does not regenerate by default.
- summary generates only when absent and provider is configured.
- selector defaults to last 5.
- selector validation rejects bad combinations.
- `bridge_group_history(view: "flat")` returns only top-level items.
- `bridge_group_history(view: "threads")` replaces `bridge_list_threads`.
- `bridge_group_history(view: "events")` rejects thread replies with a
  `bridge_get_thread` suggestion.
- removed MCP tools are absent from the tool list.

## Acceptance Criteria

- Agents have one canonical one-thread tool: `bridge_get_thread`.
- Agents have one canonical group reader: `bridge_group_history`.
- Default thread read is summary-oriented and low-token.
- Event/transcript reads are bounded by selectors.
- Group history never expands thread replies inline.
- `bridge_query_events` remains available and documented as expert/debug.
- Old overlapping MCP tools are removed, not kept as compatibility aliases.
- Skill docs stop presenting the old overlapping family as the primary path.

## Decisions Captured From Review

1. Compatibility is not a goal for the MCP simplification. Remove confusing MCP
   tools rather than keeping aliases.
2. `format: "events"` is clearer than legacy `json`; use `events`.
3. Default thread read should prefer summary, not status.
4. Use selectors rather than a bare limit.
5. Group history is a top-level group surface only. Thread replies require
   `bridge_get_thread`.

## Remaining Open Questions

1. Should the thread summary cache key include the selector, or should any
   existing summary for the thread satisfy `format: "summary"` regardless of
   selector?
2. Should "thread" in `group_history(view: "threads")` include roots with one
   reply, or only roots with more than one reply?
3. Should `group_history(view: "events")` reject thread replies, or return the
   root pointer plus a warning? This draft recommends rejecting, to keep group
   history from becoming a second thread reader.
