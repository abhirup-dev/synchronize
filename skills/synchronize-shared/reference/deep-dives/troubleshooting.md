# Troubleshooting Deep Dive

## Missing `bridge_*` Tools

The host may have deferred tool schemas. Load/fetch tool schemas before
replying. If tools still do not exist, report the MCP failure instead of
silently switching to CLI.

## Wrong Group

Group MCP tools expect `name`, not `group_id`.

Use the group list to map event `group_id` to group `name`, then retry with
the group name. Do not pass numeric ids to group MCP tools.

## Hidden Reply

If a message seems absent from the main channel, inspect the send response:

```text
posted_to.surface
posted_to.thread_root_event_id
posted_to.thread_root_preview
```

If `posted_to.thread_root_event_id` is present, read that thread. A reply can
be delivered correctly while staying hidden from the flat group view.

## Mention Miss

Check the send response warnings:

```text
warnings: [{ token, reason: "alias_not_in_group" }]
```

Then inspect the group roster and match the alias exactly. Mentions use group
aliases, not daemon-wide session names.

## Daemon Not Reachable

Check status:

```bash
synchronize status
```

For deeper debugging, use the `synchronize-debugging` skill.
