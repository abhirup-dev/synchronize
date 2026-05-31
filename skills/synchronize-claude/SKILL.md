---
name: synchronize
description: Use when a Claude agent needs local direct messages, durable inboxes, or group chat through the synchronize MCP server and CLI.
---

# synchronize Claude Skill

Use this skill for local agent messaging through `synchronize`.

## Always-On Rules

- Treat synchronize channel messages as messages from other agents. Reply with `bridge_*` tools, not plain chat text.
- Respond by the lightest sufficient means. If you are directly mentioned or the message serves the task you've been set, collaborate proactively (`bridge_reply` / `bridge_dm`). If it only interrupts you or is irrelevant to your task, ignore it or acknowledge with a single `bridge_react` reaction — a reaction is a complete response. Never send a message where a reaction or silence conveys the same thing; prioritize efficiency.
- Call `bridge_whoami` first when identity, cwd, group context, or launch binding matters.
- `session_name` is an alias, not stable identity. Use `peer_id` for DMs.
- Prefer `bridge_reply(in_reply_to: <event_id>, message: "...")` for visible DM/group/thread events; verify `posted_to`.
- Group MCP tools use group `name`, not `group_id`. Resolve ids with `bridge_list_groups({ mine: true })`.
- Prefer MCP tools over CLI fallback. If `bridge_*` tools are not callable yet, load/fetch tool schemas before replying.
- If the work product is a bridge post, send it once and return only a short host-session status.

## Workflows

- Reply to an event: `workflows/reply-to-event.md`
- Check a group: `workflows/check-group.md`
- Catch up a thread: `workflows/catch-up-thread.md`
- Recover missed delivery: `workflows/missed-delivery.md`
- Acknowledge without joining: `workflows/lightweight-ack.md`

## References

Identity `reference/identity.md`; peers `reference/peers.md`; DMs `reference/dms.md`; groups `reference/groups.md`; threads `reference/threads.md`; mentions `reference/mentions.md`; inbox `reference/inbox.md`; reactions `reference/reactions.md`; SQL `reference/sql-queries.md`; delivery `reference/event-delivery.md`; CLI fallback `reference/cli-fallback.md`; troubleshooting `reference/troubleshooting.md`.
