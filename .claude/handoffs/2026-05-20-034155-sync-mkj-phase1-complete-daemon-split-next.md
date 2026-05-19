# Handoff: sync-mkj phase 1 (API/CLI/MCP) merged — daemon split (phase 2) is next

## Session Metadata
- Created: 2026-05-20 03:41:55
- Project: /Users/abhirupdas/Codes/Personal/synchronize
- Branch: master (at commit `f8b5f24`)
- Session duration: ~one focused work block — plan, refactor across 4 phases, Codex audit, squash merge

### Recent Commits (for context)
  - `f8b5f24` refactor: modularize src/api.ts, src/cli.ts, src/mcp.ts (sync-mkj phase 1) (#1) ← **this session's deliverable**
  - `44388a7` Squash merge REST client unification ← previous epic (`sync-6h3`)
  - `3af9c68` Harden synchronize MCP delivery
  - `775fa90` Fix installed MCP stdio wrapper
  - `7e7d88d` Add daemon reset Make targets

## Handoff Chain

- **Continues from**: None (fresh start for daemon split)
- **Supersedes**: None

> First handoff in the `sync-mkj` epic chain. The next handoff in this chain should reference this one once daemon phase 2 lands.

## Current State Summary

Beads epic `sync-mkj` is **half done**. Phase 1 — splitting the three adapter monoliths (`src/api.ts`, `src/cli.ts`, `src/mcp.ts`) into domain-scoped folders behind compatibility shims — landed on `origin/master` as squashed commit `f8b5f24` via PR https://github.com/abhirup-dev/synchronize/pull/1. All gates green: `bun run typecheck` clean, 12/12 unit + 2/2 e2e pass, Codex audit caught one missed type re-export and it was fixed before merge.

**Phase 2 (daemon split) has not started.** `src/daemon.ts` is still a 1077-line monolith mixing route dispatch, validation helpers, persistence helpers, subscription fanout, media-store filesystem behavior, and server startup. Beads children `sync-mkj.9` (design), `.10` (routes + validation), `.11` (repository + media + subscription helpers) are open. Parent epic `sync-mkj` and final-verification child `.8` are also open until daemon phase 2 lands.

One **manual smoke test is owed** by the user before the phase-1 refactor is fully blessed: multi-agent Claude MCP + Codex MCP + CLI scenario covering register, dm, inbox, group send, group history, media share, Claude channel notifications, Codex logging notifications. Daemon phase 2 should not start *behaviorally* breaking anything anyway, but the user wanted to gate this manual run after phase 1 merged. Remind them.

## Codebase Understanding

## Architecture Overview

`synchronize` is a local agent-messaging bus. One long-running daemon (`src/daemon.ts`) owns SQLite + filesystem state and exposes a REST API on a random local port. Two adapters consume that REST API:

- **CLI** (`bin/synchronize` → `src/cli/`): one-shot commands (`status`, `register`, `dm`, `inbox`, `group …`, `media …`, `top`). CLI peers do NOT subscribe to Claude channel notifications; they're inbox-pull-only.
- **MCP server** (`bin/synchronize-mcp` → `src/mcp/`): long-running stdio process. Two notification modes selected by `SYNCHRONIZE_MCP_MODE` env: `codex` → polling `NotificationBridge` that forwards via `notifications/message`; `claude` → `EventSubscription` HTTP callback server that emits experimental `notifications/claude/channel`.

Shared between CLI and MCP: `src/client.ts` (daemon discovery via `~/.synchronize/daemon.json` + `requestJson` transport) and the new `src/api/` (typed REST operation facade).

After phase 1, the source tree looks like:

```
src/
├── api/                       ← typed REST facade (phase 1)
│   ├── index.ts               ← barrel
│   ├── types.ts               ← DTOs: StatusResponse, Peer, Event, Group, GroupMember,
│   │                            MediaItem, EventSubscriptionRegistration, SummaryResponse,
│   │                            SummaryPeer
│   ├── status.ts              ← getStatus, getSummary, findReusablePeer
│   ├── peers.ts               ← registerPeer, heartbeatPeer, deletePeer, listPeers
│   ├── inbox.ts               ← readInbox, ackInbox, sendDm
│   ├── events.ts              ← readEvents, subscribeToEvents
│   ├── groups.ts              ← createGroup, listGroups, joinGroup, leaveGroup,
│   │                            sendGroupMessage, getGroupHistory
│   └── media.ts               ← shareMedia, listMedia, getMedia
├── api.ts                     ← compat shim: `export * from "./api/index.ts"`
│
├── cli/                       ← CLI (phase 1)
│   ├── index.ts               ← main(argv); NO side-effect-on-import (guarded by import.meta.main in shim)
│   ├── help.ts, flags.ts, identity.ts, warnings.ts
│   ├── render/{table,summary}.ts
│   └── commands/{status,top,register,whoami,peers,dm,inbox,group,media}.ts
├── cli.ts                     ← compat shim: re-exports main + renderSummary; runs main under import.meta.main
│
├── mcp/                       ← MCP server (phase 1)
│   ├── index.ts               ← barrel
│   ├── state.ts               ← AdapterState, NotifyMode, NotificationSink,
│   │                            SynchronizeMcpServer, getMode, getClient, requirePeer
│   ├── util.ts                ← text(), log(), formatError() — shared helpers
│   ├── notifications.ts       ← emitMcpNotification, formatClaudeChannelMeta, formatChannelContent
│   ├── codex-notifier.ts      ← NotificationBridge (polling loop)
│   ├── claude-subscription.ts ← EventSubscription (HTTP callback server)
│   ├── lifecycle.ts           ← MCP_INSTRUCTIONS, resolveMcpRegisterPeerId, lifecycle hooks factory
│   ├── server.ts              ← createMcpServer factory (delegates to tool registrars)
│   └── tools/
│       ├── context.ts         ← ToolContext shape: { mcp, state, emit, lifecycle }
│       ├── register.ts        ← bridge_register, bridge_whoami
│       ├── peers.ts           ← bridge_list_peers
│       ├── messaging.ts       ← bridge_dm, bridge_inbox
│       ├── groups.ts          ← bridge_create_group, bridge_join_group, bridge_leave_group,
│       │                        bridge_send_group, bridge_group_history, bridge_list_groups
│       └── media.ts           ← bridge_share_media, bridge_list_media, bridge_get_media
├── mcp.ts                     ← compat shim: re-exports createMcpServer + NotificationBridge +
│                                NotificationBridgeOptions + EventSubscription +
│                                EventSubscriptionOptions + emitMcpNotification;
│                                still runs stdio main under import.meta.main (duplication
│                                with bin/synchronize-mcp is tracked by sync-x9p)
│
├── daemon.ts                  ← ★ 1077 LOC, STILL A MONOLITH — phase 2 target ★
├── client.ts                  ← daemon discovery + requestJson; consumed by api/, cli/, mcp/
├── constants.ts               ← MCP_HEARTBEAT_MS, DEFAULT_NOTIFICATION_BUFFER, NOTIFIER_ACTIVE_MS, NOTIFIER_IDLE_MS
├── db.ts                      ← SQLite open + migrations
├── fs.ts                      ← readJson/writeJson helpers
├── http.ts                    ← request helpers (used by daemon)
└── paths.ts                   ← runtime path layout
```

## Critical Files

| File | Purpose | Relevance to next session |
|------|---------|----------------------------|
| `src/daemon.ts` | THE thing to split in phase 2 | Primary edit target. 1077 LOC. |
| `src/api/` directory | Typed REST facade contract | Phase-2 daemon must serve **exactly the same routes** these functions hit. Use this dir as the canonical list of endpoints the daemon owes. |
| `src/api.ts`, `src/cli.ts`, `src/mcp.ts` | Compat shims | Do NOT change their export surface unless you also change consumers. |
| `tests/messaging.test.ts` (CLI spawn tests), `tests/mcp.test.ts`, `tests/mcp-e2e.test.ts`, `tests/api.test.ts`, `tests/health.test.ts` | Verification gates | Run after every daemon-split commit. They all exercise the daemon end-to-end. |
| `Makefile` targets `demo*`, `daemon-kill`, `daemon-relaunch` | Local dev resets | `make daemon-relaunch` blanks `~/.synchronize` and restarts the daemon. Use during phase-2 dev. |
| `README.md` "Fresh Manual Test Setup" (lines ~423–447) | Multi-agent smoke recipe | This is the smoke the user owes; also useful for phase-2 manual verification. |
| `bin/synchronize`, `bin/synchronize-mcp` | External entrypoints | Phase-2 changes must not break these. `bun link` ensures global `synchronize-mcp` resolves to whichever worktree is currently linked. |
| `.beads/issues.jsonl` | Issue tracker state | Use `bd` for all task tracking. |

### Key Patterns Discovered

1. **Compatibility-shim pattern** (now established for all three adapters): the top-level `src/foo.ts` becomes a 1–10-line file that re-exports the public surface from `src/foo/`, optionally with an `import.meta.main` guard for files that double as scripts. Apply the same pattern to `src/daemon.ts` in phase 2.

2. **`import type` for cross-file type sharing**: code-mover style. When a value-and-type live in different domains, use `import { Foo } from "./foo.ts"` for values and `import type { Bar } from "./bar.ts"` for types. The MCP `state.ts ↔ codex-notifier.ts ↔ claude-subscription.ts` triangle uses this to avoid runtime cycles (TS erases type-only edges).

3. **Closure-factory style for stateful subsystems** — explicitly preferred over classes. `createMcpServer()` builds a private `AdapterState`, builds `lifecycleHooks` by passing `state` to a factory, then threads `{ mcp, state, emit, lifecycle }` as a `ToolContext` into each tool registrar. The same shape is the locked-in pattern for the daemon split: think `createDaemonServer({ paths })` returning `{ start, stop, handle }`, with route registrars receiving a `RouteContext`.

4. **`.ts` extension on every import** (Bun convention). Every new file in `src/` should use `import "./foo.ts"`, not `"./foo"`.

5. **CLI guardrails stay CLI-local**. `requireIdentity`, `resolveCliRegisterPeerId`, `--as SESSION_NAME` enforcement are NOT in `src/api/`. They live in `src/cli/identity.ts`. Phase 2 must preserve this — do not move identity guardrails into the daemon either; the daemon trusts its REST callers.

6. **MCP server name → channel name**. The MCP server registers itself as `name: "synchronize"`. To surface Claude channel notifications, launch claude with `--dangerously-load-development-channels server:synchronize`. The wrapper `cch synchronize` (now in `~/.config/rc/functions.sh`) does this.

7. **No `requestJson` in adapters** is a gate. Adapters call through `src/api/`; the daemon owns route handlers. After phase 2, `rg "requestJson" src/cli src/mcp src/daemon` should still be empty.

## Work Completed

### Tasks Finished

- [x] Manual baseline (`sync-mkj.1`) — skipped per user direction; closed with that reason
- [x] Module boundary design (`sync-mkj.2`) — locked in plan file (see Related Resources); closed
- [x] API split (`sync-mkj.3`) — 8 files in `src/api/`, shim, tests updated to import from new paths; closed
- [x] CLI split (`sync-mkj.4`) — 14+ files in `src/cli/`, shim with `import.meta.main` guard, `bin/synchronize` updated to call `main()` explicitly; closed
- [x] MCP runtime split (`sync-mkj.5`) — state, util, notifications, codex-notifier, claude-subscription, lifecycle, server modules; tests updated; closed
- [x] MCP tool registration split (`sync-mkj.6`) — 5 domain registrars under `src/mcp/tools/`, ToolContext shape; closed
- [x] Docs/skills/refs audit (`sync-mkj.7`) — no edits needed; shims preserve all external references; closed with that reason
- [x] Codex audit of PR diff — caught missing `NotificationBridgeOptions`/`EventSubscriptionOptions` re-exports on `src/mcp.ts` shim; fixed in last commit before merge
- [x] PR opened, squash-merged to master as `f8b5f24`; refactor branch deletable
- [x] Filed 4 follow-up improvement beads (sync-x9p, sync-6wm, sync-kii, sync-3wc)
- [x] Daemon nuked + restarted clean (PID 99232, port 58931 — see Environment State)
- [x] Out-of-repo side cleanups (see below)

## Files Modified

| File | Changes | Rationale |
|------|---------|-----------|
| `src/api.ts` | Became 1-line `export *` shim | Compat for `bin/`, README examples, external callers |
| `src/cli.ts` | Became shim with `import.meta.main` guard + `renderSummary` re-export | Compat + side-effect-free import |
| `src/mcp.ts` | Became shim re-exporting createMcpServer + NotificationBridge + NotificationBridgeOptions + EventSubscription + EventSubscriptionOptions + emitMcpNotification; kept pre-existing stdio main block | Compat for `bin/synchronize-mcp` and `bun run src/mcp.ts` |
| `src/api/*.ts` (8 new files) | Domain-split REST facade | Phase-1 deliverable |
| `src/cli/**/*.ts` (14+ new files) | Domain-split CLI | Phase-1 deliverable |
| `src/mcp/**/*.ts` (13+ new files) | Domain-split MCP server | Phase-1 deliverable |
| `bin/synchronize` | Now calls `main(process.argv.slice(2))` explicitly | Matches side-effect-free `src/cli.ts` shim |
| `tests/api.test.ts` | Imports from new module paths instead of shim | Tests follow new structure honestly |
| `tests/mcp.test.ts` | Imports `NotificationBridge` from `../src/mcp/codex-notifier.ts`, `emitMcpNotification` from `../src/mcp/notifications.ts` | Same |
| `.gitignore` | Added `/issues.jsonl` | bd auto-export artefact at repo root; canonical state lives in `.beads/issues.jsonl` |

## Decisions Made

| Decision | Options Considered | Rationale |
|----------|-------------------|-----------|
| Tests import from new module paths | (A) keep shim imports (B) follow new structure | Chose B: tests should reflect honest structure. Shims remain only for `bin/`, README, and external consumers. |
| MCP server stays factory-closure, not a class | (A) factory + ToolContext (B) class `McpAdapter` | Chose A: smallest behavioral surface change. Class refactor is a separate concern, not a code-move. |
| `import.meta.main` guard on CLI | (A) add guard now (B) keep side-effect import | Chose A: makes `src/cli/index.ts` testable in isolation; `bin/synchronize` updated to call `main()` explicitly. |
| Stdio-main duplication left in place | (A) collapse now (B) defer to separate bead | Chose B: not in scope for a code-move PR. Filed as `sync-x9p`. |
| Skip the pre-refactor manual baseline | (A) run baseline first (B) skip; single end-of-refactor manual smoke | Chose B per user direction. Closed `sync-mkj.1` with that reason. |
| No daemon split in this PR | (A) ship everything (B) ship adapters first | Chose B per epic's own ordering: "Daemon split should happen after API/CLI/MCP adapter splits so behavioral surface is already stable." |
| Squash merge | (A) squash (B) merge-commit (C) ff | Chose A per user direction. Six fine-grained commits collapsed into one on master. |

## Pending Work

## Immediate Next Steps

1. **Claim `sync-mkj.9`** (daemon module boundary design): `bd update sync-mkj.9 --claim`. Read `src/daemon.ts` end-to-end, write down the boundary plan in the bead's `--design` field before touching code. Likely target layout (subject to revision once you read the actual code):
   ```
   src/daemon/
     index.ts                    ← createDaemonServer factory
     server.ts                   ← Bun.serve setup, lifecycle
     routes/
       status.ts                 ← /status, /summary, /health
       peers.ts                  ← /peers, /peers/register, /peers/:id/heartbeat, /peers/:id (DELETE)
       inbox.ts                  ← /peers/:id/inbox, /peers/:id/inbox/ack, /dm
       events.ts                 ← /events/:peer_id, /subscriptions
       groups.ts                 ← /groups, /groups/:name/{join,leave,messages,history}
       media.ts                  ← /groups/:name/media, /media/:id
     validation.ts               ← request body schema helpers
     repository/
       peers.ts                  ← DB CRUD for peers
       events.ts                 ← DB CRUD for events + inbox
       groups.ts                 ← DB CRUD for groups + members
       media.ts                  ← MediaStore filesystem + DB
     subscriptions.ts            ← Claude callback fanout (HTTP POST out)
   src/daemon.ts                 ← compat shim: re-export createDaemonServer; run server under import.meta.main
   ```
2. **Open follow-up PR scoped to phase 2.** Use the same worktree pattern: `wt switch --create refactor/sync-mkj-daemon-split`. Worktrunk lands it at `~/Codes/worktrees/synchronize/refactor-sync-mkj-daemon-split` per `~/.config/worktrunk/config.toml`.
3. **Sequence the commits same way phase 1 did** — one bead per commit so review is digestible. Order: design (`.9` notes only) → routes split (`.10`) → repository/media/subscription split (`.11`) → final verification (`.8`).
4. **Run the verification gate after every commit**:
   ```
   bun run typecheck
   bun test
   bun test tests/mcp-e2e.test.ts
   ```
5. **Remind the user about the still-owed manual multi-agent smoke** for phase 1 (Claude MCP + Codex MCP + CLI exercising register, dm, inbox, group send, group history, media share, Claude channel notifications, Codex logging notifications). Phase 1 is technically merged but the user agreed to run this single consolidated check; do it before phase 2 picks up momentum so any phase-1 behavior regression isn't entangled with phase-2 changes.
6. **After phase 2 lands, file the consolidated Codex audit again** (`codex:rescue` subagent) scoped to the phase-2 diff before merging.

### Blockers/Open Questions

- [ ] **`sync-mkj.8`** (final epic verification) is blocked by `.11`. Don't claim until `.9`/`.10`/`.11` all close.
- [ ] **`sync-mkj` parent epic** stays open until `.8`, `.9`, `.10`, `.11` all close.
- [ ] Is there logic in `daemon.ts` that should NOT live in the daemon (e.g. anything that should be moved to `src/api/` types or `src/db.ts`)? Decide during `.9` design.
- [ ] How aggressively to refactor request body validation. Currently it's ad-hoc in `daemon.ts`. Two options surface in the epic notes: keep ad-hoc validation per route, or introduce zod schemas mirroring `src/mcp/tools/*` patterns. The epic does NOT mandate zod here. Prefer the minimal code-move approach unless validation is currently broken.

### Deferred Items

Tracked as separate beads, NOT in scope for phase 2 unless they trivially fall out of it:
- `sync-x9p`: collapse stdio-main duplication (`src/mcp.ts` `import.meta.main` block ↔ `bin/synchronize-mcp`)
- `sync-6wm`: rewrite `tests/mcp.test.ts` to target MCP public surface instead of `NotificationBridge` internals
- `sync-kii`: centralize URL building in `src/client.ts` or `src/api/url.ts`
- `sync-3wc`: extract repeated zod schema fragments in `src/mcp/tools/*` into a shared schema module

Also tracked:
- `sync-t0p` (P0 bug, **open**): Codex MCP notifications are log-visible but not model-visible. Long pre-existing investigation, not introduced by this refactor. Out of scope but worth knowing about.
- `sync-7fq` (P1 bug, open): preserve tool attribution for MCP registrations. Same — pre-existing, out of scope.

## Context for Resuming Agent

## Important Context

**Phase 1 is locked in on master.** Do not re-litigate the design decisions in the "Decisions Made" table — they were made deliberately and reviewed (the user, Codex, and the plan file all signed off). Phase 2 should follow the same constraints:

1. **Pure refactor only.** No behavior change. No new features. No "while we're here" cleanups outside the scope of the bead you're claiming. If you spot improvements, file a new bead and link it; do NOT smuggle them in.
2. **Compatibility shim is non-negotiable.** `src/daemon.ts` must remain a working entrypoint after phase 2 because `package.json` declares `"daemon": "bun run src/daemon.ts"` and the `Makefile` uses that. Shim must re-export the public factory and keep the `import.meta.main` script behavior.
3. **REST routes byte-identical.** Every endpoint that any function in `src/api/*.ts` calls must exist with the same method, path, request body shape, response body shape, and status codes after the split. The `src/api/` directory is the canonical contract.
4. **No CLI/MCP guardrails leak into the daemon.** Daemon trusts callers (consistent with phase 1 where guardrails stay in `src/cli/identity.ts`).
5. **Verification gate after every commit**, not just the end. Phase 1 caught the missing type re-export *before* merge thanks to Codex; do the same for phase 2.
6. **`bd` for all task tracking.** Do NOT use TodoWrite/TaskCreate. Project CLAUDE.md spells this out. Run `bd ready` to see what's claimable; `bd update <id> --claim` before starting; `bd close <id>` when done.

## Assumptions Made

- Phase-2 verification will run against the *current* `~/.synchronize/synchronize.db` state — which was nuked at end of session (0 peers, 0 events). If the next session starts the daemon and the schema has drifted, run `make daemon-relaunch` again.
- Bun's import resolution behaves the same in fresh worktrees as it did in the refactor worktree (no environment quirks). Confirmed during phase 1 by running tests.
- The user's preference for sequential commits per bead (one commit per phase) will carry forward to phase 2.
- The user will not want a manual baseline before phase 2 either; one consolidated end-of-refactor manual smoke is preferred (this matched the user's stated working style during phase 1).

## Potential Gotchas

1. **`issues.jsonl` at repo root is gitignored now** but `bd` may re-create it. If you `git add -A`, the `.gitignore` rule will keep it out. Don't manually re-track it.
2. **`bun link` global** currently points the global `synchronize` package at the *phase-1 refactor worktree* (`refactor-sync-mkj-modularize-api-cli-mcp`). When you create the phase-2 worktree, you'll likely want to `cd` to it and run `bun link` again to repoint the global. Otherwise `synchronize-mcp` (used by Claude/Codex MCP registration) will continue running phase-1 code instead of your phase-2 work-in-progress.
3. **MCP server is registered in Claude user config** at `~/.claude.json` as `synchronize` with `SYNCHRONIZE_MCP_MODE=claude`, pointing at `$(command -v synchronize-mcp)` → which is the bun-linked global → which is the refactor worktree. Same caveat as above.
4. **gh auth** has two accounts; `dev-abhirup-sc` is active (work), `abhirup-dev` is the personal one that owns this repo. To push or merge via the GitHub API, you must `gh auth switch --user abhirup-dev` first, then switch back. Local git commits already use the correct identity via repo-level `git config user.name "Abhirup Das"` / `user.email "abhidash@outlook.com"`.
5. **`tests/messaging.test.ts`, `tests/health.test.ts`, `tests/mcp-e2e.test.ts`** spawn `src/cli.ts` and `src/mcp.ts` as subprocesses. They go through the compat shims. Don't remove the shims.
6. **`SYNCHRONIZE_HOME`** env var picks the runtime dir. Tests use throwaway `mkdtemp` dirs. Default is `~/.synchronize`. Useful for sandbox testing without touching the live daemon.
7. **Claude channel notification surfacing** requires launching claude with `cch synchronize` (the new shell function in `~/.config/rc/functions.sh`) — otherwise the `notifications/claude/channel` payloads arrive at the protocol layer but the UI ignores them.
8. **Daemon picks a random free port** on startup; URL lives in `~/.synchronize/daemon.json`. CLI/MCP/test code discovers it via `jq -r .baseUrl ~/.synchronize/daemon.json` or via `src/client.ts`'s `ensureDaemon()`.

## Environment State

### Tools/Services Used

- **bun** (`1.3.10`) — TypeScript/JS runtime. All `bun run`, `bun test`, `bun install`, `bun link` commands work as documented in README.
- **bd / beads** — issue tracker. Project uses this for all task state. `bd prime` to bootstrap a session, `bd ready` to find work.
- **gh** — GitHub CLI. Two accounts logged in (see Potential Gotchas #4).
- **wt / worktrunk** — git worktree manager. User config at `~/.config/worktrunk/config.toml` puts worktrees at `~/Codes/worktrees/{{ repo }}/{{ branch | sanitize }}`.
- **Codex (`codex:codex-rescue` subagent)** — used for the PR-diff audit. Reachable via `Agent` tool with `subagent_type: "codex:codex-rescue"`. Caught one real defect in phase 1.

### Active Processes

- **Synchronize daemon**: PID **99232** on port **58931**, started 2026-05-19 21:57. Running from the refactor worktree's source via `bun link` global. `~/.synchronize/` is clean (0 peers / 0 events / 0 groups). To stop: `make daemon-kill` from any synchronize worktree. To restart fresh: `make daemon-relaunch`.

### Environment Variables

- `SYNCHRONIZE_HOME` — runtime dir (default `~/.synchronize`)
- `SYNCHRONIZE_BIND` — daemon bind host (default `127.0.0.1`)
- `SYNCHRONIZE_PORT` — daemon port (default `0`, random)
- `SYNCHRONIZE_TOKEN` — auth credential for the daemon; required when bind isn't localhost
- `SYNCHRONIZE_MCP_MODE` — `codex` (default) or `claude`. Picks notification mode in `src/mcp/state.ts:getMode()`.
- `CLAUDE_CODE_REMOTE_SETTINGS_PATH` — exported globally from `~/.zshrc:239`. Prevents Claude Code from overwriting `remote-settings.json`. Not directly relevant to synchronize work but explains why several wrapper scripts redundantly re-export it.

### Out-of-Repo Side Cleanups Done This Session

1. **`bun link` repointed** from old `sync-6h3-rest-client` worktree to refactor worktree.
2. **Claude MCP entry refreshed** at user scope: `claude mcp add synchronize "$(command -v synchronize-mcp)" --scope user -e SYNCHRONIZE_MCP_MODE=claude`. `claude mcp get synchronize` confirms `Status: ✓ Connected`.
3. **`cch` function added** to `~/.config/rc/functions.sh` (lines below `ccp`). Usage: `cch <channel-name> [claude-args]`. The old `ccp` is unchanged (still pinned to `server:claude-peers`).
4. **Removed** `claudedeck` and `codexdeck` functions from `~/.zshrc` (the user explicitly asked). `lettadeck` kept.
5. **Discussed but did NOT apply**: adding `includeIf "gitdir:~/Codes/Personal/"` to `~/.gitconfig` for automatic per-folder identity switching. The repo-level git config already sets the correct user; only `gh auth` requires manual switching for pushes.

## Related Resources

- **PR (closed by merge)**: https://github.com/abhirup-dev/synchronize/pull/1
- **Closing commit**: `f8b5f24` on master
- **Plan file used during phase 1**: `/Users/abhirupdas/.claude/plans/yeah-make-an-extensive-vivid-boot.md` — keep this for reference; it has the original boundary design and the locked decisions. The plan describes the **same architecture pattern** that phase 2 should follow for `src/daemon.ts`.
- **Epic**: `bd show sync-mkj` (parent), `bd show sync-mkj.9`, `bd show sync-mkj.10`, `bd show sync-mkj.11`, `bd show sync-mkj.8`
- **Refactor worktree** (still on disk): `~/Codes/worktrees/synchronize/refactor-sync-mkj-modularize-api-cli-mcp` — branch `refactor/sync-mkj-modularize-api-cli-mcp`, six pre-squash commits visible there for forensic detail. Safe to delete via `wt remove` or `git worktree remove` + `git branch -D` once you're sure you don't need to inspect the unsquashed history.
- **README "Fresh Manual Test Setup"** section: the canonical multi-agent verification recipe (lines ~423–447 of README.md). Use it for the still-owed phase-1 smoke and for the phase-2 final verification.
- **Project CLAUDE.md**: spells out `bd`-only task tracking, session close protocol (always `git push` before declaring done), no `TodoWrite`/`TaskCreate`/`MEMORY.md` files.

---

**Security Reminder**: No secrets included. Token references mention only the existence of `GH_TOKEN`-style env vars or keychain entries, never values.
