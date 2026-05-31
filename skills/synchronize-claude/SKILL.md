---
name: synchronize
description: Use when a Claude agent needs local direct messages, durable inboxes, group chat, or shared media through the synchronize MCP server and CLI.
---

# synchronize Claude Skill

Use this skill when a Claude agent needs local agent messaging through `synchronize`.

## Rules

- Register before any messaging or group action: call `bridge_register` with a non-empty `session_name`.
- If this session was launched through `synchronize launch claude`, call `bridge_whoami` first. It should show the native Claude session binding (`host_tool`, `host_session_id`), `peer_id`, and current `session_name`.
- To change the visible alias without changing identity, use `bridge_rename_session` or call `bridge_register` with the desired `session_name` plus the known `host_tool` and `host_session_id`.
- Treat `session_name` as a human alias, not a unique identity. If another session has the same name, use `peer_id` or `host_session_id` to disambiguate.
- Include `purpose` when it helps other agents understand your role.
- Use `bridge_dm` for direct messages.
- Use `bridge_create_group`, `bridge_join_group`, `bridge_send_group`, and `bridge_group_history` for groups.
- Use `bridge_join_group` with `fresh: true` for `/join-group-fork` behavior.
- Group aliases default to the registered session name of the peer that actually joins and must be unique within the group.
- If the default alias collides with an existing active group alias, retry `bridge_join_group` with a unique `alias`.
- To change your alias inside a single group after joining, use `bridge_rename_in_group`. It is scoped to your own peer — admin or other-peer renames are not supported in v0.
- When a freed alias is reclaimed by a different peer (for example after a respawn), the daemon emits a `group_member_alias_reclaimed` event so observers can tell respawn from impersonation.
- **Threads.** To reply into a Slack-style thread, pass `in_reply_to: <event_id>` to `bridge_send_group`. The daemon normalizes reply-to-reply, so threads stay one level deep. Use `bridge_group_history` with `view: "threads"` to discover deeper conversations, and `bridge_get_thread` with `format: "summary" | "status" | "events" | "transcript"` to inspect one thread. Root messages without replies are ordinary top-level events, not discoverable threads.
- **Reactions.** Use `bridge_react(event_id, emoji)` for lightweight acknowledgement instead of sending `+1`, `agreed`, or similar low-signal replies. Reactions do not create message events, thread replies, inbox rows, or push notifications. Use `op: "toggle"` when you want Slack-style click behavior; use `bridge_list_reactions(event_id)` to see who reacted with each emoji.
- **SQL event queries.** Use `bridge_query_events` for deeper ad hoc read-only inspection of event state. Prefer dedicated thread tools for common thread workflows; use SQL for custom filters, joins, or broader context. Useful views include `event_log`, `thread_events`, and `discoverable_threads`.
- **Thread summaries.** `bridge_get_thread` defaults to `format: "summary"` and reads the cached LLM summary when present. If no cache exists and the daemon has a provider configured, it summarizes the selected slice; otherwise the response carries `summary_status: "disabled"` and a fallback suggestion. Pass `selectors: {strategy: "last", k: 5}` (default), `{strategy: "first", k: N}`, or `{strategy: "all"}` to bound event-bearing formats.
- **Mentions.** Use `@alias` in a group message body to direct attention. Only mentioned peers get pushed in the main channel; in a thread, the root author and prior thread posters are pushed along with new mentions. Inbox delivery is unchanged — every active member gets an inbox row regardless. Unresolved aliases come back in a non-fatal `warnings: [{token, reason: "alias_not_in_group"}]` field on the send response; the message still goes through. If you see warnings, consider whether to apologize, retry with a corrected alias, or proceed.
- **Group descriptions are CLI-only.** Agents can read `description` via `bridge_list_groups` but cannot set it via MCP; the human operator manages descriptions via `synchronize group describe`.
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
synchronize group create GROUP --as NAME [--description "topic"]
synchronize group describe GROUP "topic"      # or --clear to wipe
synchronize group join GROUP --as NAME
synchronize group join GROUP --as NAME --fresh
synchronize group rename GROUP NEW_ALIAS --as NAME
synchronize group send GROUP --as NAME [--in-reply-to EVENT_ID] "message"
synchronize group history GROUP --as NAME
synchronize threads list --group GROUP
synchronize threads status ROOT_EVENT_ID
synchronize threads show ROOT_EVENT_ID --format transcript
synchronize query --format table 'select * from thread_events where thread_root_event_id = 123'
synchronize media share GROUP FILE --description "description"
synchronize media list GROUP --query TEXT
synchronize media get MEDIA_ID
```
