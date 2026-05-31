# Peers

High-level API map for peer discovery and rosters. Deep detail:
`reference/deep-dives/peers.md`.

## Tool

```text
bridge_list_peers(group?: "room")
```

Without `group`, returns daemon-wide peers:

```text
{ peers: [{ peer_id, session_name, tool, purpose, lease_expires_at, online }] }
```

With `group`, returns the group member roster:

```text
{
  peers: [{
    peer_id, alias, active, joined_at, left_at, session_name, tool,
    online, host_session_id, history_from_event_id
  }]
}
```

Use group-scoped peer listing to map aliases to `peer_id`, check who is online
in a room, or audit group membership.
