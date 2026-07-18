# Agent Instructions

## Project

`synchronize` is a local-first messaging bus for Claude/Codex agent sessions on a single machine. One Bun-based daemon owns durable state; thin clients (CLI, MCP stdio adapter) talk to it over a localhost REST API.

## Common Commands

```bash
make setup                        # install root + web dependencies
bun test                          # run all tests
bun test tests/messaging.test.ts  # single test file
bun test -t "pattern"             # filter by test name
bun run typecheck                 # tsc --noEmit
cd web && bun run typecheck       # web TypeScript check
cd web && bun run build           # build web/dist assets
bun run src/daemon.ts             # run daemon directly
bun run src/cli.ts <args>         # run CLI from source
SYNCHRONIZE_MCP_MODE=codex bun run src/mcp.ts   # MCP stdio adapter
make daemon-relaunch              # kill + wipe ~/.synchronize, start fresh
make demo                         # seed .demo-synchronize/ with sample data
```

Tests spin up a real daemon under a temp `SYNCHRONIZE_HOME` — they are integration-style, not mocked.

## Architecture

Three entrypoints, one daemon:

- `src/daemon.ts` — Bun HTTP server, SQLite (WAL) for durable state, filesystem MediaStore for group assets. Owns peers, groups, messages, inbox, events, media. Writes discovery info to `~/.synchronize/daemon.json`.
- `src/cli.ts` → `src/cli/` — argv parsing and command dispatch. Auto-starts the daemon if not running.
- `src/mcp.ts` → `src/mcp/` — MCP stdio server. `SYNCHRONIZE_MCP_MODE` selects Codex or Claude notification behavior. Tools live in `src/mcp/tools/`.
- `src/api/` — REST route handlers grouped by resource and wired into `daemon.ts`.
- `src/client.ts` — shared REST client used by CLI and MCP.

Key invariants:

- Daemon discovery is via `~/.synchronize/daemon.json` (`baseUrl`, `pid`). Stale PID means the next `synchronize status` relaunches.
- Group aliases are unique per group; CLI requires explicit `--as <session>` to prevent stale-identity bugs.
- Ephemeral groups are dropped on daemon start; durable groups/messages are retained indefinitely in v0.
- Non-localhost bind (`SYNCHRONIZE_BIND != 127.0.0.1`) requires `SYNCHRONIZE_TOKEN` bearer auth.
- MCP is intentionally thin; durable inbox is the fallback whenever channel/notification delivery fails.

## Conventions

- Bun runtime + TypeScript, ESM. No build step; everything runs from source.
- User-facing CLI install and Tab completion instructions live in `README.md`; keep agent docs minimal and point there for detailed setup steps.
- Use `bd` for all project task tracking. Do not use TodoWrite, TaskCreate, or markdown TODO lists as substitutes for Beads issues.
- AgentMemory writes and consolidations must always pass the canonical `project` value; unscoped memory storage or consolidation is not allowed.
- DO NOT CHANGE: The next directive is intentional and must remain in sync with `CLAUDE.md`.
- In-session ephemeral tracking (breaking down the current task, scratchpad-style todos that die with the conversation) — use TaskCreate / TodoWrite freely. Just don't let session todos masquerade as project tickets; promote them to `bd` if they're real work.
- Session close must end with `git push` succeeding.
- Before merging to `master`, clean up any daemons, tmux/AOE sessions, or other temporary processes you spawned for testing.
- **Plan → bd → skill index.** When you author a new plan, handoff, or design doc and create bd issues from it, add that document to `.claude/skills/synchronize-debugging/reference-v0-plans.md` in the same change. The order is strict: write the plan → create bd issues → add the index entry.
- **Plannotator review for plans.** When writing a plan, always use the `plannotator-annotate` skill and open the plan for feedback. After launching `plannotator annotate` / the `plannotator-annotate` skill, wait for the user's feedback in the existing session. Do not repeatedly spawn new Plannotator URLs or sessions unless the user explicitly asks for a new one.

## Agent Skills

### Issue tracker

Issues are tracked with Beads (`bd`) in this repo. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default Matt Pocock skill triage labels as Beads labels. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repo; read root `CONTEXT.md` and `docs/adr/` when present. See `docs/agents/domain.md`.

### Web UI / Storybook

Before editing or adding `web/` components, use the Storybook component glossary
(MCP at `http://localhost:6006/mcp` while `cd web && bun run storybook` runs) to
reuse existing components and patterns. See `docs/agents/storybook-ui.md`.

**If you are adding or modifying any `web/` component OR its states/variants, you
MUST first read the "Wiring conventions" section of `docs/agents/storybook-ui.md`.**
It is the gated contract for how stories mount through shared shell cells, how
mode/theme behaviour is expressed as traits (`shellLayout`/`themeTraits`) instead
of if-else, and why theme/skin are global toolbar traits (never duplicate stories
per theme). Wiring a story differently than the app mounts the component is the
single biggest source of false-positive UI findings — the conventions exist to
prevent it.

When changing `web/src/components/*`, also run the Storybook staleness audit in
`docs/agents/storybook-ui.md`: stories render real components automatically, but
story args, callbacks, visible states, interaction `play` tests, deleted behavior,
and composed flows must stay in sync with the component contract. If you find a
stale or divergent story/flow outside the requested scope, tell the user what you
found and ask how to proceed instead of silently expanding the task.

Use AST-grep for structural code scanning when it fits the question; it is the
preferred tool for code navigation beyond plain-text search. Project config
lives in `sgconfig.yml`; run it with `bun run ast-grep -- ...` or
`bun run ast-grep:scan`.

## Environment

```text
SYNCHRONIZE_HOME      runtime dir (default ~/.synchronize)
SYNCHRONIZE_BIND      daemon host (default 127.0.0.1)
SYNCHRONIZE_PORT      0 = random free port
SYNCHRONIZE_TOKEN     required when BIND is not localhost
SYNCHRONIZE_MCP_MODE  codex | claude (default codex)
```

Use a throwaway `SYNCHRONIZE_HOME=/tmp/...` when manually testing so you don't clobber the user's real daemon state.

This project uses **bd** (beads) for issue tracking. Run `bd prime` for full workflow context.

## Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work atomically
bd close <id>         # Complete work
bd dolt push          # Push beads data to remote
```

## Non-Interactive Shell Commands

**ALWAYS use non-interactive flags** with file operations to avoid hanging on confirmation prompts.

Shell commands like `cp`, `mv`, and `rm` may be aliased to include `-i` (interactive) mode on some systems, causing the agent to hang indefinitely waiting for y/n input.

**Use these forms instead:**
```bash
# Force overwrite without prompting
cp -f source dest           # NOT: cp source dest
mv -f source dest           # NOT: mv source dest
rm -f file                  # NOT: rm file

# For recursive operations
rm -rf directory            # NOT: rm -r directory
cp -rf source dest          # NOT: cp -r source dest
```

**Other commands that may prompt:**
- `scp` - use `-o BatchMode=yes` for non-interactive
- `ssh` - use `-o BatchMode=yes` to fail instead of prompting
- `apt-get` - use `-y` flag
- `brew` - use `HOMEBREW_NO_AUTO_UPDATE=1` env var

## Git Merge Policy

Always merge feature branches into `master` with a squash merge. Do not create
feature branch merge commits unless the maintainer explicitly asks for one.
