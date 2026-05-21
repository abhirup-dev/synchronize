# Suggested Commands

## Install / setup
```bash
bun install                       # install deps
bun link                          # link `synchronize` + `synchronize-mcp` onto PATH
```

## Tests + type-check (run these as task-completion gates)
```bash
bun test                          # full test suite (integration-style; spins up real daemon under tmp SYNCHRONIZE_HOME)
bun test tests/messaging.test.ts  # single file
bun test -t "pattern"             # filter by test-name pattern
bun run typecheck                 # tsc --noEmit
```

## Run components from source
```bash
bun run src/daemon.ts                              # daemon directly
bun run src/cli.ts <args>                          # CLI from source (or just `synchronize <args>` after `bun link`)
SYNCHRONIZE_MCP_MODE=codex  bun run src/mcp.ts     # MCP adapter, codex notifications
SYNCHRONIZE_MCP_MODE=claude bun run src/mcp.ts     # MCP adapter, Claude channel notifications
```

## Daemon lifecycle (Makefile)
```bash
make daemon-relaunch              # kill + wipe ~/.synchronize, then start fresh — USE THIS DURING DEV
make daemon-kill                  # kill daemon + nuke runtime dir
make demo                         # seed .demo-synchronize/ with sample data, render once
make demo-top                     # live top dashboard over the demo home
make demo-json                    # raw JSON summary over the demo home
make demo-clean                   # tear down demo home
```

## Beads (issue tracker — MANDATORY for task tracking)
```bash
bd prime                          # full workflow + close-protocol reminder
bd ready                          # find available work
bd show <id>                      # detailed view + deps
bd update <id> --claim            # claim work
bd close <id>                     # complete work
bd dolt push                      # push beads data to remote (MANDATORY at session close)
```
Do NOT use TodoWrite / TaskCreate / markdown todo lists. Don't write MEMORY.md files — use `bd remember`.

## Session close (MANDATORY workflow per project CLAUDE.md)
```bash
git pull --rebase
bd dolt push
git push                          # work is NOT complete until this succeeds
git status                        # must show "up to date with origin"
```

## Darwin / macOS specifics
- Shell is zsh. Globs are not implicitly recursive (use `**/*.ts` patterns or explicit dirs).
- Avoid relying on GNU long options: `sed -i ''` (BSD sed needs empty backup arg), `find` lacks `-printf`.
- **Always pass non-interactive flags** to file ops — `cp -f`, `mv -f`, `rm -f`, `rm -rf`. macOS often aliases these to `-i` which hangs the agent on y/n prompts. See `AGENTS.md`.
- `pkill -f "<full path>"` works as expected. `jq` is available system-wide.

## Daemon debugging cheats
```bash
cat ~/.synchronize/daemon.json    # discover baseUrl + pid
BASE_URL=$(jq -r .baseUrl ~/.synchronize/daemon.json)
curl "$BASE_URL/health"
curl "$BASE_URL/status"
synchronize status                # auto-launches daemon if not running
synchronize inbox                 # durable inbox fallback for CLI peer
```

## Throwaway test home
```bash
SYNCHRONIZE_HOME=/tmp/sync-x synchronize status   # don't clobber the user's real ~/.synchronize state
```
