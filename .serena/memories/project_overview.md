# synchronize — Project Overview

**Purpose**: `synchronize` is a local-first messaging bus for multiple local coding-agent sessions. One Bun daemon owns durable state; CLI, MCP stdio adapters, web UI, and the Pi extension talk to it over localhost REST.

## Runtime model

- `src/daemon.ts` is the durable owner: Bun HTTP server, SQLite WAL database, filesystem media store, web state/SSE, launch reconciliation, and event/inbox fanout.
- Discovery is via `~/.synchronize/daemon.json` (`baseUrl`, `pid`). Thin clients auto-start or reconnect to the daemon through `src/client.ts` and the typed `src/api/` facade.
- `bin/synchronize` runs the CLI; `bin/synchronize-mcp` runs the MCP adapter for Claude/Codex/Pi-style hosts.
- Runtime identity is peer-based. Agent session bindings correlate native Claude/Pi host session ids to synchronize peer ids in the `agent_sessions` table.

## Current surfaces

- CLI: `src/cli/` with commands for status/top/register/whoami/peers/dm/inbox/group/media/hook/launch/spawn.
- MCP: `src/mcp/` with register/peers/messaging/groups/media/context/event-format/launch tools and mode-specific notification paths.
- Launch: `src/launch/` resolves and runs daemon-managed AOE-backed `claude` and `pi` sessions.
- Web: `web/src/` renders live daemon state from `/web/state` and `/web/events`.
- Pi extension: `extensions/pi-synchronize/` is co-versioned and mirrors daemon discovery/subscription behavior without importing workspace internals.
- Integration harness: `scripts/integration-aoe/` drives real tmux/AOE/Pi scenarios and writes artifacts for postmortems.

## Operating rules

- Use Beads (`bd`) for durable task tracking; `.beads/issues.jsonl` is canonical issue state.
- Use throwaway `SYNCHRONIZE_HOME` values for manual tests to avoid clobbering `~/.synchronize`.
- Session close policy in project instructions requires quality gates when code changes and a successful push before ending a work session.
