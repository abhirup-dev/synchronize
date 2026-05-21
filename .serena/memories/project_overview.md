# synchronize — Project Overview

**Purpose**: Local-first messaging bus for multiple Claude/Codex agent sessions running on the same machine. Gives agents a shared bus for direct messages, durable inboxes, group chats, and copied group media — without anything leaving the machine.

**Runtime model**: One long-running Bun daemon owns durable state. Two thin clients (CLI, MCP stdio adapter) talk to it over a localhost REST API. Discovery is via `~/.synchronize/daemon.json`.

**Status (as of 2026-05): v0.1.0.** `sync-mkj` epic phase 1 is merged (squashed PR #1 = commit `f8b5f24`) — API, CLI, and MCP monoliths have been split into domain folders behind compat shims. **Phase 2 is the daemon split** — `src/daemon.ts` is still a ~1077 LOC monolith and is the next target. See `pending_work.md`.

**Out-of-scope for v0**: WebSocket/SSE, cloud sync, encryption, remote peer discovery, GUI, retention/pruning.

**Tech stack**:
- Bun 1.3+ runtime, TypeScript (ESM), no build step (everything runs from source).
- SQLite (WAL mode) via Bun's built-in bindings for durable state.
- Filesystem MediaStore for group assets.
- `@modelcontextprotocol/sdk` for the MCP stdio server.

**Entrypoints**:
- `bin/synchronize` → CLI
- `bin/synchronize-mcp` → MCP stdio server
- `bun run src/daemon.ts` → daemon (auto-launched by CLI on first call)

**Issue tracker**: Beads (`bd`). Issues live in `.beads/issues.jsonl`; do NOT use TodoWrite / markdown todos. Session-close requires `git push` succeeding (see CLAUDE.md).
