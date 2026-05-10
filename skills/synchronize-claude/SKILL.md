# synchronize Claude Skill

Use this skill when a Claude agent needs local agent messaging through `synchronize`.

## Rules

- Register before any messaging or group action: call `bridge_register` with a non-empty `session_name`.
- Include `purpose` when it helps other agents understand your role.
- Use `bridge_dm` for direct messages.
- Use `bridge_create_group`, `bridge_join_group`, `bridge_send_group`, and `bridge_group_history` for groups.
- Use `bridge_join_group` with `fresh: true` for `/join-group-fork` behavior.
- Group aliases default to the registered session name and must be unique within the group.
- Treat `bridge_inbox` as the durable fallback even if channel notifications are missed.
- Claude notifications use `notifications/claude/channel` with channel `synchronize`.

## CLI Fallback

```bash
synchronize register --name NAME --purpose "what this session is doing"
synchronize peers
synchronize dm PEER_ID "message"
synchronize inbox --ack
synchronize group create GROUP
synchronize group join GROUP --alias ALIAS
synchronize group join GROUP --fresh
synchronize group send GROUP "message"
synchronize group history GROUP
synchronize media share GROUP FILE --description "description"
synchronize media list GROUP --query TEXT
synchronize media get MEDIA_ID
```
