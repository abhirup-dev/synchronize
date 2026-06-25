# Durable Launch Lifecycle Kernel

Status: v0 plan, branch `codex/launch-lifecycle-plan`. Authored 2026-05-31
after Claude launch stress testing exposed brittle AOE prompt/register/join
behavior. Tracked by `sync-6wlv` and the lifecycle epic created from this plan.

## Goal

Make daemon-managed Claude/Pi launches reliable under sequential and concurrent
load without over-engineering the current local-first architecture. Phase 1 fixes
local AOE launch correctness using a small durable lifecycle kernel owned by the
codebase. Phase 2 adds remote executor support without changing launch semantics.
Phase 3 keeps an upgrade path open for DBOS/Temporal-style durable workflow
infrastructure if remote orchestration grows beyond what the local daemon should
own.

The immediate bug is concrete: an agent can register with the expected
`launch_id` and `peer_id`, but the target group auto-join is lost because the
launch intent lived only in daemon memory. The structural fix is not "more
prompt retries"; it is durable intent, explicit lifecycle state, idempotent work,
and observable failure reasons.

## Aspects We Are Solving

Keep these concerns separate in code and tests:

1. **Correctness.** Launch intent must survive HTTP timeout, daemon restart,
   delayed SessionStart registration, and prompt timing variance. Registration
   with `launch_id` must always have a deterministic reconcile path.
2. **Concurrency.** Multiple launches must not corrupt shared state. Workers need
   bounded concurrency, leases, retries, and idempotency keys.
3. **Latency.** `POST /agent-sessions/launch` should return after durable
   acceptance. AOE spawn and Claude prompt acceptance must not sit inside the
   HTTP request budget.
4. **Observability.** Operators need queryable lifecycle truth:
   `accepted`, `spawning`, `spawned`, `prompt_waiting`, `registered`,
   `joined`, `running`, `registered_unjoined`, `stale`, `failed`, `stopped`.
   Logs are useful evidence, not the source of truth.
5. **Backend abstraction.** Local AOE/tmux is one executor. Future SSH, remote
   synchronize daemon, or hosted workspace executors should report the same
   lifecycle events.
6. **Recovery.** Daemon restart must resume unfinished local work or mark it
   stale/failed with a durable reason. Remote executor disconnects must become a
   lifecycle state, not a confusing live-looking peer row.
7. **UX.** Web state should surface lifecycle and attach/stop commands from
   persisted launch intent. Backend title derivation must not depend on current
   group membership.

## Tooling Decision

Adopt patterns, not a heavy workflow product, for Phase 1.

| Option | Phase 1 decision | Reason |
|---|---|---|
| TypeScript reducer/state machine | Adopt | Small, reviewable, easy to test, keeps domain language in repo. |
| SQLite durable tables | Adopt | Matches local-first daemon and existing runtime model. |
| Transactional outbox/work queue | Adopt | Persist intent and side effects together, then workers claim work. |
| XState | Defer | Useful if transition logic grows, but persistence/work ownership still needs SQLite. |
| DBOS | Future candidate | Natural Phase 3 path if we move to Postgres-backed distributed durable workflows. |
| Temporal | Future candidate | Strong distributed workflow engine, but operationally too heavy now. |
| BullMQ | Do not adopt now | Redis-backed queue is the wrong dependency for the current architecture. |

The codebase should own the launch domain model:

```text
LaunchState
LaunchEvent
LaunchTransition
LaunchIntentStore
LaunchWorkQueue
LaunchExecutor
```

Do not build a generic workflow engine. Build a launch lifecycle kernel.

## Target Architecture

```text
             launch semantics owned by synchronize
        +------------------------------------------+
        | states, events, valid transitions        |
        | durable intent, work, and evidence       |
        +--------------------+---------------------+
                             |
                  implementation evolves
                             |
        +--------------------+---------------------+
        | SQLite now | remote executors | DBOS/Temporal later |
        +------------+------------------+---------------------+
```

Phase 1 local flow:

```text
POST /agent-sessions/launch
        |
        v
+-----------------------+
| launch_intents        |  SQLite source of truth
| launch_id, peer_id    |
| tool, alias, group    |
| backend_title, state  |
+----------+------------+
           |
           v
+-----------------------+       +------------------+
| launch_work           | ----> | local AOE/tmux   |
| spawn/prompt/reconcile|       | Claude/Pi process|
+----------+------------+       +------------------+
           |
           v
+-----------------------+
| launch_events         |  append-only evidence
+----------+------------+
           |
SessionStart with launch_id + peer_id
           |
           v
+-----------------------+       +------------------+
| reconcile lifecycle   | ----> | group_members    |
| idempotent auto-join  |       | events/inbox     |
+----------+------------+       +------------------+
           |
           v
+-----------------------+
| /web/state lifecycle  |
+-----------------------+
```

Phase 2 remote-ready flow:

```text
                controller daemon
                      |
          durable launch_work over HTTP/API
                      |
       +--------------+---------------+
       |                              |
       v                              v
+-------------+                +----------------+
| local AOE   |                | remote executor|
| executor    |                | SSH/daemon/etc |
+------+------+                +--------+-------+
       |                                |
       +---------- lifecycle events ----+
                      |
                      v
           controller advances state
```

## Data Model

Phase 1 introduces three durable tables.

```text
launch_intents
- launch_id TEXT PRIMARY KEY
- peer_id TEXT NOT NULL
- tool TEXT NOT NULL
- session_name TEXT NOT NULL
- alias TEXT NOT NULL
- cwd TEXT NOT NULL
- target_group TEXT
- model TEXT
- thinking TEXT
- args_json TEXT
- backend TEXT NOT NULL           -- local_aoe in Phase 1
- backend_profile TEXT
- backend_title TEXT NOT NULL
- state TEXT NOT NULL
- failure_code TEXT
- failure_message TEXT
- created_at TEXT NOT NULL
- updated_at TEXT NOT NULL
- accepted_at TEXT
- spawned_at TEXT
- prompt_seen_at TEXT
- prompt_accepted_at TEXT
- registered_at TEXT
- reconciled_at TEXT
- joined_at TEXT
- stale_at TEXT
- failed_at TEXT
- stopped_at TEXT
```

```text
launch_events
- event_id INTEGER PRIMARY KEY AUTOINCREMENT
- launch_id TEXT NOT NULL
- kind TEXT NOT NULL
- from_state TEXT
- to_state TEXT
- payload_json TEXT
- created_at TEXT NOT NULL
```

```text
launch_work
- work_id INTEGER PRIMARY KEY AUTOINCREMENT
- launch_id TEXT NOT NULL
- kind TEXT NOT NULL              -- spawn, prompt_confirm, reconcile, probe_stale
- status TEXT NOT NULL            -- queued, running, done, failed
- idempotency_key TEXT NOT NULL UNIQUE
- claimed_by TEXT
- lease_expires_at TEXT
- attempts INTEGER NOT NULL DEFAULT 0
- max_attempts INTEGER NOT NULL
- next_run_at TEXT NOT NULL
- last_error TEXT
- created_at TEXT NOT NULL
- updated_at TEXT NOT NULL
```

The existing `agent_sessions.launch_id` remains the registration correlation
field. The launch table is the durable launch intent; `agent_sessions` is the
observed host-session binding.

## State Machine

The reducer is pure:

```text
current_state + lifecycle_event -> next_state + work_to_enqueue
```

Initial state:

```text
accepted
```

Nominal local launch path:

```text
accepted
  -> spawning
  -> spawned
  -> prompt_waiting
  -> prompt_accepted
  -> registered
  -> reconciling
  -> joined
  -> running
```

Failure and terminal paths:

```text
accepted/spawning/spawned/prompt_waiting -> failed
spawned/prompt_waiting/registered        -> stale
registered/reconciling                   -> registered_unjoined
any non-terminal                         -> stopped
```

`registered_unjoined` is a first-class state, not a vague partial failure. It
must carry a reason such as `alias_collision`, `missing_group`, `join_failed`,
or `peer_mismatch`.

## Phase 1: Local Durable Lifecycle

Phase 1 fixes current AOE launches while preserving the local-first daemon.

In scope:

1. Add the durable launch schema and typed storage helpers.
2. Replace the in-memory pending launch map as source of truth.
3. Add a small pure transition reducer and tests.
4. Make `/agent-sessions/launch` persist intent and return quickly.
5. Add local worker claiming for `launch_work`.
6. Move AOE spawn and Claude prompt confirmation behind work items.
7. Make `reconcileLaunch` load durable intent by `launch_id` and pinned
   `peer_id`.
8. Persist reconcile outcomes and explicit failure reasons.
9. Use `launch_intents.backend_title` for attach/stop derivation.
10. Surface lifecycle state in `/web/state`.
11. Add scripted sequential, three-at-a-time, and five-parallel stress capture.
12. Verify with the preserved runtime at `/tmp/synchronize-sql-live.ULORGu`
    and the in-app browser.

Out of scope:

- Remote executor protocol.
- Postgres/DBOS/Temporal.
- Generic workflow UI.

Acceptance for Phase 1:

- Sequential five-agent launch succeeds or records explicit failure state for
  each agent with no lost intent.
- Three-at-a-time launch succeeds or records explicit failure state for each
  agent with no lost intent.
- Five-parallel launch is characterized with per-launch lifecycle state and no
  unexplainable auto-join miss.
- Daemon restart between accepted launch and registration does not lose the
  target group auto-join intent.
- HTTP timeout cannot orphan a launch intent.

## Phase 2: Remote-Ready Executors

Phase 2 adds remote workspace support without changing Phase 1 semantics.

Add:

```text
executors
- executor_id
- kind                 -- local_aoe, ssh, remote_daemon
- endpoint_json
- capabilities_json
- status
- last_heartbeat_at
```

Remote executors claim work or receive assigned work, run one bounded side
effect, heartbeat while active, and report lifecycle events. The controller
daemon remains the state owner.

Remote executor rule:

```text
claim work -> run one side effect -> report event -> let controller transition
```

No remote executor should directly mutate group membership or infer final launch
state. It reports facts; the controller reconciles.

## Phase 3: External Durable Workflow Backend

Phase 3 is only for scale or operational complexity that justifies it.

Likely paths:

1. **DBOS + Postgres.** Best fit if we want durable workflows and queues without
   a separate workflow server. This replaces work claiming/recovery mechanics,
   not the launch domain model.
2. **Temporal.** Best fit if remote launches become long-running distributed
   orchestration with many workers and strong workflow observability needs. This
   replaces the worker/retry/recovery layer, not the state/event vocabulary.

Phase 1 must keep these seams clean so Phase 3 is an adapter change, not a
rewrite:

```text
LaunchStore
LaunchWorkQueue
LaunchExecutor
LaunchTransition
```

## Verification Strategy

Unit tests:

- reducer valid transitions and invalid transitions
- idempotent event handling
- launch store insert/update/query helpers
- work queue claim/lease/retry behavior
- backend title lookup from persisted launch intent

Integration tests:

- register after durable launch auto-joins group
- register after daemon restart still auto-joins group
- peer_id mismatch preserves/reports intent
- alias collision becomes `registered_unjoined`
- stop by peer uses persisted backend title
- stale backend session becomes `stale`, not indefinitely live

Live e2e:

- Use throwaway `SYNCHRONIZE_HOME` for scripted stress.
- Use preserved runtime `/tmp/synchronize-sql-live.ULORGu` only when explicitly
  validating continuity with the observed failure.
- Validate `/web/state` lifecycle in the in-app browser.
- Capture sequential, three-at-a-time, and five-parallel outcomes.

## Implementation Guardrails

- Do not make prompt acceptance a correctness boundary.
- Do not let in-memory maps be the source of truth.
- Do not let a remote executor own final group membership state.
- Do not derive backend titles from current group membership.
- Do not adopt a generic workflow framework before the local lifecycle kernel is
  too complex to maintain.
- Keep every side effect idempotent and safe to retry after a crash.
