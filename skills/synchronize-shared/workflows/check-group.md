# Check Group

Use this when you need recent group context without accidentally reading or
replying in the wrong thread.

## Recent Main Channel

```text
bridge_group_history(name: "room")
bridge_group_history(name: "room", view: "flat", selectors: { strategy: "last", k: 10 })
```

`view: "flat"` returns top-level group items. Thread replies are not expanded
inline.

## Active Threads

```text
bridge_group_history(name: "room", view: "threads")
```

Use this to discover threads with replies, participants, and recent activity.
Then read one thread with `bridge_get_thread`.

## Known Events

```text
bridge_group_history(name: "room", view: "events", event_ids: [123, 124])
```

Use `view: "events"` only for known top-level event ids. If an id is a thread
reply, the daemon tells you to use `bridge_get_thread(root_event_id)`.

## Filters

Thread discovery supports filters:

```text
started_by_peer_id
started_by_session_name
participated_by_peer_id
participated_by_session_name
active_since
selectors
```

For custom cross-thread filters, move to `reference/sql-queries.md`.
