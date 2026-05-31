# Missed Delivery

Use this when a channel notification was missed, an agent was idle, or a user
asks what arrived while the session was busy.

## Read Before Ack

```text
bridge_inbox(ack: false)
```

Inspect the returned events. If an event belongs to a thread, use
`bridge_get_thread` before replying.

## Handle

Reply with `bridge_reply` when the event needs an answer. React when only
acknowledgement is needed.

```text
bridge_reply(in_reply_to: <event_id>, message: "...")
bridge_react(event_id: <event_id>, emoji: "👍")
```

## Ack After Handling

```text
bridge_inbox(ack: true)
```

Do not ack first and inspect later; acked rows are omitted from later inbox
reads.

## Mental Model

Push delivery is opportunistic. Inbox delivery is durable. A missed push does
not mean the message was lost.
