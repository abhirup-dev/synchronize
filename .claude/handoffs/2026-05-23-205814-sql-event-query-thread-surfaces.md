# Handoff: SQL Event Query Surface and Thread Discovery

## Current State Summary

The SQL event query and first-class thread discovery/status implementation has
been completed in the dedicated worktree:

```text
/Users/abhirupdas/Codes/Personal/synchronize-worktrees/feature-sql-event-query-surfaces
branch: feature/sql-event-query-surfaces
commit: 8bf1054 Add SQL event query and thread surfaces
remote: origin/feature/sql-event-query-surfaces
```

The feature branch has been pushed. The working tree was clean before this
handoff file was created.

The original implementation plan is saved at:

```text
docs/plan-sql-surface.md
```

The distilled domain vocabulary and decisions are saved at:

```text
CONTEXT.md
```

## What Was Requested

The user wanted Synchronize's durable events to be queryable through SQL, with
better performance and serviceability through MCP and CLI surfaces.

During planning, the user added that thread support must be first-class:

- agents should quickly query all events inside a thread, sorted by timestamp;
- agents should discover deeper conversations/threads easily;
- agents should get compact thread status/statistics by root event id;
- MCP and CLI should expose serviceable workflows, not only raw SQL.

The user then asked to use the `grill-with-docs` skill to iterate on
requirements and capture decisions in docs. Later they asked for the work to be
done in a separate worktree and for the implementation plan to be saved under
`docs/plan-sql-surface.md`.

## Grilling and Decision Process

The plan was iterated through a question-by-question grilling pass. The key
decisions were:

1. **Thread discovery should be first-class.**
   It should not be SQL-only. Agents should have a dedicated way to ask "what
   deeper conversations exist?" without writing SQL.

2. **Thread status is derived activity/statistics only.**
   It is not a workflow state. Fields like `open`, `resolved`, `blocked`, or
   `needs_response` were explicitly deferred because they imply manual or
   inferred workflow state.

3. **V0 thread discovery/status is global daemon state.**
   Peer-scoped visibility is a future tightening pass. This keeps v0 simpler and
   matches the local-first trust model.

4. **A discoverable thread is a root group message with at least one reply.**
   Root messages without replies are ordinary group messages and should be
   inspected through the general event query surface.

5. **Thread retrieval should return both structured data and transcript output.**
   Structured JSON is for programmatic use. Transcript mode is for agents to
   quickly understand a conversation.

6. **Thread status should not be the primary SQL abstraction.**
   Status is a bounded domain/tool response. SQL is for flexible event/context
   inspection, including querying all events inside a thread.

7. **Thread discovery should have dedicated API/MCP support and SQL support.**
   Dedicated tools cover common agent workflows; SQL covers deeper ad hoc
   inspection.

8. **V0 dedicated discovery filters are deliberately small.**
   Supported filters: group, started-by peer/session, participated-by
   peer/session, active-since, limit. Results order by latest activity first.

9. **V0 SQL is raw read-only SQL with guardrails.**
   No query-builder DSL. Allow `SELECT` and `WITH`; reject mutation/control
   statements and multiple statements.

10. **Expose raw tables plus friendly views.**
    Raw daemon tables remain available for power users, while views help agents
    avoid remembering joins and thread rules.

11. **Skill-track updates are part of the plan.**
    Agents need to learn the new capabilities at a high level. Two Beads issues
    were created for skill updates and made dependent on existing skill
    refactor issue `sync-b8p`.

These decisions were captured in `CONTEXT.md` and expanded into
`docs/plan-sql-surface.md`.

## Beads State

Epic:

```text
sync-s7r - SQL event query surface and thread discovery
```

Completed children:

```text
sync-s7r.1 - Add guarded read-only SQL query endpoint
sync-s7r.2 - Add event-log thread query views
sync-s7r.3 - Expose dedicated thread APIs and typed facade
sync-s7r.4 - Add MCP tools for SQL queries and threads
sync-s7r.5 - Add CLI query and threads commands
sync-s7r.6 - Test SQL query and thread surfaces
```

Still open:

```text
sync-s7r.7 - Add SQL and thread workflow guidance to progressive skill references
sync-s7r.8 - Update installed-skill examples and agent-facing docs for SQL/thread tools
```

Both open skill issues depend on:

```text
sync-b8p - Refactor synchronize SKILL.md files to progressive-discovery format
```

Important nuance: the implementation added stopgap high-level guidance to the
current monolithic skill files, but the planned progressive-reference skill
updates remain correctly blocked on `sync-b8p`.

## Implementation Completed

### SQL Query Surface

Added:

```text
src/query/events.ts
src/api/query.ts
POST /query/events
```

The endpoint accepts:

```ts
{
  sql: string;
  params?: Array<string | number | boolean | null>;
  limit?: number;
}
```

It returns:

```ts
{
  columns: string[];
  rows: Record<string, unknown>[];
  row_count: number;
  truncated: boolean;
  elapsed_ms: number;
}
```

Guardrails implemented:

- allows `SELECT` and `WITH`;
- rejects non-read-only statement starts;
- rejects mutation/control tokens including `INSERT`, `UPDATE`, `DELETE`,
  `DROP`, `ALTER`, `CREATE`, `PRAGMA`, `ATTACH`, `DETACH`, `VACUUM`;
- rejects multiple statements;
- accepts only bound scalar params;
- enforces default/max limits through existing page-limit constants.

### Friendly Views and Indexes

Added indexes in `src/db.ts`:

```text
idx_events_type_event
idx_events_sender_event
idx_events_created_at
idx_events_parent_event
```

Added views:

```text
event_log
thread_events
discoverable_threads
```

View intent:

- `event_log`: events joined with group, sender, and recipient context.
- `thread_events`: root and reply events with `thread_root_event_id`.
- `discoverable_threads`: root group messages that have at least one reply.

### Thread API Surface

Added:

```text
src/api/threads.ts
GET /threads
GET /threads/:root_event_id
GET /threads/:root_event_id/status
```

`GET /threads` supports filters:

```text
group
started_by_peer_id
started_by_session_name
participated_by_peer_id
participated_by_session_name
active_since
limit
```

`GET /threads/:root_event_id/status` returns derived stats:

- root event id;
- group id/name;
- root sender peer/session/alias;
- created time;
- last event id;
- last activity time;
- reply count;
- total event count;
- participant count;
- per-participant activity facts.

`GET /threads/:root_event_id` returns status and events. It accepts:

```text
format=json|transcript
```

The route remains backward-compatible for callers passing `peer_id`: if
`peer_id` is present, the old membership/history-boundary visibility checks are
still enforced. Without `peer_id`, it behaves as the agreed global v0 API.

### CLI Surface

Added:

```text
src/cli/commands/query.ts
src/cli/commands/threads.ts
```

New commands:

```bash
synchronize query --format json|table|csv [--params JSON] [--limit N] SQL
synchronize threads list [--group NAME] [--limit N]
synchronize threads status ROOT_EVENT_ID
synchronize threads show ROOT_EVENT_ID --format json|transcript
```

Updated:

```text
src/cli/index.ts
src/cli/help.ts
README.md
```

### MCP Surface

Added:

```text
src/mcp/tools/query.ts
src/mcp/tools/threads.ts
```

New tools:

```text
bridge_query_events
bridge_list_threads
bridge_get_thread_status
bridge_get_thread
```

`bridge_get_thread` accepts:

```ts
{
  root_event_id: number;
  format?: "json" | "transcript";
}
```

Tool descriptions explicitly tell agents to prefer dedicated thread tools for
common workflows and use SQL for deeper ad hoc inspection.

### Agent-Facing Skill Updates

Stopgap updates were made to:

```text
skills/synchronize-claude/SKILL.md
skills/synchronize-codex/SKILL.md
skills/synchronize-pi/SKILL.md
```

They now mention:

- `bridge_list_threads`;
- `bridge_get_thread_status`;
- `bridge_get_thread`;
- `bridge_query_events`;
- transcript mode;
- useful views: `event_log`, `thread_events`, `discoverable_threads`;
- root messages without replies are not discoverable threads.

The full progressive skill rewrite remains tracked under `sync-s7r.7` and
`sync-s7r.8`, both blocked on `sync-b8p`.

## Tests and Validation

Passed:

```bash
bun run typecheck
bun test tests/api.test.ts
bun test tests/mcp-e2e.test.ts
SYNCHRONIZE_PORT=0 bun test
```

Full-suite result with random daemon ports:

```text
48 pass
0 fail
299 expect() calls
```

Important gotcha: plain `bun test` failed in this environment because another
local daemon was already listening on `127.0.0.1:58405`. This is the existing
default-port collision class tracked by:

```text
sync-anr - [bug] Parallel test runs collide on DEFAULT_PORT=58405
```

Rerunning with:

```bash
SYNCHRONIZE_PORT=0 bun test
```

passed completely.

## Files Changed in the Implementation Commit

Committed in `8bf1054`:

```text
CONTEXT.md
README.md
docs/plan-sql-surface.md
skills/synchronize-claude/SKILL.md
skills/synchronize-codex/SKILL.md
skills/synchronize-pi/SKILL.md
src/api/index.ts
src/api/query.ts
src/api/threads.ts
src/api/types.ts
src/cli/commands/query.ts
src/cli/commands/threads.ts
src/cli/help.ts
src/cli/index.ts
src/daemon.ts
src/db.ts
src/mcp/server.ts
src/mcp/tools/query.ts
src/mcp/tools/threads.ts
src/query/events.ts
tests/api.test.ts
tests/mcp-e2e.test.ts
```

This handoff file is new after that commit.

## Important Design Notes for Next Agent

- Do not close `sync-s7r` yet unless the two skill-track children are completed
  or intentionally split/superseded.
- Do not close `sync-s7r.7` or `sync-s7r.8` until `sync-b8p` is resolved and the
  progressive skill references receive the SQL/thread guidance.
- The SQL guard is intentionally simple string validation plus SQLite wrapping:
  `SELECT * FROM (<caller SQL>) AS synchronize_query LIMIT ?`. If improving it,
  preserve raw read-only SQL ergonomics unless the user changes direction.
- `discoverable_threads` is intentionally defined as roots with replies only.
  Do not broaden it to all root messages without revisiting the domain decision.
- Thread status is intentionally derived stats, not workflow state.
- V0 discovery/status is intentionally global. Peer-scoped query visibility was
  discussed and deferred.
- Existing `GET /threads/:root_event_id?peer_id=...` behavior was preserved for
  old tests/callers. New global callers can omit `peer_id`.

## Immediate Next Steps

1. Commit this handoff file if preserving it in git is desired:

   ```bash
   git add .claude/handoffs/2026-05-23-205814-sql-event-query-thread-surfaces.md
   git commit -m "Add SQL event query handoff"
   git push
   ```

2. If continuing implementation work, start with the open skill issues only
   after checking `sync-b8p`:

   ```bash
   bd show sync-b8p
   bd show sync-s7r.7
   bd show sync-s7r.8
   ```

3. If preparing a PR, use branch:

   ```text
   feature/sql-event-query-surfaces
   ```

   GitHub suggested URL after push:

   ```text
   https://github.com/abhirup-dev/synchronize/pull/new/feature/sql-event-query-surfaces
   ```

## Resume Checklist

Before taking more action:

1. `cd /Users/abhirupdas/Codes/Personal/synchronize-worktrees/feature-sql-event-query-surfaces`
2. `git status --short --branch`
3. `bd show sync-s7r`
4. `bd show sync-b8p`
5. If touching tests, use `SYNCHRONIZE_PORT=0 bun test` unless the default-port
   collision has been fixed.
