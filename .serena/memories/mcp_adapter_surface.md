# MCP Adapter Surface Series

Covers MCP tool/API changes after the older `mcp_notification_modes` memory. Search terms: MCP, bridge, tools, event formatting, structured errors, groups, media, peers.

## Architecture reminder

`src/mcp/server.ts` builds the MCP server. It threads `{ mcp, state, emit, lifecycle }` as `ToolContext` into tool registrars under `src/mcp/tools/`.

`src/mcp/state.ts` owns adapter-local state and client discovery. `src/mcp/lifecycle.ts` owns registration lifecycle and sticky peer id handling.

The MCP adapter remains thin: durable truth stays in the daemon, and MCP tools call the typed `src/api/` facade.

## Recent tool-surface changes

Group tools in `src/mcp/tools/groups.ts` now expose:

- `bridge_create_group` with description metadata.
- `bridge_rename_in_group` for alias changes.
- `bridge_send_group` with `in_reply_to` and mention delivery semantics in the tool description.
- `bridge_group_history` with three modes:
  - default main-channel history, hiding thread replies.
  - `thread_of=<root_event_id>` for one thread.
  - `event_ids=[...]` for exact event fetches regardless of main/thread placement.

`thread_of` and `event_ids` are mutually exclusive. Passing both returns an MCP structured error.

## Structured errors

MCP tools now use structured error envelopes for expected user/input failures:

```json
{ "error": { "code": "...", "message": "...", "status": 400 } }
```

The MCP response is marked `isError` where appropriate. See `src/mcp/util.ts` for the helper behavior and `tests/mcp-e2e.test.ts` for expected shape.

## Event formatting

`src/mcp/tools/event-format.ts` converts daemon `Event` objects for MCP responses:

- parse `mentions_json` into `mentions: string[]`.
- drop the raw `mentions_json` field.
- tolerate malformed JSON by returning an empty mentions array and logging.

Every MCP response carrying event(s) should pass through this formatting. This was added because some inline event responses previously leaked `mentions_json`.

## Agent registration and peer identity

`src/mcp/lifecycle.ts::resolveMcpRegisterPeerId` honors `SYNCHRONIZE_PEER_ID`. Recent hook/session work also interacts with `SYNCHRONIZE_SESSION_NAME` via daemon agent-session APIs, though MCP peer id still flows through lifecycle/registration.

## Useful tests

- `tests/mcp.test.ts` — unit-ish MCP adapter coverage.
- `tests/mcp-e2e.test.ts` — full stdio MCP behavior, structured errors, mentions formatting, `event_ids`/`thread_of` validation.
- `tests/peer-id-env.test.ts` — sticky peer id via env.
