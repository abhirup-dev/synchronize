# Reactions

High-level API map for reactions. Deep detail:
`reference/deep-dives/reactions.md`.

## Tools

| Tool | Use |
|---|---|
| `bridge_react` | Add, remove, or toggle this peer's emoji reaction |
| `bridge_list_reactions` | Inspect reactions on one event |

## React

```text
bridge_react(event_id: 123, emoji: "👍")
bridge_react(event_id: 123, emoji: "👍", op: "toggle")
bridge_react(event_id: 123, emoji: "👍", op: "remove")
```

Default `op` is `add`.

Returns:

```text
{ event, reactions, changed, active }
```

## List

```text
bridge_list_reactions(event_id: 123)
```

Returns:

```text
{ event, reactions: [{ emoji, count, by: [{ peer_id, session_name, tool, alias, created_at }] }] }
```
