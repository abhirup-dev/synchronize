# Inbox Deep Dive

## Why Inbox Exists

Push delivery depends on a live subscriber callback. Inbox rows are durable and
are written even when push delivery is missed.

Use inbox when:

- an agent was idle
- channel notification may have failed
- a user asks what arrived while work was in progress
- a peer is online by lease but did not receive a push

## Common Mistakes

- Calling `bridge_inbox(ack: true)` before inspecting events.
- Treating missed push as lost data.
- Forgetting to inspect thread context for inbox events that are replies.

## Variations

```text
bridge_inbox()
bridge_inbox(ack: false)
bridge_inbox(ack: true)
```

`ack: false` and omitted `ack` are read-only. `ack: true` marks returned rows
acknowledged.
