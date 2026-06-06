# Handoff: Pi + Claude AOE archive/resume harness, durable-resume product fix, AOE-quirk workarounds

## Session Metadata
- Created: 2026-06-06 21:09:20
- Project: /Users/abhirupdas/Codes/Personal/synchronize-worktrees/resumable-archives-plan
- Branch: codex/resumable-archives-plan
- Session duration: very long (multi-hour marathon)

### Recent Commits (for context)
  - db051d7 test(harness): add Claude support to the Python AOE archive/resume cognition test (sync-ocdt.4)
  - 69d1fb7 fix(launch): make daemon-launched Claude resumable under AOE (sh -c wrap + no alt-screen + no --effort)
  - f8f9356 test(harness): Pi cognition archive→resume recall scenario (sync-ocdt.5)
  - 0681164 fix(resume): persist resume target so the durable launch worker resumes faithfully
  - 64259b4 test(harness): add minimal SYNCHRONIZE_AOE_KEEP flag (mirror of Python --keep)
  - (earlier this session) ac37253 / later: extract shared startDaemon + AOE helpers; 3fdb001 7-case Pi harness; 3 commits for the refactor.

## Handoff Chain

- **Continues from**: [2026-05-31-104015-claude-launch-lifecycle-stress-test.md](./2026-05-31-104015-claude-launch-lifecycle-stress-test.md)
- **Supersedes**: None

## Current State Summary

This session delivered, end to end and verified live, **faithful archive→resume for BOTH Pi and Claude agents** under the AOE/tmux backend, plus two real product bug fixes that made resume actually work. All work is committed and pushed on `codex/resumable-archives-plan`. The branch is clean, the full default test suite is green (255 pass / 9 skip / 0 fail), typecheck is clean, and there are zero orphaned tmux sessions / AOE profiles. The headline proof: a real Pi agent and a real Claude (Haiku 4.5) agent each memorize a codeword, are archived, resumed by the daemon, and **recall the codeword** — proving the resumed process is alive AND retained its pre-archive context. The next highest-value work is the two remaining P1 Pi phases: `sync-ocdt.2` (durable catch-up on resume) and `sync-ocdt.3` (real-sweeper GC-exemption).

## Codebase Understanding

## Architecture Overview

- `synchronize` is a local-first messaging bus; one Bun daemon (`src/daemon.ts`, SQLite WAL) owns durable state; thin CLI/MCP clients talk to it over localhost REST.
- **Two test harnesses for live agents:**
  1. **TypeScript / bun** (`tests/*.test.ts`, gated by `SYNCHRONIZE_AOE_HARNESS=1`): API-driven — launches real agents via the daemon, but drives messaging through the daemon REST API (deterministic; does NOT depend on agent cognition). Shared helpers in `tests/support/`.
  2. **Python / uv** (`scripts/integration_*.py` → `scripts/integration-aoe/sync_itest_aoe/`): cognition-driven — launches real agents via `aoe` directly and prompts them via tmux send-keys, waiting for marker replies. This is where the archive/resume RECALL test lives.
- **Launch lifecycle:** `src/launch/service.ts` (`LaunchService.launch` → durable mode records a launch_intent + enqueues `spawn` work; the worker respawns via `specFromRow`). `src/launch/build.ts` builds the agent command (`buildAgentCommand` / `buildAgentResumeCommand`). `src/launch/backend.ts` `AoeBackend` shells out to `aoe`. `SessionBackend` interface is pluggable (relevant to `sync-5h10`).
- **Resume command shape:** Pi → `pi --session <id|file>`; Claude → `claude --resume <id>`; NEVER `--fork-session`.

## Critical Files

| File | Purpose | Relevance |
|------|---------|-----------|
| `src/launch/service.ts` | LaunchService, `resolveLaunchSpec`, `specFromRow`, `forceClaudeLaunchDefaults`, `provisionPiLaunchRuntime` | The durable-resume fix + claude env (CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN) + no-`--effort` live here |
| `src/launch/backend.ts` | `AoeBackend`, `buildCmdOverride` (now has `wrapExec` for claude) | The `sh -c`/`exec` wrapper that absorbs AOE's injected `--session-id` |
| `src/launch/build.ts` | `buildAgentResumeCommand` (tool-adaptive) | claude=`--resume`, pi=`--session` |
| `src/launch/store.ts` | `launch_intents` row + `createLaunchIntent` | Now persists `resume_host_session_id`/`resume_host_session_file` |
| `src/db.ts` | migrations (now v13) | v13 added the resume-target columns |
| `tests/support/daemon.ts` | shared `startDaemon` + `cleanupDaemonHomes` | Extracted from ~11 duplicated copies |
| `tests/support/aoe-harness.ts` | shared live-harness helpers (launchPi, waits, fanout, reap, `SYNCHRONIZE_AOE_KEEP`, deletes owned AOE profile) | Reused across TS harness files |
| `tests/archive-resume-harness.test.ts` | 7-case Pi archive/resume scenarios | sync-ocdt.1 |
| `tests/aoe-baton-harness.test.ts` | 3-agent thread-baton relay (API-driven) | reuses shared helpers from a 2nd file |
| `scripts/integration-aoe/sync_itest_aoe/scenarios/pi_mcp_archive_resume.py` | cognition archive→resume recall (tool-parametric pi/claude) | sync-ocdt.5 + Claude (sync-ocdt.4) |
| `scripts/integration-aoe/sync_itest_aoe/claude_env.py` | Claude launch env (global OAuth, isolated hooks+MCP, haiku, alt-screen off) | NEW |
| `scripts/integration_archive_resume_pi.py` | entry point for the above | run with `uv run` |

## Key Patterns Discovered

- **Pi resume needs the transcript where the daemon looks.** The daemon's `provisionPiLaunchRuntime` always sets `PI_CODING_AGENT_SESSION_DIR = <sync_home>/pi-sessions` (NOT keyed by peer). The Python harness was writing transcripts to `run_dir/pi-sessions`; fixed by aligning `self.pi_sessions = self.sync_home / "pi-sessions"` in `pi_mcp_dm.py`. In a global install there is one PI home so this is a non-issue.
- **Claude resume uses global `~/.claude`** (OAuth/keychain — copying auth.json is insufficient). Both the original launch and the daemon's resume read transcripts from `~/.claude/projects/<cwd-hash>/<id>.jsonl`, so there is NO session-dir mismatch like Pi. Resume MUST run in the same cwd (daemon preserves it).
- **AOE injects `--session-id` for the claude binary** → collides with `claude --resume`. See Gotchas + the fix.
- **The TS AOE harness is API-driven, NOT cognition.** Agents live ~5s by design (the test reaps them in `finally`); proof of real launch = daemon log line `agent session registered host_tool=pi host_session_id=019e...`.

## Work Completed

## Tasks Finished

- [x] **sync-ocdt.1** — 7 focused Pi archive/resume harnessTests (DM survive resume, group fanout exclude/restore, group archive/resume per-member, reserved-alias block + alias_archived warn, idempotency guards, two-cycle stability). Live green.
- [x] **Shared test-helper refactor** — extracted `startDaemon` (~11 dup copies) → `tests/support/daemon.ts`; live-harness helpers → `tests/support/aoe-harness.ts`. Codex-reviewed; fixed a temp-repo cleanup leak Codex caught. Pure refactor, suite identical.
- [x] **AOE profile-leak fix (harness side)** — each isolated daemon makes a `synchronize-<hash(home)>` AOE profile; harness `cleanup()` now deletes it. Wiped 33 leaked profiles + reset the real daemon (`make clean-slate`).
- [x] **3-agent thread-baton relay test** (`tests/aoe-baton-harness.test.ts`) — proves shared helpers reusable from a 2nd file.
- [x] **`SYNCHRONIZE_AOE_KEEP=1`** flag (mirror of Python `--keep`).
- [x] **sync-ocdt.7 / durable-resume PRODUCT BUG fix** (`0681164`) — the durable launch worker (`specFromRow`) rebuilt the spawn WITHOUT the resume target, so every daemon-mode resume forked a fresh session. Added `resume_host_session_id`/`resume_host_session_file` to `launch_intents` (db v13), persist on resume, reconstruct in `specFromRow` (only when present → fresh launches stay fresh).
- [x] **sync-ocdt.5 / Pi cognition recall** (`f8f9356`) — memorize→archive→resume→recall. Found + fixed the Pi session-dir mismatch + the rediscover-dead-pane bug.
- [x] **Claude resume PRODUCT FIX** (`69d1fb7`) + **Claude harness** (`db051d7`) — see Decisions. Verified live (Haiku 4.5 recall).
- [x] Filed `sync-5h10` (non-AOE/raw-tmux backend).

## Files Modified (committed)
- Product: `src/launch/backend.ts`, `src/launch/service.ts`, `src/launch/store.ts`, `src/db.ts`
- Tests: `tests/aoe-backend.test.ts`, `tests/launch-service.test.ts`, `tests/archive-resume-harness.test.ts`, `tests/archive-resume.test.ts`, `tests/archive-routes.test.ts`, `tests/list-my-groups.test.ts`, `tests/peer-revival.test.ts`, `tests/presence.test.ts`, `tests/mcp.test.ts`, `tests/launch-route.test.ts`, `tests/summary.test.ts`, `tests/api.test.ts`, `tests/messaging.test.ts`, `tests/aoe-baton-harness.test.ts`, `tests/support/daemon.ts`, `tests/support/aoe-harness.ts`
- Python harness: `scripts/integration-aoe/sync_itest_aoe/claude_env.py` (new), `scripts/integration-aoe/sync_itest_aoe/scenarios/pi_mcp_archive_resume.py`, `scripts/integration-aoe/sync_itest_aoe/scenarios/pi_mcp_dm.py`, `scripts/integration-aoe/sync_itest_aoe/sync_rest.py`, `scripts/integration_archive_resume_pi.py` (new)

## Decisions Made

| Decision | Options Considered | Rationale |
|----------|-------------------|-----------|
| Persist resume target on `launch_intents` (db v13) | re-derive from agent_sessions binding; in-memory map | A retried *fresh* launch also has a binding, so "binding exists" would wrongly resume it. Explicit recorded intent is the only respawn-safe signal. |
| Claude: `sh -c 'exec … claude --resume …' aoe-claude-wrap` via `--cmd-override` | custom-agent config; `--fork-session`; `--no-cockpit` | AOE injects `--session-id` for the claude binary (conflicts with `--resume`). Custom agents get re-templated (AOE detected "claude" → Opus/auto-mode). `--no-cockpit` didn't help. The wrapper makes the launched binary `sh` so AOE's `--session-id` lands as an ignored positional arg; `exec` keeps claude the direct PTY process (TTY/signal-clean — web-confirmed). |
| `CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1` for daemon claude launches | none viable otherwise | Dev-channel confirm prompt renders inline so AOE's capture-pane auto-confirm can dismiss it (fixes "prompt confirmation attempts exhausted"). |
| Drop `--effort` from claude launch defaults | keep it | Per user; pin `--model` only. |
| Claude harness uses GLOBAL `~/.claude` (OAuth) + isolated hooks/MCP | isolated CLAUDE_CONFIG_DIR | Claude needs keychain OAuth; copying auth.json is insufficient. Isolate via `--setting-sources local` + `--settings` (hooks) + `--mcp-config --strict-mcp-config`. |
| Map Claude registration by `session_name` | by pinned `--session-id` | Claude assigns its own host_session_id; we pass SYNCHRONIZE_SESSION_NAME and map on that. |

## Pending Work

## Immediate Next Steps

1. **`sync-ocdt.2` (P1) — durable catch-up on resume.** A DM sent to a peer while it is archived should be delivered (from the durable inbox) after it resumes. Pure-Pi, deterministic, unblocked. Add as a new gated harnessTest reusing `tests/support/aoe-harness.ts`.
2. **`sync-ocdt.3` (P1) — real-sweeper GC-exemption.** With tiny `SYNCHRONIZE_PEER_RETENTION_MS`/`SYNCHRONIZE_SWEEP_INTERVAL_MS`, an archived peer survives the retention sweep while an idle non-archived peer is swept. Pure-Pi, deterministic.
3. (P2) `sync-weua` product-side: archive/stop should remove the AOE session from its group + prune empty AOE groups (harness side already fixed).

## Blockers/Open Questions
- None blocking. `sync-ocdt.4` (Claude in the *full multi-phase* mega-scenario) is dependency-gated on `.2`/`.3`; its CORE (Claude recall) is already done + verified.

## Deferred Items
- `sync-qqef` auto-archive epic (`.1`/`.2`) — user deferred earlier.
- `sync-ocdt.6` Pi extension registering `host_session_file` — robustness only; not required after the session-dir alignment.
- `sync-rrgv` — `bridge_stop` fails for `tool='claude-code'`.
- `sync-fi2m` — no group deletion in v0.

## Context for Resuming Agent

## Important Context

- **Run the harnesses (gated, spawn real agents):**
  - TS Pi: `SYNCHRONIZE_AOE_HARNESS=1 bun test tests/archive-resume-harness.test.ts` (add `SYNCHRONIZE_AOE_KEEP=1` to leave agents alive for inspection).
  - Python Pi recall: `uv run scripts/integration_archive_resume_pi.py --tool pi`
  - Python Claude recall: `uv run scripts/integration_archive_resume_pi.py --tool claude` (Haiku 4.5; use `--launch-only` to validate launch+dismiss+register+warmup only; `--keep` to preserve state; tune `--pre-archive-wait`/`--post-archive-wait`/`--warmup-timeout`/`--command-timeout`).
- **ALL Claude test runs must use Haiku 4.5** (cheapest) — `claude_env.DEFAULT_CLAUDE_MODEL = "haiku"`; the harness defaults to it for `--tool claude`.
- **Cleanup after live runs is mandatory.** Reap any leftover: `tmux kill-session` for `aoe_*-arpi-1_*` (and pi names), and `printf 'y\n' | aoe profile delete synchronize-<hash>` for any leftover `synchronize-*` profiles. `make clean-slate` resets the real daemon (kills + `aoe-teardown` + rm `~/.synchronize`); `make daemon-relaunch` starts fresh. The harnesses self-clean now, but a crashed run can leave a daemon-minted resume profile/pane.
- **Proof of faithful resume = the agent RECALLS a pre-archive codeword** (cognition), not just delivery. The recall marker is novel text so it can't match the rehydrated transcript.

## Assumptions Made
- macOS, `~/.claude/.credentials.json` present (OAuth). `uv`, `pi`, `aoe` (v1.7.1), `tmux`, `bun` installed.
- The user is OK with the Claude harness polluting global `~/.claude/projects` (intended — global OAuth path).

## Potential Gotchas
- **AOE re-templates any command it detects as `claude`** (custom-agent config is a dead end). Only the `sh -c`/`exec` wrapper via `--cmd-override` gives verbatim command control. Pi is NOT wrapped (no dev-channel/session-id issue).
- **Claude assigns its session id on first message historically**, but the SessionStart hook registers an id at startup; our tests always send ≥1 message before archive, and the daemon resumes by whatever the binding recorded — works in practice on Claude v2.1.167. Do NOT use zero-message sessions.
- **`pi --session <id>` resolves by id only if `PI_CODING_AGENT_SESSION_DIR` matches** between original launch and daemon resume.
- **The durable launch worker** (`specFromRow`) is what actually spawns in daemon mode — any new launch field must be persisted on `launch_intents` and reconstructed there, or it's silently dropped on (re)spawn.
- **Don't trust a background bash "exit 0"** when the command is `<cmd>; echo`; check the captured EXIT inside.

## Tools/Services Used
- `bun` (tests, daemon, typecheck), `uv` (Python harness), `aoe` v1.7.1 (tmux session manager — config at `~/.agent-of-empires/`), `tmux`, `bd` (beads, issue tracking), Codex rescue agent (reviewed the refactor).

## Active Processes
- None left running by this session (verified 0 orphaned `aoe_*` tmux sessions, only `default` AOE profile). The user's real synchronize daemon (`~/.synchronize`) was reset via `make clean-slate` + relaunched fresh mid-session.

## Environment Variables (names only)
- `SYNCHRONIZE_AOE_HARNESS`, `SYNCHRONIZE_AOE_KEEP`, `SYNCHRONIZE_HOME`, `SYNCHRONIZE_DEBUG`, `SYNCHRONIZE_HOOK_ENABLE`, `SYNCHRONIZE_CLI`, `SYNCHRONIZE_MCP`, `SYNCHRONIZE_SESSION_NAME`, `SYNCHRONIZE_PEER_ID`, `SYNCHRONIZE_LAUNCH_ID`, `PI_CODING_AGENT_DIR`, `PI_CODING_AGENT_SESSION_DIR`, `CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN`, `SYNCHRONIZE_PEER_RETENTION_MS`, `SYNCHRONIZE_SWEEP_INTERVAL_MS`.

## Related Resources
- Plan: `docs/plans/resumable-archived-sessions.md` (§9.4 describes the sync-ocdt epic).
- bd issues: `sync-ocdt` (epic + .2/.3/.4/.6), `sync-qqef` (auto-archive), `sync-5h10` (non-AOE backends), `sync-weua` (AOE leak), `sync-fi2m` (group deletion), `sync-rrgv` (bridge_stop claude-code).
- bd memories: `aoe-claude-launch-session-id-conflict`, `aoe-vs-synchronize-groups-and-harness-cleanup`, `aoe-harness-verified-2026-06-06-host-session`, `for-pi-interactive-sessions-under-tmux-aoe-submitting`.
- AOE docs: https://www.agent-of-empires.com/docs/guides/configuration/ (custom agents), /docs/cli/reference/.

---

**Security Reminder**: No secrets included (env var names only).
