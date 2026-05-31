# SQL Queries Deep Dive

## Why SQL Exists

Dedicated readers cover common workflows. `bridge_query_events` exists for
forensics, custom filters, and cross-thread questions that would be too broad
for one specialized MCP tool.

SQL is guarded: `SELECT` and `WITH` only.

## Useful Reply-Target Queries

Exact direct target plus normalized thread root:

```sql
select event_id, body, reply_to_event_id, direct_sender_session_name,
       direct_body, thread_root_event_id, thread_root_sender_session_name,
       thread_root_body
from thread_events
where event_id = ?;
```

Whole thread with direct targets:

```sql
select event_id, sender_session_name, body, parent_event_id,
       reply_to_event_id, direct_body, thread_root_event_id
from thread_events
where thread_root_event_id = ?
order by event_id;
```

Recent nested/direct replies:

```sql
select event_id, group_name, sender_session_name, body,
       reply_to_event_id, direct_body, parent_event_id
from event_log
where reply_to_event_id is not null
order by event_id desc
limit 20;
```

## Common Mistakes

- Using SQL for ordinary thread catch-up when `bridge_get_thread` is enough.
- Assuming old migrated rows always have direct context.
- Forgetting parameter binding:

```text
bridge_query_events(sql: "... where event_id = ?", params: [123])
```

## Views

`event_log` includes group name, sender, recipient, and direct target context.
`thread_events` adds `thread_root_*` fields for group messages.
`discoverable_threads` lists roots that have replies.
