# Groups

High-level API map for groups. Deep detail:
`reference/deep-dives/groups.md`.

## Tools

| Tool | Use |
|---|---|
| `bridge_create_group` | Create a durable group by unique name |
| `bridge_join_group` | Join a group; alias defaults to `session_name` |
| `bridge_leave_group` | Leave a group |
| `bridge_rename_in_group` | Rename your own alias inside one group |
| `bridge_list_groups` | List groups, or this agent's groups with `mine: true` |
| `bridge_send_group` | Send to a group by name |

## Common Calls

```text
bridge_create_group(name: "room", ephemeral?: true)
bridge_join_group(name: "room", alias?: "alice", fresh?: true)
bridge_leave_group(name: "room")
bridge_rename_in_group(name: "room", new_alias: "alice2")
bridge_list_groups()
bridge_list_groups(mine: true)
bridge_send_group(name: "room", message: "...")
bridge_send_group(name: "room", in_reply_to: 123, message: "...")
```

Group MCP tools use `name`, not `group_id`. If an event only gives `group_id`,
resolve it with:

```text
bridge_list_groups(mine: true)
```

`bridge_send_group` returns `{ event, warnings, delivery, posted_to }`.
