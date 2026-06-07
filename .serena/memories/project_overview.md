# synchronize — Project Overview

`synchronize` is a local-first messaging bus for multiple local coding-agent sessions. One Bun daemon owns durable state; CLI, MCP stdio adapters, web UI, and the Pi extension talk to it over localhost REST.

## Runtime model

- `src/daemon.ts` is the entrypoint; daemon runtime is modularized under `src/daemon/server.ts`, `src/daemon/routes/`, `src/daemon/repo/`, and `src/daemon/services/`.
- Discovery is via `$SYNCHRONIZE_HOME/daemon.json`; clients auto-start or connect through `src/client.ts` and the typed `src/api/` facade.
- Identity is peer-based. `agent_sessions` binds native Claude/Pi/Codex session ids to synchronize peers.
- Runtime settings resolve as `defaults < $SYNCHRONIZE_HOME/config.toml < env`; use `docs/configuration/` for current config/env details.

## Surfaces

- CLI: `src/cli/` and `bin/synchronize`.
- MCP: `src/mcp/` and `bin/synchronize-mcp`.
- Launch: `src/launch/` plus daemon launch repositories/services.
- Web: `web/src/`, `/web/state`, and `/web/events`.
- Pi extension: `extensions/pi-synchronize/`.
- Integration harness: `scripts/integration-aoe/`.

## Operating rules

- Use Beads (`bd`) for durable task tracking; `.beads/issues.jsonl` is canonical issue state.
- Use throwaway `SYNCHRONIZE_HOME` values for manual tests to avoid clobbering `~/.synchronize`.
- Keep Serena memories as navigation/orientation only. Detailed current references belong in repo docs: `README.md`, `docs/configuration/`, and `docs/debugging/`.
- For daemon debugging, start from `.claude/skills/synchronize-debugging/SKILL.md`; it is a minimal symptom router that points to docs/source instead of duplicating recipes.
