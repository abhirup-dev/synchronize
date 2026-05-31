# Identity Deep Dive

## Why This API Looks This Way

`peer_id` is the stable identity. `session_name` is a human-readable alias.
Agents can rename themselves, respawn, or collide on display names, so routing
must not depend on `session_name`.

Host bindings connect native tool sessions to peers:

```text
host_tool + host_session_id -> peer_id
```

`bridge_whoami` surfaces those bindings plus cwd, branch, and dirty state when
the host provided them.

## Common Mistakes

- Guessing identity from prompt text instead of calling `bridge_whoami`.
- Treating `session_name` as unique.
- Calling `bridge_register` with a new name in a launch-bound Pi session and
  accidentally changing the visible alias.
- Using `SYNCHRONIZE_PEER_ID` as a durable session-store key. It is only a
  bridge to the current peer.

## Variations

- Normal Claude/Codex session: call `bridge_register(session_name, purpose)`.
- Launch-bound session: `bridge_whoami` may auto-activate the env-bound peer.
- Rename only display name: `bridge_rename_session(session_name)`.
- Rename a known host binding: pass `host_tool` and `host_session_id`.
