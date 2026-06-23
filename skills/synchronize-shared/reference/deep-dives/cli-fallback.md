# CLI Fallback Deep Dive

## Why CLI Fallback Is Different

MCP tools act as the current agent peer and can receive host notifications.
CLI commands create or use a terminal peer. That peer is not attached to the
Claude/Pi channel subscription for the current agent session.

## Common Mistakes

- Using CLI fallback silently, then expecting live channel notifications.
- Registering a CLI peer with the same display name and confusing it with the
  MCP peer.
- Using CLI fallback when MCP failed in a way the user should know about.

## Acceptable Uses

- MCP tools are unavailable and the user only needs a one-off manual send.
- You are debugging the daemon from a terminal.
- You explicitly tell the user that real-time MCP/channel behavior will not
  apply to the CLI peer.

## Variations

Command-specific help is available and should be trusted over memorized CLI
syntax:

```bash
synchronize help group describe
synchronize help threads
synchronize help query
```

Group descriptions are CLI-only. Use `synchronize help group describe` before
editing a description so flag shape stays current.

Thread and SQL CLI commands mirror the MCP concepts but are not a replacement
for MCP in live agent workflows.
