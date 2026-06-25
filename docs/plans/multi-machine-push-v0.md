# Multi-machine push v0: location-gated delivery (no SSE)

> Status: **Planning — scoped for v0 implementation.**
> Tracked under epic `sync-kp1`.
>
> **This is an improved, scope-limited revision of
> [`multi-machine-support.md`](./multi-machine-support.md).** That document's
> Phase 2 proposed a unified `text/event-stream` endpoint, a new
> `EventStreamSubscription` MCP class, a second daemon-side subscriber registry,
> new `delivered_at` semantics, and a six-phase (A–F) rollout. This revision
> deletes all of that from the v0 critical path. It delivers the same
> user-visible outcome — remote Claude receives live messages without manually
> polling the inbox — with a ~10-line change and **zero daemon changes**, by
> using infrastructure that already ships.

## Why the old Phase 2 was over-engineered

The original plan missed one fact about the existing code: **the notification
*channel* is already fully decoupled from the delivery *transport*.**

- `emitMcpNotification(sink, mode, event)` (`src/mcp/notifications.ts`) is the
  *only* thing that decides `notifications/claude/channel` (claude) vs the codex
  logging notification. The transport never touches this.
- Both transports call that same `emit`:
  - `EventSubscription` (`src/mcp/claude-subscription.ts`) — a localhost callback
    server the daemon POSTs to. **Instant, but daemon→client, so it cannot be
    reached across machines.**
  - `NotificationBridge` (`src/mcp/codex-notifier.ts`) — an outbound poll loop on
    `GET /events/:peer_id?cursor=N`. **~0.5–2s latency, but client→daemon, so it
    crosses a tailnet/NAT unchanged.** Already in production for codex and Pi.

So "live push for remote Claude" never needed a new endpoint. It needed the
Claude MCP process to *pick the poll transport when it is remote*. The claude
channel emission is identical either way.

This is proven by a committed test
(`tests/mcp.test.ts` → "NotificationBridge in claude mode delivers on
notifications/claude/channel via outbound poll"): a polling bridge in claude mode,
run through the real `emit`, delivers `notifications/claude/channel`. That exact
combination had never executed before this work; it is now green.

## The single decision that defines v0

> **Local Claude keeps native callback push (instant, no polling). Remote Claude
> uses outbound polling and accepts ~0.5–2s latency.**

Transport is chosen by *location*; the channel is unchanged. One rule:

```
              ┌─────────────────────────────────────────────┐
              │  SYNCHRONIZE_REMOTE_URL set?                 │
              └─────────────────────────────────────────────┘
                       │                        │
                    no │ (local)                │ yes (remote)
                       ▼                        ▼
              EventSubscription           NotificationBridge
              (callback push)             (outbound poll)
              ~instant                    ~0.5–2s
                       │                        │
                       └───────────┬────────────┘
                                   ▼
                    emit(mode, event)  ──►  notifications/claude/channel
                            (identical for both — already true today)
```

Nothing about *how Claude sees the message* changes. Only *how the MCP process
learns about it* changes, and only for the remote case.

## How this extends the existing worktree implementation

This builds directly on what is already shipped on `codex/multi-machine-support`
— it adds one branch, removes nothing, and reuses existing transports.

```
ALREADY DONE in this worktree                 THIS PLAN ADDS
─────────────────────────────                 ──────────────
✓ SYNCHRONIZE_REMOTE_URL client override      + one branch in activatePeer:
  (sync-2bo) — loud-fail, no local spawn         remote claude → NotificationBridge
✓ Mac-hosted daemon + token auth (sync-stn)   + isRemote() helper (reads the
✓ Pi remote delivery via polling                 SAME env var clients already use)
  (proves outbound poll crosses tailnet)      + mode-neutral logging in the bridge
✓ Remote-aware AOE harnesses                   + a cross-machine Claude AOE harness
✓ emit() already channel-parameterized           that asserts live DM with no
✓ NotificationBridge already polls /events        bridge_inbox poll
✓ daemon /events/:peer_id JSON+cursor route    ─────────────────────────────────
                                               Daemon changes: NONE
                                               New endpoints: NONE
                                               New MCP classes: NONE
```

The only code site that changes is the existing transport branch in
`activatePeer` (`src/mcp/tools/register.ts:152`):

```
  BEFORE                                AFTER
  ───────                               ─────
  if (mode === "claude")                if (mode === "claude" && !isRemote())
      → EventSubscription                   → EventSubscription   (local: callback, instant)
  else                                  else
      → NotificationBridge                  → NotificationBridge  (codex always; remote claude)
```

`isRemote()` is `Boolean(process.env[SYNCHRONIZE_REMOTE_URL])` (`ENV_REMOTE_URL`)
— the exact signal `src/client.ts` already uses to point at a remote daemon.

## End-to-end behavior after the change

```
┌── LOCAL Claude (same machine as daemon) ───────────────────────┐
│                                                                │
│   sender ──bridge_dm──► daemon ──INSERT inbox/events           │
│                            │                                   │
│                            └─POST callback──► 127.0.0.1:port   │
│                                                   │            │
│                                                   ▼            │
│                                      notifications/claude/channel
│                                          (instant, push)       │
└────────────────────────────────────────────────────────────────┘

┌── REMOTE Claude (across tailnet) ──────────────────────────────┐
│                                                                │
│   MCP poll loop ──GET /events/:peer?cursor──► Mac daemon       │
│        ▲                                          │            │
│        │ every 0.5–2s (outbound, NAT-safe)        │            │
│        └──────────── events batch ◄───────────────┘            │
│                            │                                   │
│                            ▼                                   │
│              notifications/claude/channel                      │
│                  (0.5–2s, poll)                                │
│                                                                │
│   + durable inbox is always the backstop on reconnect (cursor) │
└────────────────────────────────────────────────────────────────┘
```

## What lives, what dies, what we deliberately do NOT build

```
KEEP (both paths needed)                  DO NOT BUILD (deleted from v0 scope)
────────────────────────                  ────────────────────────────────────
✓ EventSubscription (callback)            ✗ SSE on /events/:peer_id
    → local Claude, instant               ✗ EventStreamSubscription MCP class
✓ NotificationBridge (poll)               ✗ second daemon subscriber registry
    → codex + remote Claude               ✗ delivered_at-for-SSE semantics
✓ requireLocalCallbackUrl                  ✗ A–F rollout + callback/stream burn-in
    → now a CORRECT invariant:
      callbacks are local-only by design
✓ durable inbox = source of truth
✓ event_id = reconnect cursor
```

Side effect worth noting: `requireLocalCallbackUrl` (which rejects non-localhost
callbacks) stops being "a rule to relax" and becomes a *correctly enforced
invariant* — callbacks are, by design, the local-only fast path. Remote sessions
never attempt to register one, so there is nothing to relax.

Reliability note: the poll path is actually **more robust** than the callback.
The callback is fire-and-forget — on a transient failure the daemon drops the
subscriber and recovery requires an explicit inbox read
(`docs/group-sync-integrity.md:400`). The poller auto-recovers from its cursor on
the next interval. Remote Claude trades ~1s of latency for stronger delivery
guarantees.

## Where SSE belongs (explicitly deferred, not discarded)

SSE is not wrong — it is simply not a v0 requirement and not a rewrite. If, later,
many concurrent agents make per-peer polling chatter measurably expensive, or a
sub-second remote latency requirement appears, the move is to **generalize the
SSE the daemon already serves** at `/web/events` (`openWebEvents` / `formatSse` /
`webStateClients`, `src/daemon.ts:2892`) into a per-peer stream. When/if built:
*replace* the transport, do not run a second registry alongside the callback —
that parallel-registry design was the source of the old plan's own listed
double-delivery risk. Until that trigger exists, this stays out of scope.

## Implementation slices (v0)

1. **Gate Claude transport by location.** Add `isRemote()`; branch `activatePeer`
   so remote Claude uses `NotificationBridge`, local Claude keeps
   `EventSubscription`, codex unchanged. Make `NotificationBridge`'s log strings
   mode-neutral (today they read "Codex polling notifier" — misleading once
   Claude shares the path).
2. **Verify cross-machine live push.** A first-class Claude AOE harness scenario:
   sender + recipient Claude sessions across machines, asserting the recipient
   receives a live `notifications/claude/channel` DM **without** any
   `bridge_inbox` poll, plus a reconnect/replay-from-cursor assertion. Subsumes
   the older "verify remote claude poll/inbox fallback" item.

## Out of scope for this plan (tracked separately, unchanged)

- `sync-nxyp` — remote install/sync devex command (orthogonal plumbing).
- `sync-h9h` — web UI bearer-token entry for remote browsers.
- `sync-xl3` — subtle machine indicator in the UI for remote vs local agents.
- Always-on VPS daemon mode; per-machine credentials; UI machine grouping.

## Invariants preserved

- Durable inbox remains the source of truth; live delivery is only transport.
- `event_id` remains the cursor for replay and reconnect.
- The central daemon, `bridge_dm`, durable `events`/`inbox`, and
  `notifications/claude/channel` emission are all unchanged.
- Local Claude latency is unchanged (still native callback push).
