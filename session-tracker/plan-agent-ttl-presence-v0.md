# Plan — Agent TTL & 3-state presence (v0)

> Status: design approved (grill session 2026-05-29). Branch `feat/agent-ttl-presence`.
> Supersedes the lease-tuning portion of `sync-6mz` and adds an activity-presence layer on top.

## Problem

Today peer liveness has two competing death signals:

- `lease_expires_at` — heartbeat-driven, defines "online right now". Default lease is **7 days**.
- `deleted_at` — explicit `DELETE /peers/:id` from clients, defines "peer ceased to exist".

Two concrete failures:

1. **Dead agents look online for a week.** A crashed Pi/Claude process keeps its row with a fresh-enough 7-day lease, so the roster shows long-dead agents as online. This is the headline complaint.
2. **Explicit-delete is a footgun.** Clients have many shutdown-*like* signals (stdin close, Pi `session_before_switch`, second-launch env-borrowed `SYNCHRONIZE_PEER_ID`, Claude `SessionEnd(reason=resume|clear|compact)`) that do **not** mean "the agent is gone". Tying deletion to any of them makes the daemon's truth diverge from real liveness. Each past fix (soft-delete `sync-dmc`, removing Pi `session_before_switch`, the borrowed-peer guard in MCP `cleanup()`) was incremental whack-a-mole around this root cause.

## Core insight: two knobs, not one

"Online accuracy" and "TTL" are different concerns:

- **Liveness lease** (drives the online indicator) — wants to be *short* (a few missed heartbeats). Crash → offline within ~a minute.
- **Retention** (how long a dead peer lingers in the roster before being swept) — wants to be *long* (~1 day) for audit / "who was here" / reclaim trails.

Neither runtime fires a reliable hook on crash/SIGKILL (Claude `SessionEnd` explicitly excludes crash; Pi `session_shutdown` only runs on clean exit). **Therefore the heartbeat lease is the *only* reliable `offline` detector.** Everything else (clean-exit signals, resume) is unreliable and must not be load-bearing.

A 3-state presence model (`working` / `idle` + `offline`, with a transient `initializing`) sits **on top of** the lease: hooks supply the *online sub-state*; the lease supplies *offline*. You cannot build the presence layer without the lease foundation.

## Verified runtime facts (do not re-derive)

- Heartbeat interval is 15s in both runtimes (`HEARTBEAT_MS`, `MCP_HEARTBEAT_MS`).
- "online" is already derived as `lease_expires_at > now` at ~6 read sites in `daemon.ts`.
- Resume is identity-safe: `daemon.ts:435` resolves `peerId = requestedPeerId ?? findPeerByHostSession(hostTool, hostSessionId) ?? randomUUID()`. Claude `--resume` reuses the same `session_id`, so `findPeerByHostSession` returns the same peer; the SessionStart hook re-upserts it with a fresh lease (`ON CONFLICT … deleted_at = NULL`). No duplicate, no flicker, revives even after offline.
- Pi event surface (`@earendil-works/pi-coding-agent` docs/extensions.md): `agent_start`/`agent_end`, `turn_start`/`turn_end`, `tool_execution_*`, `before_provider_request`, `input`, plus `ctx.isIdle()`. `agent_start` fires for **any** input source incl. synchronize `steer`/`followUp` injections.
- Claude hook surface: `SessionStart`, `UserPromptSubmit`, `PreToolUse`/`PostToolUse`, `Stop`, `SessionEnd`, `Notification`/`PermissionRequest`. `UserPromptSubmit` fires for **human** prompts only — synchronize channel input arrives via `notifications/claude/channel` and does **not** fire it. Hooks are shell commands receiving JSON on stdin.

## Decisions (locked)

### Lease / offline

- `DEFAULT_LEASE_MS` → **60s** (4 missed beats). Env-overridable via `SYNCHRONIZE_LEASE_MS`.
- `web` peers keep an **infinite** lease (existing `WEB_PEER_LEASE_EXPIRES_AT`). Demo-seeded peers routed to a far-future lease via `leaseExpiresAtForTool` so `make demo` doesn't flap.
- **Offline is lease-only.** No instant-offline push on clean shutdown — that path depends on unreliable signals (`SessionEnd(reason=resume/clear/compact)`) and would false-offline a resuming/compacting session. Clean exit, crash, and resume-gap all converge on the 60s lease lapse. Machine sleep flaps everything offline and self-heals on wake — accepted as correct.

### Footgun removal

- Remove `deletePeer` from Pi `teardownProcess` (`extensions/pi-synchronize/src/index.ts`) and MCP `cleanup()` (`src/mcp/lifecycle.ts`). Death becomes the absence of heartbeats.
- Keep `DELETE /peers/:id` as an **operator-only** tool (web-UI manual evict). Never called by normal client code. Skills must not instruct agents to call any delete tool.

### Retention / sweeper

- Daemon-internal **hourly** tick soft-deletes (`deleted_at`) peers whose lease has been expired for **>24h**.
- Audit trail preserved (soft-delete per `sync-dmc`); `include_inactive=true` (`sync-235`) can still surface swept peers.
- Resume-after-sweep resurrects the same peer (`findPeerByHostSession` + `ON CONFLICT … deleted_at = NULL` must still match a soft-deleted row). A resume is the same session even a day later.

### Presence states

- Stored column `peers.activity_state TEXT` *nullable*: `'initializing' | 'working' | 'idle'`. `NULL` = uninstrumented.
- `peers.last_activity_at TEXT` *nullable*.
- Presence derived in reads: lease expired → `offline`; else `activity_state` if set; else `online` (generic — covers web/codex/cli, backward-compatible with today's binary online).
- `initializing` is **sticky**: set on register, stays until the first activity event (no auto-resolve). A registered-but-never-active agent legitimately shows `initializing`.
- `waiting_input` (Claude permission prompts), tool-level granularity, and codex instrumentation are **deferred** — out of v0.

### Activity transport

- New endpoint **`POST /peers/activity`** accepting either `{peer_id, state}` or `{host_tool, host_session_id, state}` (resolved server-side via `findPeerByHostSession`). Sets `activity_state` + `last_activity_at` **and refreshes the lease** (activity is proof-of-life).
- Kept separate from `sync-6gp`'s operator `PATCH /peers/:id` (different auth, cadence, concern).
- **No debounce.** Daemon UPDATE is idempotent. **Last-write-wins**; out-of-order sequencing de-prioritized for v0.

### Event → state mapping

| | working | idle |
|---|---|---|
| **Pi** | `agent_start` | `agent_end` |
| **Claude** | `UserPromptSubmit` ∪ MCP-adapter-on-channel-delivery ∪ `PreToolUse` | `Stop` |

- Pi is input-source-agnostic (`agent_start` fires for channel injections too).
- For Claude, the **MCP adapter pushes `working` when it delivers an inbound channel event** to its peer — this is the load-bearing signal for synchronize-channel input, which `UserPromptSubmit` misses. `PreToolUse` is belt-and-suspenders.
- Schema grain: `activity_state` lives on **`peers`**, not `agent_sessions` (presence is per-peer; web/codex/cli are peers too).

## Work units

### Unit 1 — Foundation (≈ `sync-6mz`, independently shippable)

1. `DEFAULT_LEASE_MS` → 60s + `SYNCHRONIZE_LEASE_MS` env override.
2. Route `web` + demo-seeded peers to a long lease in `leaseExpiresAtForTool`.
3. Remove `deletePeer` from Pi `teardownProcess` and MCP `cleanup()`; keep `DELETE /peers/:id` operator-only.
4. Hourly internal sweeper (soft-delete after 24h offline).
5. Fix test fixtures that assume long-lived online peers (grep `online` assertions).

Acceptance: Pi/Claude process exit (kill, OOM, clean) → offline within the lease window. Resume re-registers the same peer with a fresh lease. Web UI sidebar doesn't flap on Pi session rotations. `make demo` roster stays alive.

### Unit 2 — Activity presence (new epic, on top of Unit 1)

1. Migration v3: `peers.activity_state` + `peers.last_activity_at` (both nullable).
2. `POST /peers/activity` endpoint (peer_id or host-session; sets state + last_activity_at + refreshes lease).
3. Presence derivation at the ~6 `online`-computing read sites: `offline | initializing | working | idle | online`.
4. Pi wiring: `agent_start`→working, `agent_end`→idle.
5. Claude: extend `scripts/claude-hooks-config.ts` to install `UserPromptSubmit`/`PreToolUse`/`Stop` hooks; add `synchronize hook activity --state=<s>` CLI subcommand (reads `session_id` from stdin JSON, POSTs host-session form). MCP adapter pushes `working` on channel delivery.
6. Web UI: render the states (initializing/working/idle/online/offline).
7. Integration tests: state transitions per runtime + offline-on-lease-lapse + resume revival.

## Deferred (explicitly out of v0)

- `waiting_input` state (Claude `Notification`/`PermissionRequest`).
- Tool-level activity detail ("running tool X").
- Out-of-order activity sequencing / monotonic sequence numbers.
- Codex activity instrumentation (codex being deprecated).

## References

- `sync-6mz` — heartbeat-only peer lifecycle (this plan is its authoritative design).
- `sync-dmc` — original soft-delete work (migration v2).
- `sync-6gp` — operator `PATCH /peers/:id` (kept separate).
- `sync-235` — `include_inactive=true` (surfaces swept peers).
- `session-tracker/plan-advanced-synchronize-registering-hooks.md` — `agent_sessions` binding + SessionStart hook flow.
