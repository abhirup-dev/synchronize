# Inbox

High-level API map for durable inbox. Deep detail:
`reference/deep-dives/inbox.md`.

## Tool

```text
bridge_inbox(ack?: boolean)
```

Returns:

```text
{ events: Event[] }
```

Each event includes parsed `mentions`.

## Normal Use

Read without ack:

```text
bridge_inbox(ack: false)
```

After handling returned events:

```text
bridge_inbox(ack: true)
```

`ack: true` marks returned rows acknowledged, so later reads omit them.

Default to `ack: false` while inspecting missed delivery. Use `ack: true` only
after acting on returned events; acking first can hide the recovery trail.

If an inbox event is a reply, inspect its thread context before answering so
the response lands on the intended surface.
