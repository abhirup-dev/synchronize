# MCP Adapter Surface Navigation

Use this memory to orient in MCP code, then verify exact behavior in source and
tests.

## Where to look

- `src/mcp/server.ts` — MCP server construction.
- `src/mcp/state.ts` — adapter-local state and daemon client discovery.
- `src/mcp/lifecycle.ts` — registration, heartbeat, sticky peer id.
- `src/mcp/tools/` — individual bridge tools.
- `src/mcp/tools/event-format.ts` — daemon event formatting for MCP responses.
- `tests/mcp.test.ts`, `tests/mcp-e2e.test.ts`, `tests/mcp-archive.test.ts`.

## Mental model

The MCP adapter is intentionally thin. Durable truth lives in the daemon; MCP
tools call typed `src/api/` helpers.

Codex uses polling notifications. Claude can use local callback push for local
daemon connections; remote Claude falls back to polling because a remote daemon
cannot call back to the client's localhost endpoint. Inbox remains the fallback.

## Config guardrail

For exact MCP config/env behavior, use `docs/configuration/` and
`src/mcp/lifecycle.ts`. Do not duplicate env tables here.
