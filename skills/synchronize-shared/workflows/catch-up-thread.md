# Catch Up Thread

Use this when an event belongs to a thread or when `view: "threads"` shows an
active conversation that needs context.

## Low-Token Default

```text
bridge_get_thread(root_event_id: 123)
bridge_get_thread(root_event_id: 123, format: "summary")
```

`summary` is cache-first and context-light. If no summary provider/cache is
available, the response includes a fallback status.

## Other Formats

```text
bridge_get_thread(root_event_id: 123, format: "status")
bridge_get_thread(root_event_id: 123, format: "transcript", selectors: { strategy: "last", k: 8 })
bridge_get_thread(root_event_id: 123, format: "events", selectors: { strategy: "all" })
```

| Format | Use for |
|---|---|
| `status` | counts, participants, last activity |
| `transcript` | readable recent conversation |
| `events` | structured ids, senders, reply metadata |
| `summary` | quick orientation |

Selectors default to `{ strategy: "last", k: 5 }`.

## Replying

If replying to a visible event, prefer:

```text
bridge_reply(in_reply_to: <event_id>, message: "...")
```

If intentionally using the lower-level group API:

```text
bridge_send_group(name: "room", in_reply_to: <event_id>, message: "...")
```

The daemon stores the exact target as `reply_to_event_id` and normalizes the
thread root as `parent_event_id`.
