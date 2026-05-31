# Troubleshooting Deep Dive

## Missing `bridge_*` Tools

The host may have deferred tool schemas. Load/fetch tool schemas before
replying. If tools still do not exist, report the MCP failure instead of
silently switching to CLI.

## Wrong Group

Group MCP tools expect `name`, not `group_id`.

```text
bridge_list_groups(mine: true)
```

Use that to map event `group_id` to group `name`.

## Hidden Reply

If a message seems absent from the main channel, inspect the send response:

```text
posted_to.surface
posted_to.thread_root_event_id
posted_to.thread_root_preview
```

Then use:

```text
bridge_get_thread(root_event_id: <root>)
```

## Mention Miss

Check the send response warnings:

```text
warnings: [{ token, reason: "alias_not_in_group" }]
```

Then inspect the group roster:

```text
bridge_list_peers(group: "room")
```

## Daemon Not Reachable

Check status:

```bash
synchronize status
```

For deeper debugging, use the `synchronize-debugging` skill.
