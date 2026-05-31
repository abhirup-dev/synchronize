# reply-target-forensics.md

Use this when debugging "what did this reply answer?" or "why did this message
land in that thread?"

## Mental Model

Thread replies have two levels of context:

| Field | Meaning |
|---|---|
| `reply_to_event_id` | exact direct event the sender answered |
| `parent_event_id` | normalized thread root where the reply landed |
| `direct_*` | sender/body context for `reply_to_event_id` |
| `thread_root_*` | sender/body context for the normalized root |

For a reply-to-reply, these intentionally differ:

```text
root event 10: "Plan?"
reply 12:     "Use A"
reply 15:     "Agree with 12"

event 15 reply_to_event_id = 12
event 15 parent_event_id   = 10
```

`sync-2wsz` introduced `reply_to_event_id`. `sync-tjm4` introduced post-send
destination echo with direct and thread-root context.

Older rows may have null direct context after migration.

## MCP SQL Examples

Exact message answered plus thread root:

```text
bridge_query_events({
  sql: "select event_id, body, reply_to_event_id, direct_sender_session_name, direct_body, thread_root_event_id, thread_root_sender_session_name, thread_root_body from thread_events where event_id = ?",
  params: [EVENT_ID]
})
```

Whole thread with each reply's direct target:

```text
bridge_query_events({
  sql: "select event_id, sender_session_name, body, parent_event_id, reply_to_event_id, direct_sender_session_name, direct_body, thread_root_event_id from thread_events where thread_root_event_id = ? order by event_id",
  params: [ROOT_EVENT_ID]
})
```

Recent replies where direct target matters:

```text
bridge_query_events({
  sql: "select event_id, group_name, sender_session_name, body, reply_to_event_id, direct_sender_session_name, direct_body, parent_event_id from event_log where reply_to_event_id is not null order by event_id desc limit 20"
})
```

Find replies to a specific direct event:

```text
bridge_query_events({
  sql: "select event_id, sender_session_name, body, reply_to_event_id, direct_body, thread_root_event_id, thread_root_body from thread_events where reply_to_event_id = ? order by event_id",
  params: [DIRECT_EVENT_ID]
})
```

## What To Report

For a confusing reply, report both facts:

```text
answered event <direct_event_id> from <direct_sender>: "<direct_body preview>"
landed in thread root <thread_root_event_id> from <thread_root_sender>: "<thread_root_body preview>"
```

Do not collapse this to only the root id; that hides the exact referent.
