# Web Multi-Tab Popout And Cross-Tab Sync v0

Status: planned (2026-07-04). Beads: epic `sync-ah0u`; phases `sync-5r0s` (popout surface), `sync-qvkn` (server drafts), `sync-ul74` (session peer_id).

## Goal

Let the user open any room or thread as its own browser tab ("popout") and have
all tabs stay in sync — including the message composer draft — while keeping the
implementation future-proof for (a) multiple human web users and (b) the planned
Tauri desktop shell with in-app tabs.

Guiding principle: **the daemon is the sync layer; a tab is a dumb,
URL-addressable view.** Nothing about cross-tab sync lives client-side
(no BroadcastChannel, no SharedWorker, no leader election). Anything that must
be visible to "another window" must live in the daemon and ride the existing
SSE invalidation channel. This is exactly the multi-user shape (a second user
is just another SSE client with a different peer id) and exactly the desktop
shape (Tauri in-app tabs each mount a URL against the same daemon).

## Current State

Facts established 2026-07-04 from master:

- Deep links are path-based, no router: `/web/e/:id` (event), `/web/t/:id`
  (thread-root alias), parsed in `web/src/deeplinks.ts`, resolved via
  `GET /web/resolve` (`src/daemon/routes/web.ts` → `resolveWebDeepLink`).
  Wired in `App.tsx` on mount + `popstate`; always hydrates into the full shell
  (sidebar + chat). There is no room-level deep link and no standalone view.
- Live updates are SSE (`GET /web/events`, `src/daemon/services/web-events.ts`)
  carrying thin invalidation signals `{cursor, type, domains[], ...}` — clients
  refetch `/web/state` (+ affected rooms) on change, coalesced 50ms. The daemon
  already fans out to every connected client, so **cross-tab message sync
  already works**: tab A sends → state change → SSE broadcast → tab B refetches.
- Every web tab registers as the singleton peer `web:local-human`
  (`POST /web/session` → `ensureLocalWebPeer`, `src/daemon/repo/peers.ts`).
  Server-side read-state (inbox acks) is therefore already shared across tabs.
  This singleton is also the hard blocker for real multi-user later.
- Composer drafts are ephemeral `useState` in `web/src/components/Composer.tsx`
  — no localStorage, no server persistence, nothing syncs. Exception: file
  attachments already stage server-side (`POST /web/attachments`).
- Each tab holds its own `DaemonDataSource` (`web/src/data/daemon.ts`) with one
  SSE stream + one 2s fallback poll. N tabs = N streams; acceptable against a
  localhost daemon (dedup via SharedWorker is a future upgrade, not v0).
- Desktop: Tauri v2 plan on `feat/macos-desktop` already chose in-app tabs
  (one webview, one daemon connection) over native windows. The
  `feat-macos-desktop` worktree also holds an **uncommitted** working spike
  (`desktop/src-tauri/`, sync-c61.1) whose `lib.rs` discovers the daemon via
  `~/.synchronize/daemon.json` and points the webview at `<baseUrl>/web`
  (load model A) — confirming the webview loads the daemon's served SPA URL,
  so the URL contract below is the entire desktop-tab integration surface. Mobile (`mobile/`, Capacitor)
  reuses the same web bundle; nothing here needs mobile-specific work.

## URL Contract

Two additions to the existing scheme, both parsed in `web/src/deeplinks.ts`:

1. **Room deep link**: `/web/r/:roomId` — open a specific room. Resolved by
   extending `GET /web/resolve` (or short-circuiting client-side when the room
   is already known from `/web/state`; server resolve keeps behavior uniform
   with `/web/e/` and validates existence/archival).
2. **Standalone view param**: `?view=pane` on any of `/web/r/:id`, `/web/e/:id`,
   `/web/t/:id`. With `view=pane` the app mounts only the relevant surface —
   chat pane for a room/event, thread pane for a thread — no sidebar, no shell
   chrome beyond a minimal header (room name, link back to full shell).

Rules:

- `view=pane` is a layout mode, not a different app: same `DaemonDataSource`,
  same SSE connection, same deep-link hydration path. It only changes what
  `App.tsx` renders.
- In-pane navigation that would leave the surface (e.g. clicking through to
  another room) navigates the tab to the full-shell URL for the target rather
  than growing the pane into a second shell.
- URL normalization after hydration (`history.replaceState`) preserves
  `view=pane`.

## Web App Changes

- `deeplinks.ts`: parse `/web/r/:id` and the `view` query param; deep-link
  result gains `{view: "shell" | "pane"}`.
- `App.tsx`: a `viewMode` derived from the deep link. `pane` mode renders
  ChatPane or ThreadPane directly (reusing the exact components the shell
  mounts — no forked pane components), skipping sidebar/activity chrome.
- **Open-in-new-tab affordances**: context/hover action on sidebar room rows
  ("Open in new tab" → `window.open('/web/r/:id?view=pane')`) and on thread
  headers ("Open thread in new tab" → `/web/t/:rootId?view=pane`). Plain
  `<a target="_blank">`-style semantics so cmd-click etc. work natively.

## Daemon Changes: Per-Peer Drafts

New durable state so composer drafts sync across tabs (and later, per user):

- SQLite table `drafts (peer_id, room_id, body, updated_at, PRIMARY KEY
  (peer_id, room_id))`. Empty-body save deletes the row.
- Routes: `GET /web/drafts` (all drafts for the session peer),
  `PUT /web/drafts/:roomId` `{body}`. Both take the peer from the web session
  — **no hardcoded `web:local-human` in the new code paths**; the session
  layer resolves the peer id and the drafts code is keyed by it.
- SSE: broadcast `state_changed` with a new domain `drafts` (+ `room_id`) on
  draft writes, via the existing `emitWebStateChanged` fan-out.
- Drafts are metadata, not messages: no events-table rows, no inbox entries.

## Composer Changes

- On room focus, hydrate the draft from the store (fetched via `/web/drafts`,
  kept fresh by the `drafts` SSE domain).
- Save debounced (~500ms) on typing; flush on blur/room-switch/send (send
  clears the draft server-side).
- **Echo suppression**: a tab ignores incoming draft updates for the room whose
  composer is currently focused/being typed in (last-writer-wins is fine for
  v0; two humans concurrently editing the same draft is out of scope until
  multi-user exists). A background tab applies incoming drafts directly.
- Staged attachments already live server-side; v0 does not sync the
  attachment *selection* across tabs (draft body only).

## Multi-User Future-Proofing (constraints, not features)

- All new state keyed by `peer_id`; peer id comes from the web session
  response, never assumed.
- `POST /web/session` response includes the resolved `peer_id` if it doesn't
  already, so the client carries an explicit identity.
- No client-side cross-tab channels that would bypass the server.
- Explicitly **not** in v0: per-user sessions/auth, presence, typing
  indicators, concurrent-edit merge for drafts.

## Storybook Scope

Per `docs/agents/storybook-ui.md` wiring conventions (shared shell cells,
`shellLayout` traits — read before implementing):

- Pane-mode mounting expressed as a `shellLayout` trait on the existing shell
  stories, not duplicated per-view stories.
- Composer stories gain a hydrated-draft state (draft present on mount) and a
  draft-update-while-focused state (echo suppression visible).

## Bun/API Test Scope

- `tests/`: drafts CRUD (put/get/delete-on-empty), peer scoping (drafts keyed
  by peer, invisible to other peers), SSE `drafts` domain emitted on write.
- Deep-link resolver: `/web/resolve` handles room ids; unknown/archived room
  behavior matches existing event-id behavior.
- Existing deep-link tests extended for `view=pane` parse/normalize.

## Rollout Phases

1. **Popout surface** — room deep link + `view=pane` layout + open-in-new-tab
   affordances. Pure view work; no schema change. Ships alone: cross-tab
   message sync already works via SSE.
2. **Server drafts** — daemon table/routes/SSE domain + composer wiring.
   Depends on nothing in phase 1 technically, but lands second so the popout
   flow exists to exercise it.
3. **Session identity surfacing** — `peer_id` in the session response +
   audit that new code paths take peer from session. Small; can ride along
   with phase 2.

## Size Estimate

- Phase 1: ~200–350 LOC (deeplinks parse, App layout branch, affordances,
  resolver extension, stories/tests).
- Phase 2: ~250–400 LOC (migration, repo/routes/service, composer wiring,
  tests, stories).
- Phase 3: ~30 LOC.

## Risks And Open Questions

- Echo suppression heuristics: "focused composer ignores remote drafts" can
  feel wrong if a user types in tab A, switches to already-open tab B whose
  composer was focused. Mitigation: also apply remote drafts when the local
  composer is pristine (empty and untouched since hydrate).
- `view=pane` interaction with responsive compact shell
  (`web-responsive-compact-shell.md`): pane mode should reuse the compact
  breakpoints rather than defining a third layout.
- Draft write volume: 500ms debounce against localhost SQLite is trivial, but
  every write triggers an SSE fan-out + `drafts` refetch in other tabs; keep
  the refetch scoped to the drafts domain (do not invalidate room state).

## Non-Goals

- SSE connection dedup across tabs (SharedWorker/leader election) — upgrade
  path if tab counts ever hurt; localhost makes it moot today.
- WebSocket migration, typing indicators, presence.
- `Room.unread` implementation (currently hardcoded 0) — separate feature.
- Multi-user auth/sessions — this plan only avoids deepening the singleton.
- Desktop/mobile code — the URL contract is the deliverable they consume.
- Cross-tab sync of attachment selection or scroll position.
