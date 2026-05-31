# Handoff: Claude Launch Lifecycle Stress Test

## Session Metadata
- Created: 2026-05-31 10:40:15 IST
- Project: /Users/abhirupdas/Codes/Personal/synchronize
- Branch: master
- Session duration: multi-hour live debugging and UI/runtime validation
- Beads issue: sync-6wlv, "Characterize and harden Claude launch lifecycle under concurrency"

### Recent Commits
- a38972f Close spawn model selection bead
- c01559e Add spawn form model selection
- 9637962 Prepare thread summaries and AOE attach UI
- 92876b2 feat(web): Thread Summary panel + Kanban Board, wired to daemon summaries
- 7f26205 feat(summaries): LLM-generated thread summaries (sync-b8q)

## Handoff Chain

- Continues from: None. This handoff is for the Claude/Pi spawn-form and Claude launch lifecycle work done after the prior SQL event query handoff.
- Supersedes: None.

## Current State Summary

The spawn form model picker work was implemented and pushed in commits c01559e and a38972f. Follow-up live testing against the preserved daemon at http://127.0.0.1:55244 exposed a separate reliability problem in the Claude launch lifecycle: prompt auto-accept and AOE spawn can succeed partially, but launch registration and group auto-join are not reliable under slow startup, stale peer state, or concurrent launches. A Beads bug, sync-6wlv, now captures the follow-up work. No durable code fix has been landed for the lifecycle issue yet; the local experimental backend changes tried during diagnosis should not be kept as the final fix.

## Codebase Understanding

## Architecture Overview

- The web spawn form calls `DaemonClient.spawnAgent` in `web/src/data/daemon.ts`, which posts to `/agent-sessions/launch`.
- The daemon route delegates to `LaunchService.launch` in `src/launch/service.ts`.
- `LaunchService` mints `launchId` and `peerId`, resolves the command/model/thinking flags, stores a pending launch in memory, and calls the configured backend.
- The AOE backend in `src/launch/backend.ts` creates an AOE session, starts the tmux-backed command, and best-effort dismisses Claude's development-channel confirmation prompt.
- The launched agent registers later through the normal SessionStart/MCP path. Registration writes `agent_sessions.launch_id`, then `reconcileLaunch` is supposed to consume the pending in-memory launch intent and add the alias to the target group.
- The brittle point is the gap between "HTTP launch request accepted" and "later agent registration reconciles." The launch intent is memory-local and the HTTP request currently waits on too much launch work.

## Critical Files

| File | Purpose | Relevance |
|------|---------|-----------|
| `web/src/components/SpawnAgentDialog.tsx` | Spawn form UI | Contains runtime/model radio button UI and group-scoped alias validation. |
| `web/src/data/daemon.ts` | Browser data client | Sends `{ tool, name, repo, group, model, thinking }` to `/agent-sessions/launch`. |
| `src/launch/service.ts` | Launch request resolution and pending intent tracking | Hard-coded launch models, thinking levels, pending in-memory launches, AOE title derivation. |
| `src/launch/backend.ts` | AOE/tmux backend | Starts AOE sessions and auto-confirms Claude dev-channel prompt. |
| `src/api/agent-sessions.ts` | Registration and launch reconciliation path | SessionStart registration and `reconcileLaunch` are where auto-join should happen. |
| `tests/launch-reconcile.test.ts` | Reconcile contract tests | Proves the in-memory happy path, but not delayed/timeout/restart behavior. |
| `tests/aoe-backend.test.ts` | AOE backend tests | Covers tmux/AOE command behavior and prompt auto-confirm mechanics. |
| `.beads/issues.jsonl` | Beads database | Contains sync-6wlv with the long-form follow-up issue. |

## Key Patterns Discovered

- Group aliases are unique per group. The spawn form should enforce this before calling launch; the daemon still needs to enforce the contract.
- Daemon-managed AOE launches are intentionally not foreground CLI launches. They own provider/model/thinking arguments so callers cannot pass conflicting flags.
- Claude launches need `--dangerously-load-development-channels`, which triggers a local-development confirmation prompt. The backend auto-accepts this prompt by inspecting the tmux pane and sending Enter/C-m.
- AOE titles are derived from launch state and group membership. If a launched peer registers but never joins the target group, later UI attach/title behavior can look inconsistent because title derivation sees the current failed state, not the original launch intent.
- `LaunchService` explicitly documents that there is no durable launch table. That design is likely the root limitation for delayed registration and HTTP timeout cases.

## Work Completed

### Tasks Finished

- Implemented richer spawn UI with runtime and model choices for Claude and Pi.
- Verified full model names locally and hard-coded them for the first version:
  - Claude Sonnet: `claude-sonnet-4-6-20251114`, thinking `medium`
  - Claude Haiku: `claude-haiku-4-5-20251001`, thinking `high`
  - Claude Opus: `claude-opus-4-8`, thinking `medium`
  - Pi 5.5 high/medium/low: `gpt-5.5` with corresponding thinking mode
  - Pi 5.4 mini: `gpt-5.4-mini`, thinking `high`
- Added initial best-effort Claude dev-channel prompt auto-accept behavior.
- Tested spawning through the web UI and direct `/agent-sessions/launch` calls against the preserved daemon.
- Created Beads issue sync-6wlv with the observed failure modes and follow-up test plan.

## Files Modified

| File | Changes | Rationale |
|------|---------|-----------|
| `.beads/issues.jsonl` | Added sync-6wlv. | Preserve the observed launch lifecycle bugs and stress-test plan for later work. |
| `.claude/handoffs/2026-05-31-104015-claude-launch-lifecycle-stress-test.md` | This handoff. | Preserve exact runtime coordinates, commands, observations, and hypotheses. |

### Experimental Changes Tried But Not Kept

During live diagnosis, I temporarily changed `src/launch/backend.ts` and `tests/aoe-backend.test.ts`. These edits should be treated as scratch evidence, not the chosen fix:

- Made `spawn` await a short bounded `autoConfirmDevChannelPrompt` before returning, then fall back to the older background prompt confirmation if it failed.
- Changed `autoConfirmDevChannelPrompt` to return `boolean` and accept `{ attempts, intervalMs }`.
- Made `tmuxSessionFor` first resolve a unique `aoe_${title}_...` tmux session prefix before asking `aoe list --json`.
- Added tests for bounded pre-return prompt confirmation and unique tmux title-prefix resolution.

Why this was not kept:

- Waiting inline improves prompt acceptance for some sequential launches, but it worsens the core architectural smell: the HTTP launch request remains coupled to slow Claude/tmux startup and can still hit Bun request timeouts.
- It does not address the durable correctness problem where a registered `agent_sessions.launch_id` can exist without the target `group_members` row.
- The likely fix needs a durable launch lifecycle and background worker semantics, not just more prompt retries.

## Decisions Made

| Decision | Options Considered | Rationale |
|----------|-------------------|-----------|
| Track the lifecycle issue as a separate Beads bug. | Fold it into spawn-form UI work, or create a focused bug. | The UI/model work is complete; the discovered problem is deeper daemon/AOE lifecycle behavior. |
| Treat five parallel Claude launches as stress/limitation testing. | Make five parallel success an immediate acceptance requirement. | Parallel launches surfaced useful constraints, but sequential and three-at-a-time baselines are needed before choosing a fix. |
| Prefer durable launch lifecycle design over more inline waiting. | Increase prompt wait, increase Bun idle timeout, or make launch durable. | Timeouts are symptoms. Correctness should not depend on a single in-memory pending map surviving until registration. |
| Leave experimental code uncommitted. | Commit prompt-wait changes now or revert them. | The scratch patch helped characterize timing but is not a complete fix. |

## Exact Runtime Workflows Used

### Preserved Daemon Coordinates

- Web URL: http://127.0.0.1:55244/web
- Base URL: http://127.0.0.1:55244
- Runtime state: `/tmp/synchronize-sql-live.ULORGu`
- Important: use `env -u SYNCHRONIZE_LEASE_MS` when restarting this daemon. A previous long lease made stale peers appear online for too long.

### Relaunch Same Runtime

```bash
tmux kill-session -t sync-dev-55244
tmux new-session -d -s sync-dev-55244 -c /Users/abhirupdas/Codes/Personal/synchronize 'env -u SYNCHRONIZE_LEASE_MS SYNCHRONIZE_HOME=/tmp/synchronize-sql-live.ULORGu SYNCHRONIZE_PORT=55244 bun run src/daemon.ts'
curl -sS http://127.0.0.1:55244/status | jq '{ok,pid,dirty:.provenance.git_dirty,sha:.provenance.git_sha}'
```

Use this only when you intentionally want to keep the same live state. For isolated tests, use a throwaway `SYNCHRONIZE_HOME`.

### Direct Claude Launch API

```bash
curl -sS -X POST http://127.0.0.1:55244/agent-sessions/launch \
  -H 'content-type: application/json' \
  --data '{
    "tool": "claude",
    "name": "cl-seq-1",
    "repo": "/Users/abhirupdas/Codes/Personal/synchronize",
    "group": "release-checks",
    "model": "claude-haiku-4-5-20251001",
    "thinking": "high"
  }' | jq
```

Fields to record from the response: HTTP status, `launchId`, `peerId`, `sessionName`, `title`, `group`, `pendingCount`, and `warning`.

### Inspect Web State

```bash
curl -sS http://127.0.0.1:55244/web/state | jq '.groups[] | select(.name=="release-checks")'
curl -sS http://127.0.0.1:55244/web/state | jq '.agent_sessions[] | select(.session_name|test("^cl-"))'
curl -sS http://127.0.0.1:55244/web/state | jq '.peers[] | select(.alias|test("^cl-"))'
```

Expected success signature: the launched alias appears as a peer, has an `agent_sessions.launch_id` matching the launch response, and appears in the target group's membership.

### Inspect SQLite State

```bash
sqlite3 /tmp/synchronize-sql-live.ULORGu/synchronize.db \
  "select peer_id, session_name, launch_id, status from agent_sessions where session_name like 'cl-%' order by created_at;"

sqlite3 /tmp/synchronize-sql-live.ULORGu/synchronize.db \
  "select group_name, alias, peer_id from group_members where alias like 'cl-%' order by group_name, alias;"

sqlite3 /tmp/synchronize-sql-live.ULORGu/synchronize.db \
  "select peer_id, alias, status, last_seen_at from peers where alias like 'cl-%' order by alias;"
```

Failure signature seen: `agent_sessions.launch_id` exists and matches the launch response, but `group_members` has no row for the alias.

### Inspect AOE And Tmux

```bash
aoe -p synchronize-bdb55d16 list --json | jq
tmux list-sessions -F '#{session_name}'
tmux capture-pane -p -J -S -160 -t '<pane-or-session-target>'
```

For a stuck Claude launch, the pane may show the development-channel confirmation prompt:

```text
I am using this for local development
Enter to confirm
```

Manual prompt confirmation test:

```bash
tmux send-keys -t '<pane-or-session-target>' Enter
tmux send-keys -t '<pane-or-session-target>' C-m
```

### Cleanup Commands Used During Diagnosis

```bash
aoe -p synchronize-bdb55d16 list --json
aoe -p synchronize-bdb55d16 remove --force '<title-or-id>'
```

Be careful: removing AOE sessions directly can leave stale peer rows if the daemon does not observe the stop path. That exact behavior explained why `cl-ui-vf2` still appeared working/online in the UI after its live AOE/tmux session was gone.

## Observed Behavior

- `cl-ui-vf2` appeared online/working/initializing even though no live AOE/tmux session existed. This was stale daemon peer state after the AOE session was removed outside `/agent-sessions/stop`, compounded by a prior long `SYNCHRONIZE_LEASE_MS`.
- Five parallel Claude launches were too aggressive for the current implementation. Multiple panes stayed at the Claude development-channel prompt. Some got past the prompt but still did not auto-join.
- Sequential launches improved prompt acceptance. `cl-seq-1` and `cl-seq-2` cleared the prompt and created `agent_sessions` rows with the expected `launch_id`, but they still did not join `release-checks`.
- Reconcile failure signature: `agent_sessions.launch_id` was present and matched the launch response, but no `group_members` row was created for the alias.
- Pending launch warning count grew across failures. This should not logically block later consume because consume is keyed by exact `launch_id` and `peer_id`, but it proves pending launch intents were accumulating.
- Bun request timeout appeared during stress runs. Claude prompt rendering plus auto-accept can exceed the default request budget while the AOE session continues in the background.

## Hypotheses To Check

1. The launch contract is too synchronous and memory-local. `/agent-sessions/launch` should not need the prompt acceptance path to complete before returning correctly.
2. `reconcileLaunch` is skipped or misses its pending launch when registration happens after the in-memory pending intent is gone.
3. A daemon restart, request timeout, or interrupted launch path can leave a real agent with `agent_sessions.launch_id` but no durable launch intent to consume.
4. Prompt auto-accept timing varies by Claude startup state. Batch launching increases prompt render latency enough that a fixed short polling window is unreliable.
5. Stale pending launches do not directly block exact-key consume, but their growing count is a lifecycle leak and should be surfaced with age/count diagnostics.
6. Removing AOE directly bypasses daemon cleanup. The UI needs a launched-agent stale state or the stop path needs to reconcile missing backend sessions.
7. Long leases are wrong for launched-agent initialization state. An agent stuck in `initializing` needs its own timeout separate from ordinary peer lease presence.
8. AOE title derivation should not depend only on current group membership for launch-bound peers. A failed auto-join can otherwise make attach commands misleading.

## Pending Work

## Immediate Next Steps

1. Revert any remaining scratch edits in `src/launch/backend.ts` and `tests/aoe-backend.test.ts` before committing this handoff and sync-6wlv.
2. Commit and push `.beads/issues.jsonl` and this handoff.
3. Resume sync-6wlv by adding instrumentation around reconcile, pending launch consume, and prompt confirmer state transitions.
4. Script the sequential, three-at-a-time, and five-parallel launch tests so timings and states are recorded consistently.

### Sequential Five-Agent Test

Launch `cl-seq-1` through `cl-seq-5` one at a time. For each one, wait until success or timeout before launching the next. Record:

- Launch HTTP latency
- Prompt-visible latency
- Prompt-clear latency
- Session registration latency
- Auto-join latency
- Final peer status and activity state

This is the baseline for reliability without concurrency pressure.

### Three-At-A-Time Test

Launch `cl-triple-1` through `cl-triple-3` concurrently or within a one-second window. Validate:

- All three AOE/tmux sessions are created
- All three prompts are cleared
- All three `agent_sessions` rows register with the expected `launch_id`
- All three aliases join `release-checks`
- No misleading pending warning remains after success

### Five-Parallel Stress Test

Launch `cl-batch-1` through `cl-batch-5` concurrently. Treat failure as diagnostic. For each launch, classify the furthest stage reached:

- AOE session created
- tmux pane exists
- Claude prompt visible
- prompt cleared
- SessionStart registered
- reconcile consumed launch intent
- group auto-joined
- UI moved out of initializing/working

## Instrumentation Needed

- Log `reconcileLaunch` entry with `launch_id`, `peer_id`, and session alias.
- Log consume miss reason: missing `launch_id`, pending not found, peer mismatch, no group, or already consumed.
- Log pending launch count and age distribution.
- Log prompt confirmer state transitions: tmux session found, pane found, prompt found, Enter sent, C-m sent, prompt cleared, attempts exhausted.
- Surface launch lifecycle in `/web/state`, ideally with states like `pending_launch`, `prompt_waiting`, `registered_unjoined`, `joined`, `failed`, and `stale`.

## Likely Fix Directions

- Persist launch intents in a durable `launches` table instead of keeping them only in memory.
- Make registration reconcile durable so an agent can auto-join after HTTP timeout, daemon restart, or slow Claude startup.
- Return launch accepted quickly, then run prompt acceptance and lifecycle reconciliation in a background launch worker.
- Increase or configure Bun `idleTimeout` only as mitigation. It should not be the correctness mechanism.
- Add cleanup/repair for launched peers with no live AOE session or no group membership after a timeout.
- Preserve original launch title/group intent so UI attach commands are stable even when current membership is missing.

## Blockers/Open Questions

- What is the exact path that calls `reconcileLaunch` during SessionStart, and does it always run when `agent_sessions.launch_id` is populated?
- Is the pending launch map ever cleared on request cancellation, timeout, daemon restart, or backend throw after AOE has already created a session?
- Should `/agent-sessions/launch` become an asynchronous accepted job endpoint instead of a synchronous spawn endpoint?
- What is the right stale timeout for launched agents stuck in `initializing`?
- Should direct AOE removal be considered unsupported, or should the daemon periodically reconcile backend sessions against peer state?

## Environment State

### Tools/Services Used

- Bun daemon on preserved runtime: http://127.0.0.1:55244
- In-app browser at http://127.0.0.1:55244/web
- `tmux` session name used for daemon: `sync-dev-55244`
- `SYNCHRONIZE_HOME`: `/tmp/synchronize-sql-live.ULORGu`
- AOE profile seen during testing: `synchronize-bdb55d16`
- Beads issue tracker: sync-6wlv

### Active Processes

The preserved daemon may still be running at http://127.0.0.1:55244. Before resuming tests, confirm current process/source state:

```bash
curl -sS http://127.0.0.1:55244/status | jq
tmux list-sessions | rg 'sync-dev-55244|aoe_'
```

If `status.provenance.git_dirty` is true, restart the daemon after committing or reverting local scratch edits.

### Environment Variables

- `SYNCHRONIZE_HOME`
- `SYNCHRONIZE_PORT`
- `SYNCHRONIZE_LEASE_MS`
- `SYNCHRONIZE_MCP_MODE`
- `SYNCHRONIZE_BIND`
- `SYNCHRONIZE_TOKEN` when non-localhost auth is configured

## Related Resources

- Beads issue: sync-6wlv
- Web UI: http://127.0.0.1:55244/web
- Runtime state: `/tmp/synchronize-sql-live.ULORGu`
- Spawn form UI: `web/src/components/SpawnAgentDialog.tsx`
- Launch service: `src/launch/service.ts`
- AOE backend: `src/launch/backend.ts`
- Agent session API: `src/api/agent-sessions.ts`
- Reconcile tests: `tests/launch-reconcile.test.ts`
- AOE backend tests: `tests/aoe-backend.test.ts`

## Security Check Notes

This handoff intentionally includes local paths, localhost URLs, model identifiers, and non-secret environment variable names. It does not include API keys, auth credentials, passwords, or private credentials.

## Important Context

The next agent should start from sync-6wlv, not from the already-pushed spawn-form UI work. The central issue is that live Claude launches can create AOE/tmux sessions and even register `agent_sessions.launch_id`, yet still fail to auto-join the requested group because the launch intent is only in daemon memory. The preserved runtime at `/tmp/synchronize-sql-live.ULORGu` is valuable because it contains the exact stale-peer and failed-launch evidence, but any new correctness test should either clean known `cl-*` aliases carefully or run in a fresh `SYNCHRONIZE_HOME`.

## Assumptions Made

- The user wants the preserved daemon/runtime reused for continuity unless an isolated test explicitly needs a throwaway runtime.
- The model list can stay hard-coded for the current UI milestone; adaptive discovery is future work.
- The scratch backend changes were diagnostic only and should not be merged as the lifecycle fix.
- Sequential reliability should be established before interpreting three-at-a-time or five-parallel failures.

## Potential Gotchas

- Direct `aoe remove` can leave daemon peer state behind; prefer daemon stop paths when validating UI state.
- A long `SYNCHRONIZE_LEASE_MS` can make dead launched agents appear online for much longer than expected.
- A successful launch HTTP response does not prove the agent joined the group; always verify `group_members` or `/web/state` membership.
- Prompt auto-accept success does not prove reconcile success; these are separate lifecycle stages.
- If the daemon is restarted while scratch code is present, `/status.provenance.git_dirty` may correctly report dirty and make later evidence harder to interpret.
