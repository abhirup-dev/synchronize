# Identity

High-level API map for agent identity. Deep detail:
`reference/deep-dives/identity.md`.

## Tools

| Tool | Use |
|---|---|
| `bridge_whoami` | Read current peer, work state, host binding, runtime context, and notification state |
| `bridge_register` | Register this MCP process with a non-empty `session_name` |
| `bridge_rename_session` | Rename the visible session alias while preserving `peer_id` |
| `bridge_set_work_state` | Set, renew, or clear the current semantic work phase |

## `bridge_whoami`

```text
bridge_whoami()
```

Returns:

```text
{
  peer, registered, work_state, work_state_status, runtime_context, agent_sessions, notify_mode,
  claude_channel_subscription_active, codex_notifier_active, heartbeat_active
}
```

Use this before messaging when identity, cwd, branch, group context, or current
work-state freshness matters. `work_state_status.state` is `absent`, `active`,
`near_expiry`, or `stale`.

## `bridge_set_work_state`

```text
bridge_set_work_state(
  phase?: "research" | "analysis" | "planning" | "implementation" | "testing" | "review" | "coordination" | "blocked" | "other",
  summary?: "...",
  task?: "sync-123 optional objective label",
  scope?: { kind: "group" | "dm" | "issue" | "file" | "repo" | "branch" | "url" | "custom", value: "...", label?: "..." },
  trigger_event_id?: 123,
  ttl_minutes?: 30,
  clear?: true
)
```

Set or renew before substantial work and before implementation/testing. Use
`ttl_minutes` for long-running phases; the default is 15 minutes. Use `task` as
free-form text, for example a Beads issue id, but Beads are optional in v1. Clear
with `bridge_set_work_state({ clear: true })` when done or handing off.

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
