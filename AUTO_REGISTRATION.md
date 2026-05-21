# Auto Registration

`synchronize` can automatically connect a native agent session to a durable synchronize peer.

The durable identities are:

- `peer_id`: synchronize's primary identity for messaging, inboxes, groups, and events.
- `host_session_id`: the native Claude or Pi session id used for resume/correlation.
- `session_name`: a human alias only. It is allowed to collide across sessions.

## Claude

Claude auto-registration is opt-in through `synchronize launch claude`.

```bash
synchronize launch claude --name claude-review
```

The launcher sets:

- `SYNCHRONIZE_HOOK_ENABLE=1`
- `SYNCHRONIZE_SESSION_NAME=<name>`
- `SYNCHRONIZE_LAUNCH_ID=<temporary uuid>`

Claude's `SessionStart` hook runs `synchronize hook claude-session`. The hook reads Claude's JSON hook payload, captures `session_id`, `transcript_path`, `cwd`, `model`, and startup source, then registers a daemon `agent_sessions` binding.

`SYNCHRONIZE_LAUNCH_ID` is only temporary process-correlation plumbing. It lets the launcher, hook process, and MCP process find the same proactively registered peer before `bridge_register` has run. It is not a durable identity and should not be used as a session-store key.

When the agent calls `bridge_whoami`, the MCP adapter uses `SYNCHRONIZE_LAUNCH_ID` to discover the daemon binding, attaches to the existing `peer_id`, and starts the notification path.

Plain `claude` launches do not auto-register unless the env gate is explicitly enabled.

## Pi

Pi auto-registration happens through `extensions/pi-synchronize`.

On `session_start`, the extension reads Pi's native session id from `ctx.sessionManager.getSessionId()`, registers a synchronize peer with `tool=pi`, and writes an `agent_sessions` binding with `host_tool=pi`.

The extension also sets `SYNCHRONIZE_PEER_ID` so the Pi MCP adapter reuses the same peer instead of creating a second identity.

## Rename And Duplicate Names

Use `bridge_rename_session` to change the visible alias while preserving `peer_id`.

Duplicate `session_name` values are safe because routing and correlation use `peer_id` and `host_session_id`. Claude and Pi do not reuse peers by `session_name` alone.

## Verification

Check runtime state with:

```bash
BASE_URL=$(jq -r .baseUrl "$SYNCHRONIZE_HOME/daemon.json")
curl -s "$BASE_URL/peers" | jq
curl -s "$BASE_URL/agent-sessions" | jq
```

Expected invariants:

- each binding's `peer_id` exists in `peers`
- `peer.tool` matches `host_tool`
- Claude bindings have `host_session_file`
- Pi bindings have `host_session_id`
- `session_name` is treated as display text, not identity
