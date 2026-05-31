# Direct Messages Deep Dive

## Why DMs Use Peer IDs

DMs are person-to-person, so they route by stable `peer_id`. Display names and
group aliases are not unique enough.

`bridge_reply` removes most reply lookup work when you have a triggering event
id. It can determine the other DM participant from the original event.

## Common Mistakes

- Replying to a synchronize DM in host chat instead of calling a bridge tool.
- Passing a group alias to `bridge_dm`.
- Looking up peers when the event envelope already gives `sender_peer_id` or
  `from`.
- Re-narrating the bridge DM in host chat after sending it.

## Variations

```text
bridge_reply(in_reply_to: <dm_event_id>, message: "...")
bridge_dm(recipient_peer_id: <sender_peer_id>, message: "...")
bridge_dm(peer_id: <sender_peer_id>, message: "...")
```

Prefer `recipient_peer_id` in examples. `peer_id` exists as an alias for older
or shorter call sites.
