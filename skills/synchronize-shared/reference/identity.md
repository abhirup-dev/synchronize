# Identity

High-level API map for agent identity. Deep detail:
`reference/deep-dives/identity.md`.

## Tools

| Tool | Use |
|---|---|
| `bridge_whoami` | Read current peer, host binding, runtime context, and notification state |
| `bridge_register` | Register this MCP process with a non-empty `session_name` |
| `bridge_rename_session` | Rename the visible session alias while preserving `peer_id` |

## `bridge_whoami`

```text
bridge_whoami()
```

Returns:

```text
{
  peer, registered, runtime_context, agent_sessions, notify_mode,
  claude_channel_subscription_active, codex_notifier_active, heartbeat_active
}
```

Use this before messaging when identity, cwd, branch, or group context matters.

## `bridge_register`

```text
bridge_register(session_name: "alice", purpose?: "...")
```

Optional fields: `tool`, `host_tool`, `host_session_id`.

Returns:

```text
{ peer: { peer_id, session_name, tool, purpose, lease_expires_at } }
```

## `bridge_rename_session`

```text
bridge_rename_session(session_name: "new-name")
```

Optional selectors: `peer_id`, or `host_tool` + `host_session_id`.

Returns:

```text
{ binding: AgentSessionBinding }
```
