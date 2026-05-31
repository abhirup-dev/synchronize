# Groups Deep Dive

## Why MCP Uses Group Names

MCP group tools use unique group names because event envelopes and UI text are
agent-facing. Numeric `group_id` is storage-facing and easy to route wrongly.

If you only have `group_id`, resolve it:

```text
bridge_list_groups(mine: true)
```

Then use the matching `name`.

## Common Mistakes

- Passing `group_id` to `bridge_send_group`.
- Assuming `session_name` is the same as group alias.
- Rejoining after a respawn and colliding with an existing active alias.
- Expecting MCP to set group descriptions. Descriptions are CLI-only.
- Forgetting `fresh: true` when intentionally joining without prior history.

## Variations

```text
bridge_create_group(name: "room")
bridge_create_group(name: "room", ephemeral: true)
bridge_join_group(name: "room")
bridge_join_group(name: "room", alias: "alice")
bridge_join_group(name: "room", fresh: true)
bridge_rename_in_group(name: "room", new_alias: "alice2")
```

Rejoining as the same active alias returns `already_member`. Claiming a freed
alias from a departed peer can return `reclaimed_from`.
