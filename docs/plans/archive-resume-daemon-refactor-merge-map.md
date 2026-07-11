# Archive/Resume Daemon Merge Map

Date: 2026-06-07

This document explains how the archive/resume implementation in
`codex/resumable-archives-plan` should be understood before merging it with the
daemon modularization work in `codex/daemon-refactor-expanded-scope`.

It is intentionally a readiness document, not an implementation plan that
changes behavior. The current archive/resume branch treats the daemon as the
behavioral source of truth. The daemon refactor branch treats the pre-refactor
daemon as the wire-contract source of truth. Reconciling them means preserving
the archive/resume behavior while placing each responsibility into the
refactored daemon module that now owns that concept.

## Inputs Inspected

- Parent worktree:
  `/Users/abhirupdas/Codes/Personal/synchronize`
- Parent worktree branch:
  `master`
- Parent worktree head:
  `bc5babf feat: multi-machine support + config unification`
- Current integration worktree:
  `/Users/abhirupdas/Codes/Personal/synchronize-worktrees/resumable-archives-plan`
- Current integration branch:
  `codex/archive-resume-refactor-integration`
- Current integration branch base:
  `codex/daemon-refactor-expanded-scope`
- Current integration base head:
  `9f90795 Clean up Phase 8 daemon module imports`
- Source archive/resume branch:
  `codex/resumable-archives-plan`
- Source archive/resume head:
  `71607af docs(handoff): session handoff - Pi+Claude AOE archive/resume harness + durable-resume + AOE-quirk fixes`
- Source archive/resume handoff:
  `.claude/handoffs/2026-06-06-210920-claude-pi-archive-resume-harness.md`
- Source archive/resume plan:
  `docs/plans/resumable-archived-sessions.md`
- Source archive/resume daemon file:
  `src/daemon.ts`, 4,750 lines
- Refactor worktree:
  `/Users/abhirupdas/Codes/Personal/synchronize/.claude/worktrees/refactor-daemon-design`
- Refactor branch:
  `codex/daemon-refactor-expanded-scope`
- Refactor head:
  `9f90795 Clean up Phase 8 daemon module imports`
- Refactor plan:
  `docs/plans/daemon-modularization-v2.md`

The current integration worktree is where future integration commits should be
made. The parent worktree should be treated as the current `master` reference
for config and other landed baseline behavior, not as the place to perform this
merge. The raw archive/resume branch is no longer the checked-out branch in the
current integration worktree; use `git show codex/resumable-archives-plan:<path>`
or a separate checkout/worktree when a file from that source branch is needed.

## Current Implementation Summary

The archive/resume branch has moved beyond planning. It adds a full
archive/resume product vertical, live-agent test coverage, and two launch fixes
that make faithful daemon-driven resume work for Pi and Claude.

The current handoff states the branch is clean and pushed, with the default
suite green at `255 pass / 9 skip / 0 fail`, typecheck clean, and no orphaned
tmux sessions or AOE profiles at handoff time. The headline live proof is that
real Pi and Claude agents can memorize a codeword, be archived, be resumed by
the daemon, and recall the codeword after resume.

For `src/daemon.ts`, the archive/resume branch adds or changes these broad
responsibilities:

- Explicit archive routes:
  `POST /archive/session`, `POST /archive/group`,
  `GET /archive/sessions`.
- Explicit resume routes:
  `POST /resume/session`, `POST /resume/group`.
- Lifecycle state:
  `peers.lifecycle_state` moves independently from presence/lease state.
- Alias reservation:
  archived group seats retain their alias and block alias reuse.
- Re-registration resurrection:
  a matching agent registration changes an archived identity back to active.
- Live delivery gating:
  archived peers are delivery-dark for push/subscription, but durable inbox rows
  remain the fallback.
- Zombie handling:
  non-AOE archived processes can be classified as still alive; resume blocks
  unless forced.
- AOE reaping:
  archive tries to stop AOE-owned backend panes without treating that stop as an
  identity delete.
- Retention and stopped-launch sweeps:
  archived identities are exempt from cleanup paths that soft-delete normal dead
  peers.
- Web guardrails:
  mention warnings can distinguish unknown aliases from aliases held by archived
  members.

## Why The Merge Is Non-Trivial

The daemon refactor branch is not a line-preserving edit of the same file. On
that branch, `src/daemon.ts` is a tiny executable compatibility entrypoint and
the former monolithic daemon has been split into:

```text
src/daemon/
  auth.ts
  errors.ts
  repo/
  routes/
  routing.ts
  selectors.ts
  server.ts
  services/
  validation.ts
```

The archive/resume branch, meanwhile, adds `877` lines and removes `37` lines
inside the monolithic `src/daemon.ts` relative to `master`. A normal merge will
not be enough. The archive/resume logic has to be transplanted into the
refactor branch modules by responsibility.

The refactor branch currently has no explicit `/archive/*` or `/resume/*` route
module and no `transitionArchive` or `LocalLivenessProbe` usage in
`src/daemon/*`. It only has the older "resume" meaning around host-session
re-registration after offline/soft-delete. The archive/resume product semantics
must therefore be added to the refactored daemon as a new lifecycle domain and
as edits to existing peer, group, messaging, subscription, launch, and web
state modules.

## Branch Strategy

Keep `codex/resumable-archives-plan` as the raw v1 behavior oracle. It is the
branch that proves the archival-resume product semantics with the monolithic
daemon, the AOE harness, and real Pi/Claude recall checks.

Use `codex/archive-resume-refactor-integration` for the deliberate merge path.
That branch should start from the daemon-refactor baseline, which already
includes the master config resolver work, then transplant archive/resume in
small behavior-preserving slices.

This split reduces risk in three ways:

- The raw archive/resume branch remains available for line-by-line comparison,
  focused test runs, and live-harness validation while integration proceeds.
- The integration branch can keep each commit small enough to prove with route,
  repository, contract, and harness tests before the next cross-cutting change.
- Reviewers can distinguish "archive/resume behavior was intentionally added"
  from "daemon refactor moved code without behavior change."

The integration branch should not start by squash-merging the raw
archive/resume branch. That would recreate the monolithic daemon conflict and
hide the riskiest semantics. Prefer cherry-picking or manually porting by
responsibility:

1. stable schema, lifecycle, launch, CLI, and MCP foundations,
2. daemon archive/resume route/repo/service modules,
3. peer lifecycle and cleanup guards,
4. delivery and group-membership gates,
5. web and contract fixtures,
6. live harness verification.

## Handoff Document Report

This is the high-signal document set a new agent should use to resume the
integration. The same refactor/config/launch docs generally exist in both the
parent worktree and the current integration worktree because the integration
branch starts from the daemon-refactor/master line. The raw archive/resume docs
are source-branch references and should be read with `git show` or by opening a
separate raw branch worktree.

Recommended read order:

1. Read this merge map first.
2. Read the raw archive/resume product plan and final harness handoff from
   `codex/resumable-archives-plan`.
3. Read the daemon modularization and config plans from the current integration
   branch or parent worktree.
4. Read launch/AOE/group harness docs only when working on the corresponding
   implementation slice.

| Scope | Location | Lines | Why it matters for handoff |
|---|---:|---:|---|
| Integration worktree primary handoff | `/Users/abhirupdas/Codes/Personal/synchronize-worktrees/resumable-archives-plan/docs/plans/archive-resume-daemon-refactor-merge-map.md` | 1,220 | Start here. Maps every raw `daemon.ts` archive/resume responsibility to refactor modules, records merge risks, branch strategy, config constraints, test gates, and Beads stack. |
| Source branch product model | `git show codex/resumable-archives-plan:docs/plans/resumable-archived-sessions.md` | 595 | Canonical archive/resume design: presence vs lifecycle, archive is resumable not delete, explicit/group/archive flows, faithful Claude/Pi resume, liveness, AOE reap, test strategy. |
| Source branch implementation handoff | `git show codex/resumable-archives-plan:.claude/handoffs/2026-06-06-210920-claude-pi-archive-resume-harness.md` | 148 | Final raw-branch implementation status: green suite, live Pi/Claude recall proof, exact files changed, environment variables, AOE quirks, deferred work. |
| Parent/current refactor plan | `docs/plans/daemon-modularization-v2.md` in parent or current integration worktree | 1,335 | Defines the daemon module target, semantic-freeze contract, route precedence, extraction phases, Beads mapping, risks, and stop conditions. Use it to avoid undoing the daemon refactor while adding archive/resume. |
| Parent/current config plan | `docs/plans/config-unification.md` in parent or current integration worktree | 161 | Defines the master config resolver model and the Category A operator config vs Category B per-process IPC split. Critical for archive GC, sweep, lease, bind/port/token, and harness env handling. |
| Parent/current launch lifecycle plan | `docs/plans/launch-lifecycle-kernel.md` in parent or current integration worktree | 386 | Explains durable launch state, launch intent/work queue shape, local AOE executor, and remote-ready lifecycle vocabulary. Needed for resume launch enqueue/reconstruct behavior. |
| Parent/current AOE launch plan | `docs/plans/aoe-agent-launch.md` in parent or current integration worktree | 161 | Captures daemon-managed AOE launch mechanics, group-aware launch decisions, and the distinction between synchronize groups and AOE groups. Needed for archive reap and resume spawn behavior. |
| Parent/current tmux/AOE harness doc | `docs/integration-tmux.md` in parent or current integration worktree | 263 | Operational guide for real Pi/AOE/tmux integration tests, diagnostics, lease/revival reproduction, and smoke commands. Needed only when running live harness validation. |
| Parent/current group invariants doc | `docs/group-sync-integrity.md` in parent or current integration worktree | 454-455 | Ground truth for group registration, alias, mention, send/fanout, history, and edge-case invariants. Use while porting archived alias reservation and member-state behavior. |
| Parent/current daemon split handoff | `.claude/handoffs/2026-05-20-034155-sync-mkj-phase1-complete-daemon-split-next.md` in parent or current integration worktree | 302 | Historical daemon modularization context: what split work had already landed, why phase 2 was next, critical files, gotchas, and resume guidance. |
| Parent/current launch stress handoff | `.claude/handoffs/2026-05-31-104015-claude-launch-lifecycle-stress-test.md` in parent or current integration worktree | 350 | Empirical AOE/Claude launch behavior, prompt auto-accept workflow, observed failures, and instrumentation/fix directions. Useful when archive/resume live harness behavior looks flaky. |

Do not load every document up front. For a fresh agent, this merge map plus the
raw archive plan/handoff is enough to orient the work. Pull the refactor,
config, launch, AOE, or group documents only when entering that slice.

## Beads Stack Filed From This Map

The integration work is tracked as three epics with small, staged child issues.
They are intentionally ordered so low-risk, easy-to-validate pieces land before
cross-cutting daemon behavior.

| Phase | Bead | Purpose |
|---|---|---|
| Baseline epic | `sync-0vpq` | Establish archive/resume refactor integration baseline. |
| Baseline 1 | `sync-0vpq.1` | Compare raw archive/resume and refactor daemon baselines. |
| Baseline 2 | `sync-0vpq.2` | Port archive/resume schema, lifecycle, API, CLI/MCP, and launch foundations. |
| Baseline 3 | `sync-0vpq.3` | Validate config-aware archive/resume daemon baseline. |
| Daemon epic | `sync-x7ch` | Port archive/resume lifecycle into refactored daemon modules. |
| Daemon 1 | `sync-x7ch.1` | Add archive/resume repository module. |
| Daemon 2 | `sync-x7ch.2` | Add archive/resume daemon service orchestration. |
| Daemon 3 | `sync-x7ch.3` | Wire archive/resume routes into the refactored dispatcher. |
| Daemon 4 | `sync-x7ch.4` | Patch peer lifecycle resurrection and cleanup guards. |
| Delivery epic | `sync-456r` | Preserve archive/resume delivery, group, web, and harness behavior. |
| Delivery 1 | `sync-456r.1` | Patch archived peer delivery and sender gates. |
| Delivery 2 | `sync-456r.2` | Patch archived group alias and member-state semantics. |
| Delivery 3 | `sync-456r.3` | Patch archive-aware web state, warnings, and ETag. |
| Verification | `sync-456r.4` | Run staged archive/resume refactor verification. |

The dependency graph starts with baseline comparison, then allows foundations
and config validation to proceed in parallel. Daemon repo/service/routes and
peer lifecycle work follow, then delivery/group/web gates, then final
verification. This avoids a broad merge that makes it hard to identify whether
a failure came from schema, config, routing, lifecycle, delivery, or harness
behavior.

## Current Daemon Responsibilities

The current `src/daemon.ts` still fulfills all daemon responsibilities in one
file:

- HTTP route ordering and route matching.
- Body/query validation and error shaping.
- Auth and LAN token enforcement.
- Runtime startup, discovery file writing, startup log writing, and web asset
  serving.
- SQLite repository work for peers, agent sessions, groups, events, reactions,
  inbox, threads, media, launch projection, and activity.
- Media copy/hash/readme filesystem behavior.
- Live subscriber callback fanout.
- SSE `/web/events` client fanout.
- Web state projection and ETag signature calculation.
- Peer presence, lease expiry, retention sweep, soft-delete and resurrection.
- Agent session registration, launch, stop, launch reconcile, durable launch
  worker, and launch lifecycle projection.
- Group creation, group paths, join, rename, patch, leave, history, media, and
  alias policy.
- DM, reply, group-message insertion, mention resolution, push fanout, durable
  inbox fanout, and thread-parent normalization.
- Reactions, thread discovery/status/summary/transcript.
- Archive/resume lifecycle, alias reservation, liveness probe, backend reap,
  resume command construction, and archive-aware delivery gates.

The refactor branch has already split many of those concerns. The merge should
respect the refactor branch's ownership rule:

- Route modules parse HTTP and shape route responses.
- Repositories own SQL row lookup/mutation and row formatting.
- Services own cross-domain side effects.
- `server.ts` owns process startup, long-lived daemon context, worker loops, and
  currently some high-shared helpers that the refactor has not yet moved.
- `routing.ts` preserves the ordered route dispatch contract.
- `src/daemon.ts` remains executable and tiny.

## Archive/Resume Concepts To Preserve

### Lifecycle Is Separate From Presence

Archive/resume introduces two independent axes:

```text
Presence:
  online/offline/activity state
  moved by heartbeat, activity, and lease expiry

Lifecycle:
  active/archived/deleted
  moved by archive, configured auto-archive later, explicit delete, or
  re-registration after resume
```

The critical invariant is that heartbeat and activity must not unarchive a
peer. Only registration resurrects an archived identity.

### Archive Is Not Delete

Archive preserves:

- `peer_id`
- `session_name`
- `host_session_id` and transcript correlation
- group membership history
- archived group aliases
- durable inbox visibility

Delete releases identity. Stop/reap only terminates a runtime. These three
actions must remain separate.

### Archived Alias Seats Are Reserved

Archived group memberships are inactive for delivery, but their aliases stay
reserved. The branch uses `member_state='archived'` with `active=0`, not
`member_state='left'`.

Consequences:

- A different peer cannot join with an archived member's alias.
- A different peer cannot rename to an archived member's alias.
- Mention resolution should return `alias_archived`, not just
  `alias_not_in_group`, when the alias exists but is archived.
- Alias-reclaim events should only consider `member_state='left'`, not any
  inactive row.

### Archived Peers Are Delivery-Dark

Archived peers can have durable inbox rows, but must not receive live push.

Consequences:

- `notifySubscribers` skips archived peers even if a stale/zombie process still
  has a subscription in memory.
- `POST /subscriptions` rejects archived identities with
  `must_reregister`.
- Sending as an archived peer rejects with `must_reregister`.
- DMs and group messages still create durable inbox rows for eligible
  recipients, so catch-up remains possible on resume.

### Resume Means Cause Re-Registration

The daemon does not mutate an archived identity directly to active in the resume
route. Resume builds and enqueues or prints a faithful launch. The actual
identity resurrection happens when the agent process starts and calls
`POST /agent-sessions/register`.

The launch request must pin:

- `peerId`
- previous `hostSessionId`
- previous `hostSessionFile`, if present
- original cwd
- original group and alias where applicable
- model and args from the existing launch intent where available

### Faithful Resume Requires Persisted Resume Targets

Outside `daemon.ts`, the branch adds `resume_host_session_id` and
`resume_host_session_file` to `launch_intents` and reconstructs them in
`specFromRow`. That is required because daemon-mode launches are durable work:
if the durable worker rebuilds a spawn without the resume target, it starts a
fresh session instead of resuming.

Any merge must keep the `src/launch/store.ts`, `src/launch/service.ts`,
`src/launch/backend.ts`, `src/launch/build.ts`, and `src/db.ts` changes aligned
with the daemon route/service changes.

## Master Config Resolver Constraint

Local `master` has moved daemon tunables into a config-driven runtime resolver,
and the daemon-refactor branch already carries that shape. Archive/resume must
merge into that model rather than reintroducing import-time environment reads.

The relevant master/refactor baseline is:

- `src/config.ts` owns `RuntimeConfig`, `loadRuntimeConfig`, and
  `resolveRuntimeConfig`.
- `DaemonContext` includes `config: RuntimeConfig`.
- daemon bind, port, token, lease, peer-retention, sweep interval, and MCP
  heartbeat are resolved from environment overrides, config file values, then
  defaults.
- refactor daemon code already reads config through `ctx.config` where the
  current master has been migrated, for example lease and peer-retention
  behavior.

Archive/resume currently relies on environment-sensitive tests and harnesses,
but those variables are not all the same kind of configuration. Treat them in
three buckets during the merge:

| Bucket | Variables | Merge rule |
|---|---|---|
| Operator daemon config | `SYNCHRONIZE_BIND`, `SYNCHRONIZE_PORT`, `SYNCHRONIZE_TOKEN`, `SYNCHRONIZE_LEASE_MS`, `SYNCHRONIZE_PEER_RETENTION_MS`, `SYNCHRONIZE_SWEEP_INTERVAL_MS`, `SYNCHRONIZE_MCP_HEARTBEAT_MS` | Read through `ctx.config` / `RuntimeConfig`, preserving env-over-config precedence. |
| Per-process launch and registration IPC | `SYNCHRONIZE_HOME`, `SYNCHRONIZE_PEER_ID`, `SYNCHRONIZE_LAUNCH_ID`, `SYNCHRONIZE_SESSION_NAME`, `SYNCHRONIZE_MCP_MODE`, launch command env, Pi extension env, Claude resume env | Keep as process environment. These bind one spawned process to one daemon/session and should not become global config. |
| Test/harness controls | `SYNCHRONIZE_AOE_HARNESS`, `SYNCHRONIZE_AOE_KEEP`, `SYNCHRONIZE_DEBUG`, Python harness env, temporary `SYNCHRONIZE_HOME` values | Keep local to tests or debug paths unless a separate config issue intentionally promotes one. |

Concrete daemon merge implications:

- Do not restore `PEER_RETENTION_MS`, `SWEEP_INTERVAL_MS`, or lease constants as
  import-time environment reads in refactored daemon modules.
- Archive GC and stopped-launch cleanup tests should exercise tiny retention and
  sweep windows through config-aware code paths.
- `resumeSessionApply` and launch resume tests still need exact process env
  propagation for `SYNCHRONIZE_PEER_ID`, `SYNCHRONIZE_LAUNCH_ID`,
  `SYNCHRONIZE_SESSION_NAME`, and tool-specific resume variables.
- `SYNCHRONIZE_DEBUG` can remain a direct debug flag unless the config epic
  explicitly pulls logging/debug into `RuntimeConfig`; it must not affect
  response bodies.
- The merge test plan should include `tests/runtime-config.test.ts` so
  archive/resume does not regress the master config resolver while adding new
  lifecycle behavior.

## Changed Daemon Surfaces In This Branch

This section lists every meaningful `src/daemon.ts` responsibility changed by
the archive/resume branch, with the refactor-branch destination.

### 1. Debug Logging

Current branch:

- Adds `debugEnabled()` and `debug()`.
- Reads `SYNCHRONIZE_DEBUG` per call.
- Used heavily in archive/resume decision points:
  sweep exemptions, reaps, liveness blocks, alias guards, notification skips.

Refactor destination:

- `src/daemon/server.ts` currently exports `log`.
- Add `debugEnabled` and `debug` beside `log`, or create a small logging module
  if the refactor branch has already moved logging by merge time.

Merge constraint:

- Keep debug logging non-behavioral.
- Do not change error envelopes or response bodies while adding debug calls.

### 2. Mention Warning Shape

Current branch:

- `MentionWarning.reason` becomes
  `"alias_not_in_group" | "alias_archived"`.
- `resolveMentions()` now performs both active alias lookup and archived alias
  lookup.
- Unknown aliases still return `alias_not_in_group`.
- Archived alias holders return `alias_archived`.

Refactor destination:

- `src/daemon/server.ts` currently holds `MentionWarning` and
  `resolveMentions`.
- If later refactor work moves mentions into a dedicated module, the change
  belongs there.

Merge constraint:

- Preserve the web/API warning shape.
- Preserve backtick-stripping behavior from the refactor branch, which has
  already extended stripping to double-backtick spans.

### 3. Archive And Resume Routes

Current branch routes:

```text
POST /archive/session
POST /archive/group
GET  /archive/sessions
POST /resume/session
POST /resume/group
```

Current route order:

```text
POST /agent-sessions/register
POST /agent-sessions/launch
POST /agent-sessions/stop
POST /archive/session
POST /archive/group
GET  /archive/sessions
POST /resume/session
POST /resume/group
GET  /agent-sessions
GET  /agent-sessions/:tool/:host_session_id
POST /agent-sessions/rename
```

Refactor destination:

- Add `src/daemon/routes/archive.ts`.
- Add `tryHandleArchiveRoute(request, ctx, url)`.
- Import it in `src/daemon/routing.ts`.
- Place it after `tryHandleAgentSessionsRoute` and before `tryHandlePeersRoute`,
  or split `agent-sessions` handling if exact old order is required around
  `GET /agent-sessions`.

Route precedence notes:

- The new archive/resume paths do not overlap existing parameterized routes,
  but their placement matters for preserving the monolithic route ordering and
  for intuitive grouping near launch/session lifecycle.
- Refactor `routing.ts` currently calls all of `tryHandleAgentSessionsRoute`
  before peers/subscriptions. Since archive/resume does not overlap
  `/agent-sessions/:tool/:host_session_id`, a new archive router immediately
  after agent sessions is acceptable.

### 4. Archive Planning And Mutation

Current branch functions:

- `ArchiveAliasReservation`
- `ArchivePlan`
- `planArchive`
- `markPeerArchived`
- `isPeerArchived`
- `ensureSenderNotArchived`
- `ArchiveSessionResult`
- `archiveSessionApply`
- `ArchivedSessionSummary`
- `listArchivedSessions`
- `resolveArchivePeerId`
- `GroupArchiveMemberResult`
- `archiveGroupApply`

Recommended refactor destination:

```text
src/daemon/repo/archive.ts
  ArchiveAliasReservation
  ArchivePlan
  planArchive
  markPeerArchived
  isPeerArchived
  listArchivedSessions
  resolveArchivePeerId if kept repository-adjacent

src/daemon/services/archive.ts
  archiveSessionApply
  archiveGroupApply
  ensureSenderNotArchived if treated as a lifecycle guard

src/daemon/routes/archive.ts
  body parsing and HTTP response shaping
```

Alternative:

- If the merge should be smaller, put planning/mutation and orchestration in
  `src/daemon/routes/archive.ts` first, then extract repo/service helpers later.
- This is less clean but can reduce merge risk if the refactor branch is still
  moving.

Merge constraint:

- `markPeerArchived` must update `peers.lifecycle_state`, archived metadata, and
  active memberships in one transaction.
- It must convert active memberships to `member_state='archived'`, not `left`.
- It must leave `left_at` alone for archive, because archive is not leave.
- `archiveSessionApply` must delete the subscriber entry for the archived peer.
- AOE reap failure must be a warning, not a failed archive, because the identity
  can still be archived if the backend was already gone.

### 5. Resume Planning And Orchestration

Current branch functions:

- `ResumePlan`
- `planResume`
- `ResumeSessionResult`
- `probeResumeLiveness`
- `peerStillLiveMessage`
- `resumeSessionApply`
- `resolveResumePeerId`
- `GroupResumeMemberResult`
- `resumeGroupApply`

Recommended refactor destination:

```text
src/daemon/repo/archive.ts or src/daemon/repo/resume.ts
  ResumePlan
  planResume
  resolveResumePeerId if kept repository-adjacent

src/daemon/services/archive.ts or src/daemon/services/resume.ts
  probeResumeLiveness
  peerStillLiveMessage
  resumeSessionApply
  resumeGroupApply

src/daemon/routes/archive.ts
  /resume/session and /resume/group HTTP handling
```

Merge constraint:

- `planResume` must reject non-archived peers with `peer_not_archived`.
- It must reject non-launchable tools with `resume_not_launchable`.
- It must require a captured host session.
- It must preserve original cwd and reject missing cwd with `cwd_missing`.
- It must check liveness before launch.
- Live peers must block with `peer_still_live` unless `force` is true.
- `force` must stop AOE or kill the recorded pid before proceeding.
- `mode=print` must return command/env/cwd without spawning.
- `mode=launch` must go through `ctx.launchService.launch(req)` with
  `resume: { hostSessionId, hostSessionFile }`.

### 6. Agent Registration Resurrection

Current branch:

- `upsertPeer()` captures prior `deleted_at` and prior `lifecycle_state`.
- Re-registering a soft-deleted peer reactivates memberships that were
  deactivated by that death.
- Re-registering an archived peer transitions `archived -> active`.
- Re-registration clears `archived_at`, `archived_reason`, and
  `archive_source`.
- `reactivateArchivedMemberships()` changes archived memberships to active.
- Heartbeat/activity do not resurrect lifecycle state.

Refactor destination:

- `src/daemon/repo/peers.ts` already owns `upsertPeer`,
  `reactivateMembershipsOnResurrect`, and peer row helpers.

Merge constraint:

- Add lifecycle columns to `PeerRow`.
- Update `upsertPeer` to read `deleted_at` and `lifecycle_state`.
- Add `reactivateArchivedMemberships`.
- Update `reactivateMembershipsOnResurrect` to respect `member_state='left'`
  and to avoid conflicts with active or archived alias holders.
- Import and use `transitionArchive`.

### 7. Retention Sweep

Current branch:

- `selectExpiredPeerIds(db, cutoff)` excludes
  `lifecycle_state='archived'`.
- `sweepExpiredPeers()` logs archived exemptions under debug.
- Soft-deleted peers have memberships changed to
  `member_state='left'`.

Refactor destination:

- Refactor branch currently keeps `sweepExpiredPeers()` in
  `src/daemon/server.ts`.
- If the refactor later moves it, it likely belongs in
  `src/daemon/services/launch-worker.ts` or `src/daemon/repo/peers.ts` plus a
  service wrapper.

Merge constraint:

- Archived peers must be exempt from retention cleanup.
- The SQL must set `member_state='left'` when soft-delete deactivates active
  memberships.
- The web state invalidation domains must remain `["peers", "groups"]`.

### 8. Stopped-Launch Cleanup

Current branch:

- `deactivateStoppedLaunchPeer()` refuses to soft-delete archived peers.
- `selectStoppedLaunchPeerIds()` selects peers whose latest launch is stopped,
  not peers with any stopped launch in history.
- `selectStoppedLaunchPeerIds()` excludes archived peers.
- `sweepStoppedLaunchPeers()` uses that selector and emits
  `["peers", "groups", "agent_sessions"]`.

Refactor destination:

- `src/daemon/repo/peers.ts` currently owns `deactivateStoppedLaunchPeer`.
- `src/daemon/server.ts` currently owns `sweepStoppedLaunchPeers`.
- A later extraction may put the selector in `repo/peers.ts` or
  `repo/launch.ts` and the loop in `services/launch-worker.ts`.

Merge constraint:

- Do not treat archive reap as stop-delete.
- Do not let an older stopped launch delete a newly resumed peer.
- Keep latest-launch ordering:
  `ORDER BY li.updated_at DESC, li.created_at DESC LIMIT 1`.

### 9. Peer Soft Delete

Current branch:

- `softDeletePeerIfPresent()` sets `deleted_at`, `lease_expires_at`, and
  `updated_at`.
- It deactivates active memberships as `member_state='left'`.
- It deletes the live subscriber.

Refactor destination:

- `src/daemon/repo/peers.ts`.

Merge constraint:

- Soft-delete is still the identity-release path, unlike archive.
- Soft-delete must not accidentally mark archived memberships as left unless the
  operator is explicitly deleting/releasing that identity.

### 10. Subscription Registration

Current branch:

- `POST /subscriptions` rejects archived peers with `409 must_reregister`.
- The reason is that zombie processes must not regain live delivery without
  re-registering.

Refactor destination:

- `src/daemon/routes/subscriptions.ts`.
- The guard can import `isPeerArchived` from the archive repo/service module.

Merge constraint:

- Keep response status and code exactly:
  `409 must_reregister`.
- Keep durable inbox fallback semantics unchanged.

### 11. Subscriber Notification

Current branch:

- `notifySubscribers()` skips archived recipients before looking up subscriber
  state.
- It does not mark `delivered_at` for skipped archived peers.
- It logs durable inbox fallback.

Refactor destination:

- `src/daemon/services/subscriptions.ts`.

Merge constraint:

- Import `isPeerArchived`.
- Skip archived peers before callback.
- Keep failure cleanup: callback non-OK or fetch error removes subscriber.
- Keep successful callback marking `delivered_at` and advancing
  `peers.last_cursor`.

### 12. DM And Reply Sending

Current branch:

- `POST /dm` calls `ensureSenderNotArchived`.
- `POST /reply` should also get the sender guard. The changed-declaration map
  showed `route` changed around message routes, and the product invariant says
  every send entry point must reject archived senders.

Refactor destination:

- `src/daemon/routes/messaging.ts`.

Merge constraint:

- Add sender lifecycle guard to DM and both reply paths.
- Preserve existing message-size, visibility, inbox, push, and response-shape
  behavior.

### 13. Group Message Sending

Current branch:

- `POST /groups/:name/messages` calls `ensureSenderNotArchived`.
- Mention resolution can return `alias_archived`.
- Archived members are not active, so durable fanout naturally excludes them.

Refactor destination:

- `src/daemon/routes/groups.ts`.
- `resolveMentions` currently lives in `src/daemon/server.ts` on the refactor
  branch.

Merge constraint:

- Add sender lifecycle guard before `ensureActiveMember`.
- Preserve `warnings` and `delivery` as always-present response fields.

### 14. Group Rename Alias Reservation

Current branch:

- `POST /groups/:name/rename` checks whether the new alias is held by an
  archived member.
- If a different peer holds that archived alias, it throws:
  `409 alias_reserved_by_archived`.

Refactor destination:

- `src/daemon/routes/groups.ts`.
- The SQL could later move to `repo/groups.ts`.

Merge constraint:

- The error must be more specific than generic `alias_collision`.
- The current peer should not be blocked from its own archived seat during
  resume-related reactivation paths.

### 15. Group Leave

Current branch:

- Leave changes membership to:
  `active = 0`, `member_state = 'left'`, `left_at = now`.
- This is distinct from archive:
  `active = 0`, `member_state = 'archived'`, `left_at` unchanged.

Refactor destination:

- `src/daemon/routes/groups.ts`.

Merge constraint:

- Add `member_state='left'` in the leave update.
- Preserve idempotent already-left behavior.

### 16. Group Join And Alias Reclaim

Current branch:

- `joinGroupCore()` checks archived alias holders before reclaim.
- Archived aliases are not reclaimable.
- Previous holders for reclaim must be `member_state='left'`.
- Rejoined/inserted memberships explicitly set
  `member_state='active'`.

Refactor destination:

- `src/daemon/server.ts` currently owns `joinGroupCore`.
- Later it may belong in `services/delivery.ts` or `repo/groups.ts`.

Merge constraint:

- Preserve the `alias_reserved_by_archived` error.
- Do not let the old refactor-branch `active = 0` previous-holder query treat
  archived seats as reclaimable.
- Insert/update `member_state='active'` when joining.

### 17. Web State And Warning UI

Current branch:

- Mention warnings include `alias_archived`.
- Web code surfaces archived alias warnings as toasts.
- `buildWebState()` needs to include lifecycle/member-state fields wherever the
  web UI displays or derives archived/resumable state.

Refactor destination:

- `src/daemon/server.ts` currently owns `buildWebState`.
- `src/daemon/routes/web.ts` owns `/web/state`, `/web/session`,
  `/web/events`, staged attachments, and static assets.

Merge constraint:

- If current web types include lifecycle fields, port the query/format shape to
  the refactor branch's `buildWebState`.
- Update `/web/state` ETag render signature if archived state affects rendered
  state.

### 18. Launch Reconcile

Current branch:

- Archive/resume depends on `reconcileLaunch()` and `joinGroupCore()` because
  the resumed process re-registers and should reattach to its launch group.
- `resumeSessionApply()` passes `peerId` and prior host session into
  `ctx.launchService.launch(req)`.

Refactor destination:

- `src/daemon/server.ts` currently owns `reconcileLaunch`,
  `reconcileDurableLaunch`, and launch worker functions.
- `src/daemon/routes/agent-sessions.ts` calls `reconcileLaunch` after
  registration.

Merge constraint:

- Re-registering a resumed process must preserve the pinned `peerId`.
- Launch reconcile must not create duplicate memberships or reclaim aliases
  from the archived identity.

## Recommended Refactor-Branch Module Additions

The clean target after merging archive/resume into the refactored daemon would
look like:

```text
src/daemon/routes/archive.ts
  POST /archive/session
  POST /archive/group
  GET  /archive/sessions
  POST /resume/session
  POST /resume/group

src/daemon/repo/archive.ts
  archive row types
  planArchive
  markPeerArchived
  isPeerArchived
  listArchivedSessions
  planResume

src/daemon/services/archive.ts
  archiveSessionApply
  archiveGroupApply
  resumeSessionApply
  resumeGroupApply
  probeResumeLiveness
  peerStillLiveMessage
  ensureSenderNotArchived
```

That split follows the refactor branch's ownership rule:

- `routes/archive.ts` handles HTTP parsing/response only.
- `repo/archive.ts` owns archive/resume SQL reads and mutations.
- `services/archive.ts` owns cross-domain side effects:
  AOE stop, local liveness probe, launch enqueue, subscriber deletion, and web
  state invalidation.

If minimizing merge surface is more important than final cleanliness, a safe
intermediate option is:

```text
src/daemon/routes/archive.ts
  route handlers plus orchestration

src/daemon/repo/archive.ts
  db-only helpers used by routes/archive.ts
```

Then extract orchestration to `services/archive.ts` in a follow-up.

## Routing Order In The Refactor Branch

The refactor branch currently dispatches routes in this order:

```text
health
web
auth boundary
status
agent-sessions
peers
subscriptions
query
messaging
groups
event lookup
reactions
threads
media
inbox
activity
event pull
not_found
```

Recommended archive placement:

```text
agent-sessions
archive/resume
peers
subscriptions
```

Rationale:

- Archive/resume is a peer/session lifecycle surface, adjacent to launch/stop.
- It has no parameterized-path overlap with agent-session GET routes.
- Placing it before peers/subscriptions preserves the mental model that
  lifecycle gates are established before live-delivery routes.

## Schema And Type Surfaces To Verify

The current archive/resume implementation depends on schema changes outside
`daemon.ts`. The refactor merge must include all of them:

```text
peers:
  lifecycle_state
  archived_at
  archived_reason
  archive_source

group_members:
  member_state
  unique alias index covering active and archived holders

groups:
  auto_archive, if present in the current migrations

launch_intents:
  resume_host_session_id
  resume_host_session_file
```

Daemon/refactor type changes:

- `PeerRow` must include lifecycle/archive fields if serialized or read by
  helpers.
- `MemberRow` must include `member_state` if web/API responses expose it.
- `MentionWarning.reason` must include `alias_archived`.
- Archive/resume result interfaces need a shared home if used by tests or
  route modules.

## Test Coverage To Carry Over

The archive/resume branch added and changed tests around:

- archive lifecycle reducer
- archive routes
- resume routes
- archive migration
- archive GC
- archive probe/liveness
- archive session behavior
- MCP archive tools
- launch resume command build
- launch service durable resume behavior
- AOE backend command wrapping
- gated AOE archive/resume harness
- gated AOE baton harness
- Python cognition harness for Pi/Claude recall
- shared daemon and AOE harness helpers

When merging into the refactor branch, run at minimum:

```bash
bun run typecheck
bun test tests/runtime-config.test.ts
bun test tests/archive-lifecycle.test.ts
bun test tests/archive-routes.test.ts
bun test tests/archive-resume.test.ts
bun test tests/archive-session.test.ts
bun test tests/archive-gc.test.ts
bun test tests/archive-probe.test.ts
bun test tests/archive-migration.test.ts
bun test tests/mcp-archive.test.ts
bun test tests/launch-resume-build.test.ts
bun test tests/launch-service.test.ts
bun test tests/daemon-route-precedence.test.ts
bun test tests/daemon-http-contract.test.ts
bun test tests/daemon-sse-subscriptions.test.ts
bun test tests/daemon-validation.test.ts
bun test
```

For live harness confidence after automated tests:

```bash
SYNCHRONIZE_AOE_HARNESS=1 bun test tests/archive-resume-harness.test.ts
uv run scripts/integration_archive_resume_pi.py --tool pi
uv run scripts/integration_archive_resume_pi.py --tool claude
```

The live tests spawn real agents and must use throwaway runtime state and
mandatory cleanup. They should not be run as part of a normal quick merge check
unless the user explicitly wants live verification.

## Specific Merge Risks

### Risk: Archive Routes Are Added But Delivery Gates Are Missed

Adding `/archive/*` and `/resume/*` is insufficient. If
`notifySubscribers`, `/subscriptions`, `/dm`, `/reply`, and group-message sends
do not gain archive guards, zombie archived agents can still participate live.

### Risk: Archived Aliases Become Reclaimable

The refactor branch's `joinGroupCore()` currently treats inactive previous
holders as reclaimable using `active = 0`. In the archive branch, only
`member_state='left'` is reclaimable. If this is not ported, a new peer can take
an archived peer's reserved alias.

### Risk: Stopped Launch Cleanup Deletes Archived Peers

The refactor branch's `deactivateStoppedLaunchPeer()` currently delegates
directly to soft-delete. In archive/resume, archive reaps the runtime but must
not delete identity. Missing this guard breaks resume.

### Risk: Old Stopped Launch Deletes New Resume

The refactor branch's stopped-launch sweep selects any stopped launch. The
archive branch changed this to check the latest launch state per peer. Without
that, an original stopped launch can delete a newly resumed process.

### Risk: Heartbeat Accidentally Unarchives

Only `POST /agent-sessions/register` should transition archived to active.
Heartbeat and activity must only move presence/activity. If lifecycle logic is
placed too broadly in peer update helpers, archived peers can resurrect without
a real resume.

### Risk: Durable Resume Target Is Lost In Launch Worker

The daemon route can enqueue a resume correctly, but the durable worker can
still spawn a fresh session if `launch_intents.resume_host_session_id` and
`resume_host_session_file` are not persisted and reconstructed.

### Risk: Web ETag Hides Archived State

If archived state changes rendered web state but is not included in the
`/web/state` ETag signature, clients can keep stale UI under 304 responses.

### Risk: Contract Snapshot Tests Need Updating Intentionally

The refactor branch added HTTP contract fixtures against pre-archive `master`.
Archive/resume intentionally expands the REST contract. Snapshot updates should
be reviewed as product additions, not refactor drift.

## Suggested Merge Sequence

This is the safest sequence for a future implementation merge.

1. Create or continue the integration branch from the daemon-refactor baseline,
   not from the raw archive/resume branch. Verify that `src/config.ts`,
   `DaemonContext.config`, and `tests/runtime-config.test.ts` are present before
   porting archive/resume daemon behavior.
2. Merge or cherry-pick non-daemon archive/resume foundations first:
   schema/migrations, `src/lifecycle/*`, `src/api/archive.ts`,
   `src/api/resume.ts`, CLI/MCP archive surfaces, launch durable-resume fixes,
   and tests.
3. Add `src/daemon/repo/archive.ts` with db-only archive/resume planning and
   mutation helpers.
4. Add `src/daemon/services/archive.ts` with orchestration helpers that need
   `DaemonContext`, `LaunchService`, liveness probe, subscribers, and web-state
   invalidation.
5. Add `src/daemon/routes/archive.ts` and wire it into `routing.ts`.
6. Patch `repo/peers.ts` for lifecycle fields, soft-delete member_state,
   archive resurrection, retention selectors, and stopped-launch cleanup.
7. Patch `server.ts` for debug logging, mention alias warnings,
   retention/stopped sweeps if still located there, and `joinGroupCore` alias
   reservation if still located there. Keep daemon tunables config-driven while
   doing this.
8. Patch `services/subscriptions.ts` to skip archived peers.
9. Patch `routes/subscriptions.ts` to reject archived subscriptions.
10. Patch `routes/messaging.ts` and `routes/groups.ts` for archived-sender
   guards.
11. Patch `routes/groups.ts` leave/rename behavior and `joinGroupCore`
    semantics if not already handled through shared helpers.
12. Patch `buildWebState` and web route/state types for archive-aware fields and
    ETag signature.
13. Run config, focused archive, daemon-contract, and messaging tests before the
    full suite.

## Review Checklist

Use this checklist while reviewing the eventual merge.

```text
[ ] src/daemon.ts is still a tiny executable entrypoint.
[ ] daemon tunables still flow through RuntimeConfig / DaemonContext.config.
[ ] per-process launch IPC env remains process-local and is not promoted to
    daemon-global config.
[ ] routing.ts keeps deterministic route order and includes archive/resume.
[ ] archive/resume route handlers return the same status codes and JSON shapes
    as the current archive branch.
[ ] archived peers cannot subscribe, send DMs, send replies, or post group
    messages.
[ ] archived peers do not receive live subscriber callbacks.
[ ] durable inbox rows remain intact for archive/resume catch-up.
[ ] retention sweep excludes lifecycle_state='archived'.
[ ] stopped-launch sweep checks latest launch state and excludes archived peers.
[ ] archive reap does not soft-delete the archived peer.
[ ] soft-delete paths mark memberships as member_state='left'.
[ ] archive paths mark memberships as member_state='archived'.
[ ] join/rename block aliases reserved by archived seats.
[ ] alias reclaim considers member_state='left' only.
[ ] re-registration, not heartbeat/activity, resurrects archived identities.
[ ] re-registration clears archived metadata and reactivates archived seats.
[ ] resume launch pins peerId and prior host session target.
[ ] durable launch worker reconstructs resume targets from launch_intents.
[ ] web state and ETag account for lifecycle/member_state if rendered.
[ ] daemon contract snapshots are updated only for intentional new endpoints and
    intentional archive-aware fields.
```

## Current Open Work After This Branch

The handoff identifies these high-value next items:

- `sync-ocdt.2`: durable catch-up on resume. A DM sent while a peer is archived
  should be delivered from durable inbox after resume.
- `sync-ocdt.3`: real-sweeper GC exemption. With a tiny retention/sweep window,
  an archived peer must survive while a non-archived idle peer is swept.
- `sync-weua`: product-side AOE cleanup. Archive/stop should remove AOE sessions
  from AOE groups and prune empty AOE groups; the harness cleanup side is
  already fixed.

These are not prerequisites for understanding the current daemon merge, but
they are exactly the areas most likely to catch regressions after the daemon
refactor absorbs archive/resume.

Config-related open work also matters for this merge:

- `sync-tw0e`: config unification epic.
- `sync-x7ep`: daemon and tunable reads migrated to the config resolver.
- `sync-11gp`: remaining summary/LLM/skills config reads.

The archive/resume integration should assume the config resolver is the master
baseline and should avoid adding new daemon tunable reads outside it.

## Bottom Line

Treat archive/resume as a cross-cutting daemon lifecycle feature, not as one
new route file. The clean refactor merge needs:

- one new archive/resume route surface,
- one archive/resume repo/service domain,
- peer repo lifecycle changes,
- group alias/membership semantics changes,
- messaging/subscription delivery gates,
- launch-worker durability alignment,
- master config resolver alignment,
- web state/warning alignment,
- and contract tests that distinguish structural refactor drift from
intentional product-surface additions.

The future merge should be reviewed by behavior, not file movement. The
archive branch's invariant is simple: archived means reserved and resumable,
not live and not deleted.
