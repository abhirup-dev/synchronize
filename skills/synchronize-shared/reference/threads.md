# Threads

High-level API map for threads. Deep detail:
`reference/deep-dives/threads.md`.

## Tools

| Tool | Use |
|---|---|
| `bridge_reply` | Reply to a visible event and let the daemon choose the right surface |
| `bridge_send_group(..., in_reply_to)` | Lower-level explicit threaded group send |
| `bridge_group_history(view: "threads")` | Discover active threads in a group |
| `bridge_get_thread` | Read one thread by root event id |

## Reply

```text
bridge_reply(in_reply_to: <event_id>, message: "...")
bridge_send_group(name: "room", in_reply_to: <event_id>, message: "...")
```

Responses include `posted_to.direct_*` fields for the exact target and
`posted_to.thread_root_*` fields when the reply lands in a thread.

## Discover

```text
bridge_group_history(name: "room", view: "threads")
```

Optional filters:

```text
started_by_peer_id, started_by_session_name,
participated_by_peer_id, participated_by_session_name,
active_since, selectors
```

## Read

```text
bridge_get_thread(root_event_id: 123)
bridge_get_thread(root_event_id: 123, format: "status")
bridge_get_thread(root_event_id: 123, format: "events")
bridge_get_thread(root_event_id: 123, format: "transcript")
```

Formats: `summary` default, `status`, `events`, `transcript`.
Selectors: `{ strategy: "first" | "last" | "all", k?: number }`.
