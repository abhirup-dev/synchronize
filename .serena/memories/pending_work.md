# Pending Work (as of 2026-05)

## `sync-mkj` epic — Phase 2: daemon split (NOT STARTED)

Phase 1 (API/CLI/MCP split) merged via squashed PR #1 = commit `f8b5f24`. Phase 2 has not started.

### Open beads in this epic
- `sync-mkj.9` — daemon module boundary design (claim this first; write boundary plan in the bead's `--design` field BEFORE touching code)
- `sync-mkj.10` — daemon routes + validation split
- `sync-mkj.11` — daemon repository + media + subscription helpers split
- `sync-mkj.8` — final verification
- `sync-mkj` — parent epic

### Likely target layout (subject to revision after reading actual code)
```
src/daemon/
  index.ts                 ← createDaemonServer factory
  routes/                  ← route registrars (one per resource: peers, groups, media, ...)
  validation/              ← shared schema/validation helpers
  repository/              ← SQLite repository helpers
  media-store/             ← filesystem MediaStore behavior
  subscriptions/           ← event subscription fanout
src/daemon.ts              ← compat shim (export * + import.meta.main guard)
```

### Constraints for phase-2
- Use the same **factory-closure** pattern as the MCP split. `createDaemonServer({ paths })` returning `{ start, stop, handle }`; route registrars receive a `RouteContext`. Do NOT introduce a class.
- The daemon must serve **exactly** the routes that `src/api/*.ts` consume. Use `src/api/` as the canonical contract.
- All daemon-side identity trust stays as-is (daemon trusts callers; identity guardrails live in `src/cli/identity.ts`).
- After phase-2, `rg "requestJson" src/cli src/mcp src/daemon` must still be empty.
- Test gates: `tests/api.test.ts`, `tests/messaging.test.ts`, `tests/mcp.test.ts`, `tests/mcp-e2e.test.ts`, `tests/health.test.ts` all exercise the daemon end-to-end. Run after every commit.

## Owed manual smoke test
The user owes ONE multi-agent manual smoke (Claude MCP + Codex MCP + CLI scenario covering register, dm, inbox, group send, group history, media share, Claude channel push, Codex logging notification) to bless phase-1 before phase-2 starts. Recipe is in `README.md` "Fresh Manual Test Setup" section. Phase-2 shouldn't behaviorally break anything anyway, but the user wanted this gate.

## Follow-up beads filed during phase-1 (not part of the epic)
- `sync-x9p` — collapse the stdio-main duplication between `bin/synchronize-mcp` and `src/mcp.ts` shim
- `sync-6wm`, `sync-kii`, `sync-3wc` — other improvement beads (see `bd show <id>` for details)

## Architecture concerns surfaced by graphify analysis
Three communities flagged with **low cohesion** in the graphify report — candidates for review during phase-2 boundary design:
- **REST API Handlers** community (cohesion 0.08) — may need finer split.
- **Daemon Core** community (cohesion 0.06) — already known phase-2 target.
- **Peer & Event Layer** community (cohesion 0.11) — possible additional split candidate.

Also: graphify identified **140 weakly-connected nodes** in the graph — likely documentation gaps (top-level config files, package.json keys) more than real architectural issues.
