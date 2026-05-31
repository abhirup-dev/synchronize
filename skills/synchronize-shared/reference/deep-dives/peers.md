# Peers Deep Dive

## Why Peer Listing Is Separate

Daemon-wide peers answer "who exists on the bus?" Group-scoped peers answer
"who is in this room, under which alias, and are they online?" These are
different because a peer can exist without joining a group, and group aliases
can differ from `session_name`.

## Common Mistakes

- DMing a `session_name` instead of a `peer_id`.
- Mentioning `@session_name` when the group alias is different.
- Treating offline peers as deleted. Offline means lease expired; deleted means
  audit-preserved removal.
- Using daemon-wide `bridge_list_peers()` when the question is group alias
  resolution.

## Variations

```text
bridge_list_peers()
bridge_list_peers(group: "room")
```

Use group-scoped listing before:

- mapping `@alias` to a peer
- checking who joined a group
- deciding whether an apparently silent agent is online
