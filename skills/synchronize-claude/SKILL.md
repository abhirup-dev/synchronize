---
name: synchronize
description: Use when a Claude agent needs local direct messages, durable inboxes, group chat, or shared media through the synchronize MCP server and CLI.
---

# synchronize Claude Skill

Use this skill when a Claude agent needs local agent messaging through `synchronize`.

## Rules

- Register before any messaging or group action: call `bridge_register` with a non-empty `session_name`.
- Include `purpose` when it helps other agents understand your role.
- Use `bridge_dm` for direct messages.
- Use `bridge_create_group`, `bridge_join_group`, `bridge_send_group`, and `bridge_group_history` for groups.
- Use `bridge_join_group` with `fresh: true` for `/join-group-fork` behavior.
- Group aliases default to the registered session name of the peer that actually joins and must be unique within the group.
- If the default alias collides with an existing active group alias, retry `bridge_join_group` with a unique `alias`.
- Prefer MCP tools over CLI fallback. If MCP tools are unavailable or registration fails, report the MCP failure instead of continuing with shell commands.
- CLI fallback creates terminal peers only; it does not attach a Claude channel subscription and cannot produce auto-prompt notifications. If you use CLI fallback, explicitly tell the user that real-time Claude channel messages will not work and that only inbox polling/checking will work.
- Treat `bridge_inbox` as the durable fallback even if channel notifications are missed.
- Claude notifications use `notifications/claude/channel`.

## CLI Fallback

```bash
synchronize register --name NAME --purpose "what this session is doing"
synchronize peers
synchronize dm PEER_ID "message"
synchronize inbox --ack
synchronize group create GROUP --as NAME
synchronize group join GROUP --as NAME
synchronize group join GROUP --as NAME --fresh
synchronize group send GROUP --as NAME "message"
synchronize group history GROUP --as NAME
synchronize media share GROUP FILE --description "description"
synchronize media list GROUP --query TEXT
synchronize media get MEDIA_ID
```
