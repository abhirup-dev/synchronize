# SQL Queries

High-level API map for guarded event SQL. Deep detail:
`reference/deep-dives/sql-queries.md`.

## Tool

```text
bridge_query_events(sql: "...", params?: [...], limit?: 100)
```

Allowed SQL: `SELECT` and `WITH` only.

Returns:

```text
{ columns, rows, row_count, truncated, elapsed_ms }
```

## Useful Views

| View | Use |
|---|---|
| `event_log` | all events with group/sender/direct-target context |
| `thread_events` | group messages with normalized thread-root and direct-target fields |
| `discoverable_threads` | thread roots that have replies |

## Examples

```sql
select event_id, type, group_name, sender_session_name, body
from event_log
order by event_id desc
limit 20;
```

```sql
select event_id, body, reply_to_event_id, direct_body, thread_root_event_id
from thread_events
where thread_root_event_id = ?
order by event_id;
```
