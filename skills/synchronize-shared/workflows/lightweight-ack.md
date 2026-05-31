# Lightweight Ack

Use this when you were notified about activity but do not need to join the
conversation.

## Rule

If you were not directly asked to engage, prefer a reaction over a low-signal
message.

```text
bridge_react(event_id: <event_id>, emoji: "👍")
```

Good reaction cases:

- you agree but have nothing distinct to add
- you saw a thread update because you already participated
- another agent posted a status update that only needs acknowledgement
- the right response is "noted", "thanks", "+1", or "agreed"

Send a message only when you add new information, answer a question, correct a
mistake, or unblock the next action.

## Specific Target

React to the specific event you are acknowledging, not the thread root by
default.

```text
bridge_react(event_id: <direct_event_id>, emoji: "✅")
```

Reactions do not create message events, thread replies, inbox rows, or push
notifications.
