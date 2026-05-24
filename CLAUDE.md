# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

`synchronize` is a local-first messaging bus for Claude/Codex agent sessions on a single machine. One Bun-based daemon owns durable state; thin clients (CLI, MCP stdio adapter) talk to it over a localhost REST API.

## Common Commands

```bash
bun install
bun test                          # run all tests
bun test tests/messaging.test.ts  # single test file
bun test -t "pattern"             # filter by test name
bun run typecheck                 # tsc --noEmit
bun run src/daemon.ts             # run daemon directly
bun run src/cli.ts <args>         # run CLI from source
SYNCHRONIZE_MCP_MODE=codex bun run src/mcp.ts   # MCP stdio adapter
make daemon-relaunch              # kill + wipe ~/.synchronize, start fresh
make demo                         # seed .demo-synchronize/ with sample data
```

Tests spin up a real daemon under a temp `SYNCHRONIZE_HOME` — they are integration-style, not mocked.

## Architecture

Three entrypoints, one daemon:

- `src/daemon.ts` — Bun HTTP server, SQLite (WAL) for durable state, filesystem MediaStore for group assets. Owns peers, groups, messages, inbox, events, media. Writes discovery info to `~/.synchronize/daemon.json` (random port by default). This is the only file with substantial business logic (~40KB); everything else is thin.
- `src/cli.ts` → `src/cli/` — argv parsing and command dispatch. Subcommands under `src/cli/commands/`, terminal rendering under `src/cli/render/`. Auto-starts the daemon if not running.
- `src/mcp.ts` → `src/mcp/` — MCP stdio server. `SYNCHRONIZE_MCP_MODE` selects notification path: `codex` uses standard `notifications/message` via per-peer polling; `claude` uses `notifications/claude/channel` via one localhost event-callback subscription. Tools live in `src/mcp/tools/`.
- `src/api/` — REST route handlers grouped by resource (peers, groups, media, inbox, events, status). Wired into `daemon.ts`.
- `src/client.ts` — shared REST client used by both CLI and MCP. Both surfaces are pure adapters over this client.

Key invariants:

- Daemon discovery is via `~/.synchronize/daemon.json` (`baseUrl`, `pid`). Stale PID → next `synchronize status` relaunches.
- Group aliases are unique per group; CLI requires explicit `--as <session>` to prevent stale-identity bugs.
- Ephemeral groups are dropped on daemon start; durable groups/messages are retained indefinitely in v0.
- Non-localhost bind (`SYNCHRONIZE_BIND != 127.0.0.1`) requires `SYNCHRONIZE_TOKEN` (Bearer auth).
- MCP is intentionally thin — durable inbox is the fallback whenever channel/notification delivery fails.

## Conventions

- Bun runtime + TypeScript, ESM. No build step; everything runs from source.
- Squash-merge feature branches into `master`. No merge commits for feature integration.
- Use non-interactive shell flags (`cp -f`, `rm -rf`, etc.) — see `AGENTS.md`.
- Project task tracking via `bd` (beads): tickets, work items, issues, bugs, features — anything that outlives the session. Don't use TodoWrite or markdown TODO files for these. Run `bd prime` for the full workflow.
- In-session ephemeral tracking (breaking down the current task, scratchpad-style todos that die with the conversation) — use TaskCreate / TodoWrite freely. Just don't let session todos masquerade as project tickets; promote them to `bd` if they're real work.
- Session close must end with `git push` succeeding (see workflow in `AGENTS.md`).
- **Plan → bd → skill index.** When you author a new plan, handoff, or design doc and create bd issues from it, you MUST then add that document to `.claude/skills/synchronize-debugging/reference-v0-plans.md` in the same change. The skill index is the gated discovery surface for historical references; a plan that exists on disk but is not indexed there is effectively invisible to future sessions. The order is strict: write the plan → create bd issues → add the index entry. Never the other way around.

## Agent skills

### Issue tracker

Issues are tracked with Beads (`bd`) in this repo. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default Matt Pocock skill triage labels as Beads labels. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repo; read root `CONTEXT.md` and `docs/adr/` when present. See `docs/agents/domain.md`.

## Environment

```text
SYNCHRONIZE_HOME      runtime dir (default ~/.synchronize)
SYNCHRONIZE_BIND      daemon host (default 127.0.0.1)
SYNCHRONIZE_PORT      0 = random free port
SYNCHRONIZE_TOKEN     required when BIND is not localhost
SYNCHRONIZE_MCP_MODE  codex | claude (default codex)
```

Use a throwaway `SYNCHRONIZE_HOME=/tmp/...` when manually testing so you don't clobber the user's real daemon state.
