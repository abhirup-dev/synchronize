# Task Completion Checklist

Run this before claiming any work "done". Per project CLAUDE.md, **work is NOT complete until `git push` succeeds**.

## 1. Quality gates (if code changed)
```bash
bun run typecheck        # tsc --noEmit — must pass clean
bun test                 # full integration suite — all green
```
Tests are integration-style: they spin up real daemons under tmp `SYNCHRONIZE_HOME`. There is no separate lint / format step in v0 (no eslint/prettier config in tree). Type-check + tests are the gates.

## 2. Manual smoke (when touching adapter / daemon behavior)
Use the "Fresh Manual Test Setup" recipe in `README.md` (~lines 423–447):
```bash
bun install && bun link
make daemon-relaunch
SYNCHRONIZE_MCP_BIN="$(command -v synchronize-mcp)"
codex mcp remove synchronize || true
codex mcp add --env SYNCHRONIZE_MCP_MODE=codex synchronize -- "$SYNCHRONIZE_MCP_BIN"
claude mcp remove synchronize -s user || true
claude mcp add synchronize "$SYNCHRONIZE_MCP_BIN" --scope user -e SYNCHRONIZE_MCP_MODE=claude
```
Multi-agent smoke covers: register → dm → inbox → group send/history → media share → Claude channel push → Codex logging notification.

## 3. Beads issue hygiene
```bash
bd ready                          # confirm no orphaned blockers
bd close <id1> <id2> ...          # close finished work
bd update <id> --notes "..."      # update in-progress items with status
# File any follow-up beads BEFORE closing the session
```

## 4. Push to remote (MANDATORY)
```bash
git pull --rebase
bd dolt push                      # push beads data first
git push
git status                        # MUST show "up to date with origin"
```
Never stop before pushing. Never say "ready to push when you are" — push yourself. If push fails, resolve and retry.

## 5. Clean up
- Clear stashes (`git stash list` → drop if not needed).
- Prune dead remote branches (`git fetch --prune`).
- Don't leave background `make daemon-relaunch` or `--watch` processes running.

## 6. Hand off (for substantial sessions)
- If a session crossed multiple steps, write a handoff under `.claude/handoffs/<timestamp>-<slug>.md` describing state, decisions, next steps. The `sync-mkj` phase-1 handoff is the canonical template.
- Pending work goes into beads (`bd create`), not into ad-hoc TODO files.
