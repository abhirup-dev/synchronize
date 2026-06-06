# Web Activity View — global cross-room feed

Status: planned (2026-06-06). Branch: `feat/web-activity-view`.
Design source: Claude Design handoff bundle (`activity.jsx` / `activity-item.jsx` /
`activity-app.jsx` / `activity-data.js`, `styles.css` `act-*` block). Chats: the
user landed on **Digest layout + Row items + a Grouped⇄Timeline toggle**; the
other explored variants (Sections/Lanes/Card/Ticket) are intentionally dropped.

## Purpose

A compact, high-level place to see which threads are active, where agents are
working, and to hop into / multitask across threads — a global, cross-room feed
that lives above Groups in the sidebar with an "awaiting you" count badge.

## Decisions (resolved in a performance-focused grill)

1. **Deliverable** — plan, then implement on this branch.
2. **Data** — derive from *real* data in both `MockDataSource` and
   `DaemonDataSource`. No curated mock-only array in the real path.
3. **Variants shipped** — Digest (grouped, collapsible) + Row item + the
   Grouped⇄Timeline toggle. No Sections/Lanes/Card/Ticket, no Tweaks panel.
4. **Daemon backing** — a dedicated endpoint
   `GET /activity/:peerId?cursor&limit&filter` over `inbox ⋈ events`. The inbox
   already materializes a per-peer cross-room feed at write time (fan-out on
   every group_message/dm/media_shared), so the read is one ordered index range
   scan — *not* an N-per-room fan-out. Parallel/async per-room fetching was
   rejected: the bottleneck is a single B-tree range scan already `O(limit)`;
   parallelism adds round-trips + a client merge-sort + SQLite/event-loop
   contention for zero throughput gain. Parallelism is reserved for lazy
   enrichment (e.g. on-demand thread summaries), not feed assembly.
5. **Awaiting you** — server-authoritative via `inbox.acked_at IS NULL` (was
   client-side Sets in the mock; lost on reload). Cleared by **react** (acks the
   event), **reply** (acks the thread parent + the replied-to event), and
   **Mark all handled** (bulk-ack all pending). Open / jump / scroll do **not**
   ack — awaiting ≠ unread.
6. **Liveness** — SSE-driven. On a `/web/events` change touching
   `events`/`messages`/`inbox`, fetch only `event_id > lastCursor`, prepend, and
   flash `is-new`. No activity polling timer; fall back to the existing `pollMs`
   loop only if SSE drops.
7. **Render** — `ActivityItem` is `React.memo`'d (re-renders only on
   id/awaits/reacted change) so an SSE prepend mounts only new rows. Flat
   Timeline uses TanStack Virtual (already a dep). Digest renders collapsed
   rooms header-only and caps expanded rooms at N with "show more". Window =
   `limit 80` + cursor "load older"; in-memory ring cap ~500.
8. **Filters** — `awaiting` pushed down to the daemon (`acked_at IS NULL`,
   exact + complete). `all` / `mentions` / room filter applied client-side over
   the fetched window (mentions = literal `@me`; older items load on demand).
9. **Item taxonomy** — the daemon emits no work-event categories yet
   (`claim/deliver/ship/review/analyze/task` do not exist; real types are `dm`,
   `group_created/joined/left`, `group_message`, `media_shared`, `media_changed`,
   `group_member_*`). For now **club everything under one generic type**, but
   keep the seam **forward-compatible**: a `type`-keyed icon/meta map +
   pass-through of `event.type` and a future `category` column, so new work-event
   categories slot in as pure data with no structural change. `mention` and
   `reply` stay as derived *flags* (mentions_json includes me; `parent_event_id`
   set) driving the Mentions filter and awaiting logic.
10. **Feed scope** — inbox-backed (others → me): every event fanned to the peer
    across rooms + DMs (all other agents' activity in the peer's rooms; excludes
    only the peer's own sends).

## Data contract

```ts
// web/src/data/types.ts (new)
export interface ActivityItem {
  id: string;            // event id (stringified)
  eventId: number;       // numeric cursor key
  roomId: string;        // group or dm room id
  actorId: string;       // sender agent id
  type: string;          // forward-compat; single generic kind for now
  text: string;          // markdown body / preview
  createdAt: string;     // ISO
  awaiting: boolean;     // inbox.acked_at IS NULL (server-derived)
  isMention: boolean;    // mentions_json includes me
  threadParentId?: string;
  replyCount?: number;
  msgId: string;         // for jump-to-message
  isNew?: boolean;       // transient: just arrived via SSE
}

// DataSource additions
activity(): Snapshot<ActivityItem[]>;
activityAwaitingCount(): Snapshot<number>;
ackActivity(input: { eventId: number }): Promise<void>;
ackAllActivity(): Promise<void>;
loadMoreActivity(): Promise<void>;   // cursor "load older"
```

## Work breakdown (bd epic + slices)

- **Daemon: inbox index + `/activity` endpoint** — add inbox index
  `(recipient_peer_id, event_id)`; `src/api/activity.ts` returning enriched rows
  (event + group + sender + awaiting flag + reply count) in one query; wire route
  in `daemon.ts`.
- **Daemon: ack writes** — react sets `acked_at` for (me, event); reply acks
  parent + replied event; `POST /activity/:peerId/ack` (single) and
  `/ack-all` (bulk). Reuse existing reaction + message-send paths.
- **Web data layer** — `ActivityItem` type + `DataSource` methods; `api/activity.ts`
  client; `DaemonDataSource` activity snapshot (fetch, SSE incremental prepend,
  ring cap, ack writes); `MockDataSource` + `seed.ts` real-shape aggregation +
  in-memory ack parity; `useActivity` hooks in `context.tsx`.
- **`ActivityItem` (Row)** — port the row variant only: marker, author chip,
  verb, preview (Markdown), room chip, reply count, awaiting bar/dot, react +
  jump actions, context menu. `React.memo`. Forward-compat `actMeta(type)` map.
- **`ActivityView`** — header (title, live `▸ N working`, Mark all handled),
  filter tabs (All/Awaiting/Mentions), Grouped⇄Timeline toggle, multi-select
  room filter bar (fit + "+N more" panel), Digest grouped layout, flat Timeline
  + "MOST RECENT" strip, awaiting logic, load-older, thread side-pane reuse
  (`ThreadPane` + `ResizeHandle`), jump-to-room.
- **Sidebar + Shell** — top-level Activity nav item above Groups with awaiting
  badge; `App.tsx` route `activeId === "activity"`, jump-to-room (switch room +
  scroll/flash message), badge wiring, thread-pane reuse.
- **CSS** — port the `act-*` block (Digest/Row/Timeline subset) into
  `web/src/components/extra.css`, reconcile tokens, responsive (compact shell),
  dark theme.
- **Tests** — `tests/` integration: mock activity aggregation ordering, filters,
  ack clears awaiting (react/reply/mark-all), load-older, awaiting count.

## Forward-compat note

When the daemon gains real work-event categories, add a `category` column to
`events` (or reuse `type`), surface it in the `/activity` row, and add entries to
the client `actMeta(category)` map. No change to `ActivityView`, the snapshot
plumbing, or the ack/awaiting model is required.
