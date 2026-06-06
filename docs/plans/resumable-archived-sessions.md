# Resumable Archived Sessions and Groups

Status: **design frozen 2026-06-06.** Do not create Beads issues or add to the
skill index until explicitly asked.

> **Reading order:** the *flow* matters more than the logic. Read §1–§6
> (decisions, assumptions, constraints, model, flow diagrams, real-world
> scenarios) first. §7+ (implementation, tests) is for whoever builds it.

---

## 1. Goal

Make Claude and Pi agent sessions — and the groups that contain them —
**archivable and resumable with their full host context intact**. A resumed
agent is *the same conversation continued* (`claude --resume <id>` /
`pi --session <id>`), reattached to its original `synchronize` identity, aliases,
and group history — not a fresh agent wearing the old name tag.

v0 is CLI-first, plus **MCP archive/resume tools** so a managing agent can drive
archive/resume on the operator's behalf (it need not be a member of the target
group). The web UI only needs guardrails so archived agents are not confused with
live ones.

---

## 2. Decisions taken

| # | Decision |
|---|----------|
| D1 | **Two orthogonal axes.** *Presence* (lease: online/offline) is separate from *Lifecycle* (`active` / `archived`, plus `deleted_at` = gone). Heartbeats move presence; they **never** change lifecycle. |
| D2 | **Archived *is* resumable.** Lifecycle is one column (`active` / `archived`) on existing rows; resume needs no intermediate state. |
| D3 | **Faithful context resume is the v0 product**, for both tools. Identity-only (roster) resume is the fallback for inspect-only / non-launchable sessions. |
| D4 | **Resume rides the existing resurrection path.** `upsertPeer` already resurrects a peer and reactivates its memberships on re-register, keyed on `host_session_id`. Resume = "cause a re-registration of the archived identity." |
| D5 | **Archival is intentional**: either *explicit* (`synchronize archive`) or *auto* (opt-in config). Nothing is preserved by accident. |
| D6 | **Auto-archive fires off the existing sweeper** at the shared 24h lease threshold. Auto-archive ON → archive; OFF → today's soft-delete. |
| D7 | **Free-the-runtime**: when an AOE/tmux session is archived, its backend session is reaped (slot reclaimed). Identity + transcript are preserved for resume. |
| D8 | **Resume liveness is a real-time probe**, not the stored lease. A confirmed-dead archived peer resumes instantly; only a probe-confirmed-live peer blocks. On resume the lease is reset — the resumed agent starts with a fresh TTL. |
| D9 | **Helpful block, not a wall.** A live-peer block returns pid + cwd + tool + host session, plus an opt-in `--force` that kills the live process. |
| D10 | **Two resume backends**: AOE-managed (daemon spawns) or plain-terminal (daemon emits the exact command, user runs it). Both converge on re-registration. |
| D11 | **Auto-archive is configurable per-group and per-agent.** Group config cascades to members and enables group resume. |
| D12 | **Pure lifecycle state machine** (mirrors `src/launch/lifecycle.ts`) over `lifecycle_state`; the spawn side-effect reuses the existing `launch_work` queue. |
| D13 | **MCP archive/resume tools** are part of this work, not deferred. A managing agent can list/archive/resume sessions and groups it does not belong to (admin-style tools over the same daemon endpoints as the CLI). |

---

## 3. Assumptions (things we assume true)

- **A1 — Single machine (v0).** One daemon, one host. Cross-machine is planned
  soon, and the model is forward-compatible: the agent identity already needs a
  machine marker, from which the daemon infers same-machine vs cross-machine. A
  cross-machine session stays fully scoped to its own host — its AOE instance,
  user terminal, transcript, and cwd all live there; only the cwd path differs
  per machine. The deeper work it pulls in is recorded in §10 (remote spawn +
  remote liveness probe), but none of it is needed for v0.
- **A2 — Lease expiry is an acceptable death proxy.** We have no reliable
  termination signal (SIGKILL is untrappable). "No heartbeats for the lease
  window" stands in for "dead." Detection latency = up to one sweep interval;
  acceptable because an idle agent has no one waiting on it.
- **A3 — `host_session_id` is stable across resume by default.**
  `claude --resume <id>` keeps the same session id unless `--fork-session`
  (we never fork). Pi `--session <id|path>` reuses the session. So
  `UNIQUE(host_tool, host_session_id)` correlation survives resume.
  > **⚠ VERIFIED FALSE (2026-06-06, AOE harness).** Empirically, both
  > `claude --resume <id>` and `pi --session <id>` LOAD the prior conversation
  > but the resumed instance registers under a **new** `host_session_id` (Claude:
  > `ebe0…`→`cee8…`; Pi: `…785a`→`…8126`). Faithful resume does **not** depend on
  > A3: identity reattaches via the pinned **`ENV_PEER_ID`** (the archived
  > peer_id), not host_session_id correlation, so resurrection
  > (archived→active) still fires correctly. `planResume` reads the *latest*
  > `agent_session` (ORDER BY updated_at DESC), so the resume chain self-heals to
  > the newest session id. The host_session_id correlation remains a best-effort
  > *fallback* for the rare case where ENV_PEER_ID is absent.
- **A4 — The transcript outlives the process.** Claude transcripts live in
  `~/.claude/projects/<cwd-hash>/<id>.jsonl`; Pi sessions in the daemon-owned
  `PI_CODING_AGENT_SESSION_DIR`. Both survive a crash / worktree deletion.
- **A5 — `agent_sessions` is already populated for every session**, AOE-launched
  or user-spawned, because the SessionStart hook / Pi extension fires regardless
  of who launched it (captures `host_session_id`, `host_session_file`, `cwd`,
  `pid`).
- **A6 — `pid` is reliable while the process is alive.** PID reuse only bites a
  *dead* process; we only ever act on a pid for a probe-confirmed-live peer.

---

## 4. Constraints imposed on the user

- **C1 — Resume requires the original cwd to exist.** Claude resolves `--resume`
  within the project keyed by cwd, and both tools' work is meaningless without
  the workspace. Missing cwd → hard `cwd_missing` failure with an actionable hint
  (the branch is known from `agent_sessions.git_branch`).
- **C2 — Only archived identities are resumable.** A dead session that was never
  archived (auto-archive off) follows today's behavior and is gone after
  retention. To resume a just-dead agent, archive it first (explicit archive of a
  dead peer is instant).
- **C3 — You cannot resume an identity that is provably still alive.** If a probe
  shows the process up (the non-AOE zombie case), resume is blocked until you
  stop it — via your own kill, `--force`, or a reboot (which makes the probe
  report dead and unblocks automatically).
- **C4 — A live-but-archived peer cannot send.** It must re-register first; send
  attempts return an explicit error.
- **C5 — Archived seats are reserved.** An archived alias blocks joins/renames by
  other peers in that group until the archive is resumed or deleted.

---

## 5. The model

### 5.1 Two orthogonal axes

```
  PRESENCE  (lease_expires_at)                LIFECYCLE  (lifecycle_state)
  ────────────────────────────                ────────────────────────────────
  online   lease fresh                        active    delivers, mentionable
  offline  lease lapsed                        archived  reserved + transcript kept,
                                                          resumable, NO delivery
  moved by: heartbeat / activity              deleted_at  identity released (rare)

  RULE: heartbeats move PRESENCE only. Lifecycle changes are intentional
        (explicit command, configured auto-archive, or a re-register/resume).
```

### 5.2 Lifecycle state machine

```
                      explicit `synchronize archive`
              ┌──────────────────────────────────────────────┐
              │   lease_expired  &&  auto-archive ON           │
              │  (AOE: reap backend session — free the runtime)│
              ▼                                                │
   ┌───────────────┐                                   ┌───────────────┐
   │    ACTIVE     │                                   │   ARCHIVED    │
   │               │   resume: re-register with        │  (resumable)  │
   │ (online or    │ ◀──── same identity ───────────── │ identity +    │
   │  offline —     │    (explicit launch OR            │ alias +       │
   │  presence is   │     implicit re-register)         │ transcript    │
   │  orthogonal)   │                                   │ reserved      │
   └───────┬───────┘                                   └───────┬───────┘
           │  lease_expired && auto-archive OFF (>24h)          │ explicit delete
           │  (TODAY's behavior — unchanged)                    │ / future cleanup
           ▼                                                    ▼
   ┌───────────────────────────────────────────────────────────────────┐
   │                         DELETED  (deleted_at set)                   │
   │        register with same identity ⇒ resurrect → ACTIVE (existing)  │
   └───────────────────────────────────────────────────────────────────┘
```

### 5.3 Cross-product (the entire behavior table)

```
                  │ auto-archive OFF                │ auto-archive ON
 ─────────────────┼──────────────────────────────────┼───────────────────────────────
 active + online  │ normal live agent                │ normal live agent
 active + offline │ idles → soft-deleted at 24h       │ at 24h: → ARCHIVED
  (lease lapsed)  │   (today's sweeper)               │   (AOE: reap tmux; non-AOE: let die)
 archived+offline │ the resting resumable state — sweeper-exempt, alias held
 archived+online  │ ⚠ zombie (non-AOE, still alive): blocked from delivery + send;
                  │    resume blocked until killed; re-register to revive
```

---

## 6. Flows (categorized)

### Flow A — Explicit archive, AOE-launched session

```
 synchronize archive session --peer-id P            (or `archive group G`)
        │
        ▼  state machine: ACTIVE --archive_requested--> ARCHIVING
   reap backend: launchService.stop(title)  ← free the runtime
        │
        ▼  ARCHIVING --reaped--> ARCHIVED
   lifecycle_state=archived ; member_state=archived ; active=0
   alias stays reserved ; host_session_id + transcript retained
        │
        ▼
   CLI prints: archived peer P, reserved alias(es), resume command hint
```

### Flow B — Explicit archive, user-managed (non-AOE) session

```
 synchronize archive session --peer-id P
        │
        ▼  probe liveness (pid / no backend title)
   ┌────┴─────────────┐
 dead                 alive
   │                   │
 ARCHIVED            archive identity (ARCHIVED) but CANNOT reap.
 cleanly             Process becomes a "zombie": online + archived.
                     → send blocked (C4), delivery off, resume blocked (C3)
                     until user stops it.
```

### Flow C — Auto-archive on lease expiry (AOE)

```
 sweeper tick (hourly)  +  lease_expired > 24h  +  auto-archive ON (group/agent)
        │
        ▼  ACTIVE --lease_expired--> ARCHIVED        (instead of soft-delete)
   reap backend session (process already idle/dead) → slot reclaimed
        │
        ▼  identity + transcript preserved; alias reserved
```

### Flow D — Auto-archive on lease expiry (non-AOE)

```
 sweeper tick + lease_expired > 24h + auto-archive ON
        │
        ▼  ACTIVE --lease_expired--> ARCHIVED
   cannot reap (not ours). If process already dead → clean.
   If somehow still alive → zombie (see Flow B-alive).
```

### Flow E — Resume launch, AOE-managed (faithful context)

```
 synchronize resume launch --peer-id P [--attach]
        │
        ▼  VALIDATE
   ├─ lifecycle_state == archived ........... else peer_not_archived
   ├─ cwd exists ............................ else cwd_missing (+ branch hint)
   └─ liveness probe == DEAD ................ else peer_still_live (Flow H)
        │
        ▼  build resume command (reuse archived peer_id via ENV_PEER_ID)
   claude:  claude --resume <host_session_id>  --dangerously-skip-permissions …
   pi:      pi --session <host_session_id|file>  --provider … --model …
        │
        ▼  launch_work(spawn) → AOE spawns in original cwd
   SessionStart / Pi-ext re-registers (same host_session_id)
        │
        ▼  upsertPeer resurrection: ARCHIVED --registered--> ACTIVE
   member_state archived→active, active=1, lease renewed, history cursor intact
```

### Flow F — Resume via plain terminal (user-managed)

```
 synchronize resume show --peer-id P   (or `resume launch --print`)
        │
        ▼  daemon emits the EXACT command + env + cwd:
   cd <cwd> && SYNCHRONIZE_HOME=… SYNCHRONIZE_PEER_ID=P \
       claude --resume <host_session_id> …
        │
        ▼  user runs it in their own terminal
   SessionStart hook fires → re-registers by host_session_id correlation
        │
        ▼  resurrection: ARCHIVED → ACTIVE   (no AOE involved)
```

### Flow G — Implicit resume (same session re-registers on its own)

```
 any process re-registers with an archived peer's host_session_id / peer_id
        │
        ▼  registerPeer / agent_sessions register
   matched to archived identity → resurrection → ARCHIVED → ACTIVE
   (this is Flow E/F's tail; explicit resume is just "the daemon caused it")
```

### Flow H — Resume blocked by a live peer (helpful)

```
 resume launch --peer-id P  →  liveness probe == ALIVE
   (probe is a real pid check run ON THE AGENT'S OWN MACHINE — v0 local,
    multi-machine via a per-machine probe; never trust the lease timestamp)
        │
        ▼  FAIL peer_still_live  (rich payload — suggests --force inline):
   ┌──────────────────────────────────────────────────────────┐
   │ "research-critic" (peer 7f3a…) is still alive.            │
   │   pid 48213   tool claude   cwd ~/wt/feature-x            │
   │   host_session 0c2b…   lease expires 14:07               │
   │   stop it yourself:   kill 48213   (or close its terminal)│
   │   or let synchronize do it:                              │
   │       synchronize resume launch --peer-id 7f3a… --force  │
   │   or reboot — the lease lapses and resume unblocks.      │
   └──────────────────────────────────────────────────────────┘
        │
        ▼  --force  (probe-confirmed-live ⇒ pid is accurate ⇒ re-verify pid is
   alive on its machine, kill it, then resume.  Warns: "--force terminates the
   running process.")
```

### Flow I — Group archive & group resume

```
 ARCHIVE GROUP                              RESUME GROUP
 synchronize archive group G                synchronize resume group G [--only …]
        │                                          │
        ▼ for each active member:                  ▼ for each archived member:
   ┌──────────────────────────┐             ┌──────────────────────────────────┐
   │ AOE     → reap + ARCHIVED │             │ probe + cwd-check, then           │
   │ non-AOE → ARCHIVED (+zombie│            │   AOE-resume each launchable      │
   │            if still alive) │            │   inspect-only → skipped, noted   │
   └──────────────────────────┘             │   live zombie  → blocked, noted   │
   alias reservations retained              └──────────────────────────────────┘
        │                                          │
        ▼                                          ▼  PER-MEMBER status (never one bit)
   group reserved as a unit            ALIAS    TOOL   ACTION     WARNING
                                       critic   claude launching  -
                                       planner  pi     skipped    inspect-only
                                       observer claude blocked     still alive
   UI: the group reappears, members alive & ready in tmux.
```

### Flow J — `cwd_missing`

```
 resume … → cwd does not exist on disk (worktree deleted)
        │
        ▼  FAIL cwd_missing:
   "cwd ~/wt/feature-x is gone. Restore the worktree for branch
    'feature-x' at that path, then re-run resume. (Transcript is
    preserved; inspect with `resume show`.)"
```

### Flow K — Live-but-archived zombie tries to send

```
 archived peer calls bridge_send_group / send
        │
        ▼  FAIL must_reregister:
   "This identity is archived. Re-register before sending."
```

---

## 7. Real-world applications (why the flows matter)

> Dedicated, recorded narrative — the flow is the product.

- **Overnight pause of a research group.** A group runs all day; at night the
  agents idle, leases lapse. With per-group auto-archive on, the daemon archives
  them at the 24h mark and reaps their tmux sessions — **the machine is freed
  overnight**. Next morning `synchronize resume group research` brings the whole
  group back, every agent continued from its exact prior context (Flow C + I).

- **Crash recovery.** An agent is OOM-killed. Heartbeats stop; auto-archive
  preserves the identity and transcript. `resume launch` relaunches with
  `--resume`, and the conversation continues as if nothing happened (Flow C + E).

- **Deliberate checkpoint.** An operator finishes a sub-task and explicitly
  archives a group, keeping its worktrees. A week later they resume it to pick up
  exactly where they left off (Flow A + I).

- **The stubborn live agent.** A user-spawned Claude is running in a forgotten
  terminal; the operator wants to resume it elsewhere. Instead of a dead-end
  block, synchronize hands them the pid/cwd to kill it — or `--force` does it —
  or a reboot frees it automatically (Flow H).

- **Resume without AOE.** A user prefers their own terminal. `resume show` prints
  the exact `claude --resume` command; they paste it and the session reattaches
  by `host_session_id` correlation (Flow F).

---

## 8. Implementation

> Logic-level detail and blast radius. Anchored to current code.

### 8.1 Schema

```text
peers:
  + lifecycle_state TEXT NOT NULL DEFAULT 'active'   -- active | archived
  + archived_at TEXT
  + archived_reason TEXT
  + archive_source TEXT        -- 'manual' | 'auto'  (drives future cleanup)
  (release/delete stays on the existing deleted_at)

group_members:
  keep  active INTEGER          -- delivery bit; ~6 hot SQL paths unchanged
  + member_state TEXT NOT NULL DEFAULT 'active'  -- active | archived | left
  INVARIANT:  active=1  ⇔  member_state='active'
              archived/left ⇒ active=0
  ALTER alias index:
    DROP idx_group_members_alias (WHERE active = 1)
    CREATE UNIQUE … (group_id, alias) WHERE member_state IN ('active','archived')

groups:
  + auto_archive INTEGER NOT NULL DEFAULT 0   -- per-group toggle (cascades)
peers (or a small table):
  + auto_archive override per agent            -- per-agent toggle
```
The launch spec for a resume is read from the existing `launch_intents` row via
`agent_sessions.launch_id`.

### 8.2 Lifecycle state machine (new, pure)

New module `src/lifecycle/archive.ts`, shaped exactly like
`src/launch/lifecycle.ts`:

```text
states: active | archived            (+ deleted handled by existing soft-delete)
events: archive_requested | lease_expired | reaped | resume_requested
        | registered | force_killed | delete_requested
transitionArchive(state, event) -> { ok, from, to, sideEffects[] }
  sideEffects ∈ { reap_backend, reserve_alias, renew_lease, emit_event }
```
Pure, no I/O, fully unit-testable. The daemon applies side-effects and persists
`lifecycle_state`; durable spawn work reuses the existing **`launch_work`** queue.

### 8.3 The three GC/stop guards (the core correctness work)

| Site | File | Change |
|------|------|--------|
| Stop path | `daemon.ts:686-692` | When stop is part of an archive, do **not** `deactivateStoppedLaunchPeer` (soft-delete); set `lifecycle_state='archived'` instead. |
| Retention sweep | `daemon.ts:2127` | Branch: lease-expired + auto-archive ON → archive (reap if AOE); else soft-delete as today. Always **skip** `lifecycle_state='archived'`. |
| Stopped-launch sweep | `daemon.ts:2178` | Exclude archived peers; and fix the multi-launch-per-peer case (see 8.4). |

### 8.4 Multi-launch-per-peer handling

After a resume, a peer owns two `launch_intents` (stopped original + running
resume). Before enabling resume:
- `sweepStoppedLaunchPeers` (`daemon.ts:2178`): must not soft-delete a peer that
  has *any* non-terminal/running launch — gate on the latest launch, not on the
  presence of a stopped one.
- `getLaunchIntentByPeer` (`store.ts:166`, `LIMIT 1`): already orders by
  `updated_at DESC` — confirm callers want the *latest* and document it.

### 8.5 Resume command construction

`src/launch/build.ts buildAgentCommand`: add a resume variant.
```text
claude:  ["claude", "--resume", <host_session_id>, …existing flags]   (never --fork-session)
pi:      ["pi", "--session", <host_session_id|host_session_file>, …]  (NOT -r: that's a picker)
```
Reuse the archived `peer_id` via `ENV_PEER_ID` (already wired, `build.ts:70`).
`--print` / `resume show` emits the same command for the plain-terminal path.

### 8.6 Liveness probe (resume gate, D8)

```text
probeAlive(session):
  AOE (launch_id present & backend)  → backend.list() contains title?
  else                               → process.kill(pid, 0) !== ESRCH
```
The probe runs **on the agent's own host** — v0 is local (`process.kill` /
`backend.list`); the seam is shaped so a per-machine probe slots in for
multi-machine without changing callers. Used by: resume validation (block if
alive), `--force` (re-verify the pid is alive on its machine, then kill),
archive of non-AOE (decide reap vs let-die).

### 8.7 Registration / resurrection (D4)

`upsertPeer` (`daemon.ts:2201`) already clears `deleted_at` + reactivates
memberships. Extend so that, on a register matching an `archived` identity, it
sets `lifecycle_state='active'`, `member_state='active'`, `active=1`. A
**heartbeat/activity** (`daemon.ts:763`, `:797`) must continue to touch the lease
only — lifecycle changes on register, never on heartbeat (D1).

### 8.8 Send guard (C4 / Flow K)

Send paths reject when the sender's `lifecycle_state='archived'` →
`must_reregister`.

### 8.9 CLI / REST / MCP surface

```text
synchronize archive session|group …  [--reason] [--dry-run] [--watch]
synchronize resume   show|launch|group … [--print] [--attach] [--force]
synchronize resume   --list [--state archived] [--group G] [--format json]
```
REST mirrors the CLI: `POST /archive/{session,group}`,
`POST /resume/{session,group}`, `GET /resume/sessions[/:peer]`. Failure codes:
`peer_not_archived, peer_still_live, cwd_missing, alias_reserved_by_archived,
resume_not_launchable, must_reregister, aoe_unavailable`.

**MCP tools** (D13) — admin-style, over the same daemon endpoints, so a managing
agent can run them for the operator:
```text
bridge_archive_session / bridge_archive_group
bridge_resume_session  / bridge_resume_group   (mode: launch | print)
bridge_list_archived
```
Key difference from existing bridge tools: these are **not** scoped to the caller's
own membership — the managing agent may archive/resume a group it does not belong
to. They still go through the same liveness/cwd validation and return the same
failure codes. `--force` is exposed as an explicit boolean arg (never default).

### 8.10 Config (D11)

`groups.auto_archive` (cascades to members at archive-decision time) plus a
per-agent override. v0: a CLI/REST toggle. Web UI: read-only indicator + a
mention-archived toast; no archive browser.

---

## 9. Testing strategy

> Two tiers. Unit tests prove the **logic**; the AOE harness proves the
> **real-agent flows**.

### 9.0 Layered test gates (governing rule)

The epics are a strict layered stack, and testing is the gate between layers —
not an afterthought at the end:

- **Every issue** ships with its own tests (unit and/or harness) green before it
  closes. No issue is "done" on code alone.
- **Every epic** ends with a thorough test pass over its surface, and is complete
  **only when it has fully unblocked the next epic** — every column, contract,
  state-machine event, and seam the next layer needs exists, is tested, and is
  stable.
- **Layering is one-directional.** Each epic builds strictly on the ones before
  it and exposes stable seams for the ones after; a later epic must never have to
  reach back and reshape an earlier one. If it would, that reshaping belongs in
  the earlier epic before this one starts.

This is what makes the dependency DAG real: the test gate at each boundary is the
proof that the next layer can be built on solid ground.

### 9.1 Design-for-test requirements

- **Injectable clock + lease TTL** (already partly supported:
  `LaunchServiceOptions.now`, `SYNCHRONIZE_PEER_RETENTION_MS`,
  `SYNCHRONIZE_SWEEP_INTERVAL_MS`). Tests set a tiny TTL/interval to drive
  lease-expiry deterministically.
- **Injectable liveness probe** so a "live quiet" agent can be simulated without a
  real process (probe returns alive/dead on command).
- **Pure `transitionArchive`** — no daemon needed to exercise every transition and
  every invalid transition.

### 9.2 Unit tests (pure / in-process)

- `transitionArchive`: every legal transition; every illegal one rejected.
- alias index: archived alias blocks join + rename; duplicate `session_name` still allowed.
- invariant: `active` and `member_state` never diverge across archive / resume / sweep.
- sweeper branch: auto-archive ON → archived (not deleted); OFF → deleted; archived always skipped.
- multi-launch: a peer with a stopped + running launch is **not** swept.
- heartbeat / activity on an archived peer does **not** change lifecycle; register does.
- resume gate: `cwd_missing`, `peer_not_archived`, `peer_still_live` (probe = alive).
- send guard: archived sender → `must_reregister`.

### 9.3 AOE harness tests (real Claude + Pi)

- **Faithful resume (claude):** launch → archive (reap) → `resume launch` →
  assert the resumed session has prior context AND the same peer_id / alias / history.
- **Faithful resume (pi):** same via `--session`.
- **Auto-archive (AOE):** tiny TTL → idle → assert archived + tmux reaped + resumable.
- **Implicit resume:** re-register with the same host_session_id → archived → active.
- **Plain-terminal resume:** run the emitted command → reattaches by correlation.
- **Live zombie:** non-AOE alive → resume blocked (`peer_still_live`); `--force` kills + resumes.
- **Reboot proxy:** kill the process → probe flips to dead → resume unblocks.
- **Group resume:** launchable + inspect-only + zombie members → per-member partial status.
- **MCP managing agent:** a non-member agent archives + resumes a group via the
  MCP tools; assert it succeeds and returns the same per-member status as the CLI.

---

## 10. Out of scope for v0 (future work)

- **Archived-retention cleanup.** Candidate axes: time-based (`> 7d`) and
  cwd-based (worktree deleted ⇒ candidate — `cwd` + `git_branch` are captured).
  `archive_source='auto'` lets cleanup spare deliberate archives.
- **Cross-machine restore** (Tailscale / SSH) — planned next (A1). The forward
  model: a machine marker on the agent identity tells the daemon same- vs
  cross-machine. The deeper work it pulls in, recorded now so the seams stay
  ready: (a) **remote spawn** — resume must launch AOE on the *session's* host, so
  the backend seam needs a remote backend; (b) **remote liveness probe** —
  `process.kill` is local-only, so the per-machine probe (§8.6) must report from
  that host; (c) faithful resume must run where the transcript lives (it can't be
  pulled cross-host because Claude keys it by cwd-hash); (d) clock skew across
  hosts for lease/TTL. None block v0.
- **Rich web archive browser / group-resume UI / per-member progress UI.**
