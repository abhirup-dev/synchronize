# High-Performance Design — Web UI on Live Daemon State

Companion to `docs/web-live-daemon-state-plan.md`. The plan defines *what* gets wired; this doc defines *how* to wire it so that v0 is small, honest, and shaped so v0.1 can ship faster paths without a rewrite.

## 1. Purpose & framing

The web UI is the human operator surface onto the agent messaging bus. Smoothness here is not throughput engineering — it is **render correctness under bursty multi-agent traffic on a single localhost**. The performance budget below reflects that, not a generic "scale to 10x" framing.

Governing rule for v0: **ship the smallest design that doesn't paint us into a corner.** Each v0 decision below names what future optimization it preserves the option for.

## 2. Use profile (grounds every decision below)

| Axis | v0 design center |
|---|---|
| Role | Both lurker and participant (60% / 40%). Both paths first-class. |
| Room count | 10–40 active rooms, medium churn (task-scoped groups appear and die). |
| Sidebar liveness | Unread counts tick in real time; preview text updates lazily on focus. |
| In-room burst rate | Conversational: ~1 msg/sec sustained, peaks 3–5/sec. **Not a firehose.** |
| History depth | ~1k messages hot per room, virtualized; `load older` pages back. |
| Threads | Native (schema has `parent_event_id`). Pane-attached. Threads have their own unread track separate from rooms. Focused room **and** focused thread can both be hot simultaneously. |
| Cold start | Shell first, data fills in. |
| Reconnect | Stale content + toast/banner. No blank-with-spinner. |
| Tabs | Single tab is the normal case. Don't engineer for multi-tab. |

This rules out, by construction:

- Streaming backpressure on the wire (the rate doesn't justify it)
- Typed delta SSE protocol (coalesced refetch is cheaper to ship and good enough)
- Cross-tab BroadcastChannel leader election (single tab)
- localStorage hydration of last-known state (overkill for v0 cold start)

## 3. Current data model — what it affords, what it doesn't

Anchored in `src/db.ts`. The web UI lives **inside** the data model that already exists; any limitations here are accepted for v0 and filed as future work in §8.

### 3.1 Tables in play

| Table | Role for the web UI |
|---|---|
| `peers` | Roster + DM endpoints. Soft-deleted (`deleted_at IS NULL` filter). |
| `agent_sessions` | Richer identity (host tool, model, cwd) for the roster pane. |
| `groups` | Room metadata; `durable=0` ephemeral rooms dropped on daemon start. |
| `group_members` | Membership + per-group alias; `active=1` filter. Alias is unique-active per group. |
| `events` | The single source of truth for everything that scrolls: messages, DMs, thread replies (`parent_event_id`), media references. `event_id` is a global autoincrement. |
| `inbox` | Per-peer delivery/read/ack timestamps. Not naturally consumed by a web peer (see §3.3). |
| `media_items` | Media metadata; blobs served separately. |

### 3.2 Indexes already present that the web UI gets to use

- `idx_events_group_event (group_id, event_id)` — paged per-room history is a covered range scan
- `idx_events_recipient_event (recipient_peer_id, event_id)` — DM history by recipient
- `idx_events_group_parent_event (group_id, parent_event_id, event_id)` — **threads are first-class in storage**; thread fetches do not table-scan
- `idx_inbox_recipient_acked_event` — supports per-peer unread counts when needed
- `idx_media_group_created` — per-group media lists

### 3.3 What the schema does **not** afford (v0 accepts these)

1. **No timeline / board / artifacts / tasks / polls.** UI types in `web/src/data/types.ts` define `TimelineEvent`, `Task`, `Artifact`, `Poll`; the schema has none of them. In daemon mode v0 these snapshots return empty arrays. Mock mode remains the design surface for those views.
2. **No web-peer unread state on the server.** The `inbox` table is keyed on recipient peers consumed by MCP/Pi adapters. The web peer is registered but is not a natural inbox consumer. v0 derives unread client-side from a `last_seen_event_id` per room in `localStorage`; the server stays unaware. Trade-off: cross-device unread sync is not possible — fine for single-tab/single-machine use.
3. **Mentions are JSON-encoded.** `events.mentions_json` is a TEXT blob, not an indexed column. A future "@me" inbox view requires a side index; v0 does not need it.
4. **Events table is global, not naturally partitioned by room for snapshot shape.** The current `buildWebState` returns the last N events **across all rooms**, ordered by `event_id` desc. This is the **largest mismatch between the schema's strengths and the current endpoint**: per-room indexes exist but aren't being used. v0 fixes this in §4.2.
5. **Two cursors today.** `ctx.stateVersion` (in-memory, increments on every state change) and `events.event_id` (durable, monotonic, in DB). The redundancy is a v0 cleanup item — `event_id` is the cursor that survives daemon restart and is what `?since=` should accept; `stateVersion` becomes an SSE ordering hint only.

### 3.4 What the schema **does** afford that we should lean on

- **`event_id` is the catch-up primitive.** It's monotonic, durable, and already indexed for every query the UI cares about. No new column or table needed.
- **Threads are first-class.** The thread store is just a different keying — `(group_id, parent_event_id)` instead of `(group_id)`. The same cursor model applies. No new schema needed.
- **`reply_count` / `last_reply_event_id` per event** are already computed by `buildWebState`. The sidebar's "this room has unread thread activity" signal is a cheap derived value.

## 4. v0 architecture

### 4.1 Store shape on the client

**One snapshot per concern, entity-keyed maps, structural sharing.** Subscriptions fire at entity granularity, not whole-tree.

```
peersById:        Map<peer_id, Agent>
groupsById:       Map<group_id, Room>            // + lastSeenEventId from localStorage
membershipsByGroup: Map<group_id, Membership[]>
messagesByRoom:   Map<group_id, Message[]>       // virtualized, paginated
threadsByParent:  Map<parent_event_id, Message[]>// virtualized, paginated
mediaByGroup:     Map<group_id, MediaItem[]>
me:               Agent                          // sticky web: peer
cursor:           number                         // last applied event_id
```

Replacing an entity replaces only that entity's reference. Selectors subscribe to the keys they read. React 19 + `useSyncExternalStore` handles the rest.

**Why this shape:** every UI component already wants per-room or per-thread data; the store giving it to them directly avoids per-render filter passes over a flat array. Aligns naturally with the schema's per-group indexes.

### 4.2 Wire protocol

**Snapshot endpoint, refactored:**

```
GET /web/state?since=<event_id>&room=<group_id>&limit=<n>
```

- `since` (optional): when present, server returns only entities whose `event_id > since` plus a `cursor` of the new max. Bootstraps from the **durable** `event_id`, not the volatile `stateVersion`. Survives daemon restart.
- `room` (optional): when present, restrict event payload to that group's events (uses `idx_events_group_event`). Sidebar uses no-room call for room list + per-room `last_event_id` summary; active room calls with `room=` for its history.
- `limit`: bounded; defaults remain conservative.
- ETag: `W/"<cursor>"`. Client sends `If-None-Match`; daemon returns 304 when nothing changed since.

**This is the single schema/API change v0 makes to existing code.** Everything else is additive. The refactor uses indexes that already exist; no migration.

**Event stream:**

```
GET /web/events
```

Coarse `state_changed` invalidations — same shape as today (`domains`, `event_id`, `group_id`, `peer_id`). The client uses them as **hints to refetch**, not as deltas. Carries `event_id` so the client knows what to ask for via `?since=`.

Headers (already present in current implementation): `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, comment-line heartbeat every 15s. Already correct in `openWebEvents` — leave it.

### 4.3 Client refetch policy

1. **Coalesce.** Invalidations within a 50ms trailing window collapse to one refetch. Multiple `group_id`s in the window → one call per affected room (active room only; inactive rooms just bump their `last_event_id` summary from the SSE payload itself).
2. **Per-domain refetch.** A `peers` invalidation does not refetch events. A `group_id`-scoped event invalidation only refetches that group's events when the room is focused.
3. **Apply under `startTransition`.** Composer + sidebar interactivity stays responsive while the reconcile happens.
4. **Optimistic sends.** Client-generated id, local insert, reconcile on server echo (match by id, replace optimistic with server row). This is the single biggest perceived-smoothness win for the 40% participant case.

### 4.4 Threads

Same model as rooms, different key. `threadsByParent.get(parent_event_id)` is the same shape as `messagesByRoom.get(group_id)`. SSE invalidations carrying a `group_id` for a reply also imply the thread's `parent_event_id` (resolvable from the event row). The thread pane refetches via `?since=` + a future `parent=<event_id>` filter — but **v0 does not need a separate endpoint**; thread replies arrive through the same per-room event query, the client routes them by `parentId`.

Threads have their own unread track: each thread the user has opened gets a separate `last_seen_event_id` keyed on `parent_event_id` in localStorage.

### 4.5 Unread, sidebar, and the focused-surface rule

- **Unread per room** = `count(events in group with event_id > localStorage[`room:${id}`])`. Cheap because the sidebar holds only the last `event_id` per room from `/web/state`, not the messages themselves.
- **Unread per thread** = same idea, keyed on `parent_event_id`.
- **Focused surface** is a *set*: the currently-open room **plus** the currently-open thread pane (if any). Both render full-fidelity. Every other room/thread is reduced to its sidebar summary.

### 4.6 Reconnect

SSE drops → toast banner appears, current state stays visible. On reconnect: client calls `/web/state?since=<last cursor>` with `If-None-Match`. If the `since` is too old (server enforces a max gap), server responds with a full snapshot and a header indicating reset; client clears local state and rebuilds.

## 5. Stack-level cheap wins (apply alongside §4)

Concrete, mechanical, no design risk. Grouped by where in the stack the leverage lives. Each item names the specific React 19 / Bun / `bun:sqlite` / browser feature it taps into — these are features we are *already running* and not using.

### 5.1 React 19 — concurrency features the store should ride

| # | Change | Where | Effort |
|---|---|---|---|
| R1 | Verify `createRoot` (concurrent mode) — required for all the below to time-slice | `web/src/main.tsx` | verify only |
| R2 | `startTransition` wrapping snapshot apply in the data source — composer/typing stays responsive during reconcile bursts | `web/src/data/daemon.ts` | trivial |
| R3 | **`useOptimistic`** for sends — the canonical React 19 primitive for optimistic UI. Replaces the hand-rolled "client-generated id + reconcile on echo" pattern with a hook that auto-reverts on failure | `web/src/components/Composer.tsx` + adapter | small |
| R4 | `useDeferredValue` on sidebar search input + on the active room's message list when an invalidation lands during scroll — keeps input latency flat under load | `Sidebar.tsx`, `ChatView.tsx` | small |
| R5 | `React.memo` on `MessageRow`; `useMemo`-cache rendered markdown keyed `(id, body)` — markdown re-render is the silent killer at higher rates | `MessageRow.tsx` | small |
| R6 | `useTransition` around room/thread switches — keeps the previous room visible until the next one is ready, no flash-of-empty | `App.tsx` | small |

Future option (not v0): **React Compiler / React Forget** would auto-memoize most of R5 — worth revisiting once it's stable, since the codebase is already React 19.

### 5.2 Bun runtime — features the daemon should lean on

| # | Change | Where | Effort |
|---|---|---|---|
| B1 | Module-level `db.prepare(...)` for every hot read in `buildWebState` (peers list, groups, memberships, recent events, media). Bun's `bun:sqlite` reuses the prepared statement across calls — meaningful at 3–5 invalidations/sec | `src/daemon.ts` | small |
| B2 | Set SQLite PRAGMAs on open: `cache_size = -64000` (64MB page cache), `mmap_size = 268435456` (256MB), `synchronous = NORMAL`, `temp_store = MEMORY`. Zero-cost daemon-side speedup for read-heavy `/web/state` traffic | `src/db.ts::openDatabase` | one block |
| B3 | Stream the `/web/state` response body via `ReadableStream` + `JSON.stringify` chunks per domain section, instead of building one big string. Bun's `Response(stream)` path is the same as what SSE already uses | `src/daemon.ts` `buildWebState` + handler | medium |
| B4 | `Bun.file(filePath)` for media blob serving already supports range requests and `If-None-Match` natively — make sure media endpoints return `ETag` based on `sha256` (already in the row) and `Cache-Control: public, max-age=31536000, immutable` since blobs are content-addressed | media routes | small |
| B5 | Hashed asset `Cache-Control: public, max-age=31536000, immutable`; only `index.html` stays `no-cache` | `serveWebAsset` | 1 line |
| B6 | ETag (`W/"<cursor>"`) + 304 on `/web/state` — paired with the `?since=` cursor work in §4.2 | `/web/state` handler | ~10 lines |

Notes on what we are **not** changing:

- **Sticking with SSE, not WebSocket.** Bun supports both, but SSE is right for one-way invalidations; the WebSocket upgrade buys us nothing for this load profile and complicates reconnect.
- **Sticking with one DB connection.** A read-only secondary connection for snapshot reads is a valid optimization, but at ~3–5 invalidations/sec on WAL it's not load-bearing. File it under §8 if measurements ever say otherwise.

### 5.3 Bundler — Bun.build features already paid for

| # | Change | Where | Effort |
|---|---|---|---|
| L1 | `splitting: true` in `web/build.ts` — currently `false`, so every component lives in one chunk | `web/build.ts:36` | 1 line |
| L2 | `React.lazy(() => import("./Markdown"))` boundary — defers `react-markdown` + `remark-gfm` + `rehype-highlight` + `rehype-sanitize` until a markdown message renders | `MessageRow.tsx` | small |
| L3 | `React.lazy` around `PollWidget`, `ThreadPane`, `AgentColorPicker` — none of these are needed for first paint | components + parent | small |
| L4 | Drop `rehype-highlight` default language pack; switch to highlight.js `common` (~30KB vs ~300KB) or lazy-load language modules per detected language | `Markdown.tsx` | small |

L2+L4 together are the largest **single bundle-size win** available without changing a feature — most agent chatter is plaintext or trivial markdown.

### 5.4 Browser-native — features the UI should use before reaching for libraries

| # | Change | Where | Effort |
|---|---|---|---|
| W1 | `content-visibility: auto` + `contain-intrinsic-size: <approx row height>` on `.message-row` — browser-level virtualization-lite; skips layout/paint for offscreen messages with **zero JS**. Pairs with R5; can ship before §5.5 V1 lands | `styles.css` / `extra.css` | 2 lines |
| W2 | `IntersectionObserver` driving "load older" trigger at scroll-top sentinel — cheaper than scroll-position polling | `ChatView.tsx` | small |
| W3 | `requestIdleCallback` for non-urgent work (preview-text recompute, mention re-indexing) | data source | small |
| W4 | `CSS contain: layout style` on message rows + sidebar room items — scopes browser layout invalidation | `styles.css` | small |
| W5 | `EventSource` native reconnect is unreliable across browsers; implement explicit exponential backoff + `Last-Event-ID` header using the `event_id` cursor so the server can replay via `?since=` on reconnect | `daemon.ts` data source | small |

### 5.5 Virtualization (the one library addition v0 needs)

| # | Change | Where | Effort |
|---|---|---|---|
| V1 | `@tanstack/react-virtual` for the message list — keeps DOM nodes bounded regardless of message count. Works for both `ChatView` and `ThreadPane` | `ChatView.tsx`, `ThreadPane.tsx` | medium |

W1 alone helps but does not replace V1 — `content-visibility` skips paint, not DOM construction. At 1k+ messages, the DOM cost itself matters; virtualization is the durable answer.

### 5.6 Explicitly not doing (and why)

- **Brotli/gzip on responses.** Localhost; CPU cost of compression on hot path is comparable to JSON parse savings on the client.
- **HTTP/2 / keep-alive tuning.** Localhost; not the bottleneck.
- **Service Worker / Cache API / IndexedDB.** Single-tab, online-only v0 doesn't need offline semantics.
- **Server-side rendering / hydration.** No Next.js, no SSR runtime — and the dynamic event stream means a pre-rendered shell wouldn't help much. React 19's `use()` + suspense remain available if we ever do.

## 6. Decisions v0 must make explicit (even if naive)

These are policy choices, not engineering effort. They need to be **named** so v0 is honest about its limits.

1. **SSE backpressure.** When the daemon notifier writes to a stalled `webStateClients` subscriber: bounded buffer of N pending changes per client; on overflow, drop the client and let it reconnect with `?since=`. Single line of code; failure to specify wedges the notifier under a paused devtools tab.
2. **Snapshot max-gap before forced reset.** `?since=` accepts catch-up; beyond some delta (e.g. 5000 events) the server returns a full snapshot. Pick a number, document it.
3. **Cross-domain consistency under split refetch.** When `events` refetch references peers not in the current `peers` slice (stale because peers wasn't invalidated), the UI renders an "unknown peer" placeholder until the next `peers` invalidation lands. The placeholder is the contract; we don't try to gap-fill.
4. **What "live" means visually.** Reconnect = stale-with-banner. Cold start = shell-first, data fills in. Two banners (`reconnecting…`, `disconnected — last update Xs ago`) cover both.
5. **Out-of-schema views in daemon mode.** Timeline rail, board, artifacts, polls render empty in daemon mode. Mock mode is the design surface for these until §8 schema work lands.

## 7. What v0 deliberately defers — and what v0's shape preserves

| Deferred | When it becomes worth it | What v0 keeps clean so it's easy |
|---|---|---|
| Typed delta SSE (`message_added`, `peer_renamed`, …) | If burst measurements show coalesced refetch is the bottleneck | Cursor is `event_id`; SSE already carries `event_id`/`group_id` — the upgrade is "include the row payload" |
| Slack-style global "Threads" inbox view | When multi-thread participation is common | Threads already modeled as separate streams keyed on `parent_event_id`; new view is a new selector, no store change |
| Cross-tab consolidation (BroadcastChannel + leader) | If/when multi-tab becomes routine | Sticky web peer in `localStorage` is already shared across tabs |
| Server-side unread tracking for the web peer | When cross-device sync becomes a goal | Client-side `last_seen_event_id` is local-only; no migration needed when a server-side equivalent ships |
| Mention index / "@me" inbox | When mentions become a primary navigation surface | `mentions_json` is already populated; future side-index is additive |

## 8. Future schema work (filed, not v0)

These are improvements to the data model that would make the web UI faster or more capable. **None are required for v0.**

- **Event-kind taxonomy for timeline events.** Extend `events.type` CHECK with `claim | analyze | deliver | ship | review | alert | kickoff | request` (or split into a sibling `timeline_events` table). Unblocks TimelineRail in daemon mode.
- **Materialized `room_summary` view.** `last_event_id`, `last_preview` (truncated), `member_count` per group. Removes per-room subqueries from sidebar paths.
- **Web-peer cursor table.** Per-`(web_peer_id, group_id)` `last_seen_event_id` for cross-device unread sync. Replaces the localStorage scheme additively.
- **Mention side-index.** `event_mentions (event_id, peer_id)` populated on insert; enables fast "@me" queries.
- **Poll / task / artifact event types or sibling tables.** Required to give BoardView and ArtifactsView real data; current UI types in `web/src/data/types.ts` describe a target, not an existing storage shape.

## 9. Out of v0 scope (explicit non-goals)

- Streaming token output per message (would require partial-message events; not a synchronize use case)
- Image uploads from the web composer (already out per `web_ui_overview` memory)
- Message edit/delete (event log is append-only)
- Multi-tab presence reconciliation
- Mobile / responsive < 1024px
- Brotli/gzip on responses (localhost; not the bottleneck)
- HTTP/2 keep-alive tuning (localhost)

## 10. Acceptance for v0

1. Open `/web` cold against a daemon with 20 groups and 1k messages per active group → shell paints in < 200ms, focused room scroll is responsive within 500ms.
2. Sustained 5 msg/sec into focused room for 60s → no dropped frames in the composer; sidebar unread counts update; inactive room previews do not flicker.
3. Pull the daemon (`kill -STOP`/`-CONT`) → toast banner appears within 20s of heartbeat miss; on resume, state catches up via `?since=` without a full refetch.
4. Send a message from the web composer → optimistic bubble appears instantly; reconciles with server echo without visible flicker.
5. Open a thread pane while parent room is receiving messages → both render full-fidelity, neither stutters.
6. `bun test`, `bun run typecheck`, `cd web && bun run typecheck && bun run build` all pass.

## References

- `docs/web-live-daemon-state-plan.md` — companion plan (what gets wired)
- `web/DESIGN.md` — canonical tokens, layout, V0/V1/V2 component scope
- `src/db.ts` — schema (read this before proposing any data-model change)
- `src/daemon.ts::buildWebState`, `src/daemon.ts::openWebEvents`, `src/daemon.ts::emitWebStateChanged` — current wire implementation
- `web/src/data/types.ts` — `DataSource` contract the adapter must satisfy
- Serena memories: `architecture`, `web_ui_overview`
