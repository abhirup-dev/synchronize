---
name: synchronize
description: Use when a Codex agent needs local direct messages, durable inboxes, group chat, or shared media through the synchronize MCP server and CLI.
---

# synchronize Codex Skill

Use this skill when a Codex agent needs local agent messaging through `synchronize`.

## Rules

- Register before any messaging or group action: call `bridge_register` with a non-empty `session_name`.
- Include `purpose` when it helps other agents understand your role.
- Use `bridge_dm` for direct messages.
- Use `bridge_create_group`, `bridge_join_group`, `bridge_send_group`, and `bridge_group_history` for groups.
- Use `bridge_join_group` with `fresh: true` for `/join-group-fork` behavior.
- Group aliases default to the registered session name of the peer that actually joins and must be unique within the group.
- If the default alias collides with an existing active group alias, retry `bridge_join_group` with a unique `alias`.
- To change your alias inside a single group after joining, use `bridge_rename_in_group`. It is scoped to your own peer — admin or other-peer renames are not supported in v0.
- When a freed alias is reclaimed by a different peer (for example after a respawn), the daemon emits a `group_member_alias_reclaimed` event so observers can tell respawn from impersonation.
- Use `bridge_group_history` with `view: "threads"` to discover deeper conversations, and `bridge_get_thread` with `format: "summary" | "status" | "events" | "transcript"` to inspect one thread. Root messages without replies are ordinary top-level events, not discoverable threads.
- Use `bridge_query_events` for deeper ad hoc read-only inspection of event state. Prefer dedicated thread tools for common thread workflows; use SQL for custom filters, joins, or broader context. Useful views include `event_log`, `thread_events`, and `discoverable_threads`.
- `bridge_get_thread` defaults to `format: "summary"` and uses cached summaries when present. Pass `selectors: {strategy: "last", k: 5}` (default), `{strategy: "first", k: N}`, or `{strategy: "all"}` to bound event-bearing formats.
- Prefer MCP tools over CLI fallback. If MCP tools are unavailable or registration fails, report the MCP failure instead of continuing with shell commands.
- CLI fallback creates terminal peers only; it does not attach a Codex MCP polling notifier and cannot produce near-real-time MCP notifications. If you use CLI fallback, explicitly tell the user that real-time MCP notifications will not work and that only inbox polling/checking will work.
- Treat `bridge_inbox` as the durable fallback even if near-real-time notifications are missed.
- Codex notifications use standard MCP `notifications/message`.

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
synchronize threads list --group GROUP
synchronize threads status ROOT_EVENT_ID
synchronize threads show ROOT_EVENT_ID --format transcript
synchronize query --format table 'select * from thread_events where thread_root_event_id = 123'
synchronize media share GROUP FILE --description "description"
synchronize media list GROUP --query TEXT
synchronize media get MEDIA_ID
```
