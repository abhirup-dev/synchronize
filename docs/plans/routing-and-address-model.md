# Routing And Address Model

Status: IMPLEMENTED (branch feat/routing-contract)
Owner: abhirup
Branch: `feat/routing-contract` — stacked on `feat/dx-foundations`
Epics: `E` addresses, `F` router foundation, `G` surface migration, `H` product and data contracts

## Prerequisite

`docs/plans/coupling-leaks.md` on `feat/dx-foundations` must land first. It
establishes the frame this plan builds on — ORIGIN and RUNTIME as deployment
axes, BASE and ROUTE as contract layers — and delivers the pure
`web/src/routing/address.ts` module that becomes the route tree here. A router
introduced before that decoupling encodes the coupling into route definitions.

Supersedes the addressing portion of `docs/plans/web-url-deep-links.md`
(sync-vbd6). Revises `docs/plans/web-multi-tab-popout-v0.md` (epic sync-ah0u) —
see *Popout reconciliation*.

## The route grammar

Three categories, deliberately distinct.

```text
  ADDRESSES — canonical, stable, portable. This is what a WINDOW IS.

    /web/g/:publicId         a group
    /web/d/:peerId           a direct message
    /web/t/:eventId          a thread

  RESOLVERS — pointers. They redirect once, then replaceState to the canonical
              address. Nothing new emits them except share affordances.

    /web/e/:eventId          "this message"
    /web/g/by-name/:name     group by name — the form an agent constructs from
                             what it already has (bridge_send_group takes a name)
    /web/r/:roomId           legacy room id
    ?event=:id               compatibility form

  MODIFIERS — query parameters, orthogonal to the address.

    ?view=pane               WINDOW ROLE. Set when the window opens, never
                             changes. Part of the address. pushState.
    ?focus=:messageId        EPHEMERAL navigation state. replaceState only.
```

`?focus=` uses `replaceState` so the back button moves between rooms rather than
between scroll positions.

## Identifiers

```text
  identifier      basis                               role
  ────────────────────────────────────────────────────────────────────────
  group public_id to be added:                        ADDRESS
                  public_id TEXT NOT NULL UNIQUE      opaque, rename-safe,
                  generated at creation                collision-loud

  peer_id         src/daemon/routes/peers.ts:26       ADDRESS
                    crypto.randomUUID() when the       opaque, stable across
                    caller omits one                   sessions, collision-loud
                  src/cli/identity.ts:16-19 reuses
                  per (session_name, tool)

  group name      src/db.ts:80 — UNIQUE               RESOLVER
  session_name    no unique index on the peers table  RESOLVER
  roomId          src/db.ts:79 — AUTOINCREMENT        RESOLVER
```

### Why addresses must be opaque

An address is pasted into durable places — messages, bookmarks, agent memory —
and read back in a different runtime than it was written in. The multi-worktree
workflow makes cross-runtime paste routine, so the address format has to
determine what happens then:

```text
  autoincrement ids collide by construction.
      dev has group 1. production has group 1. Both always do.
      Pasting across runtimes opens a DIFFERENT ROOM with no error.

  opaque random ids do not collide.
      dev has g_7f3a9c2. production does not.
      Pasting across runtimes yields a clean not-found.
```

A not-found is a correct answer. A plausible-looking wrong room is not.

Group name is additionally unsuitable as an address because it is mutable in
principle — a future rename either breaks every existing link or, worse, frees
the name for a new group that old links then resolve to — and because ephemeral
group names already recycle (`src/db.ts:835` deletes `durable = 0` rows at
startup). Name remains available as a resolver, which is what agents need.

## Router: TanStack Router

The routing primitive is TanStack Router. Three properties of this product
require it:

```text
  1. The URL is a state container, not a pointer. Boards, artifacts, the agent
     management panel and archive/resume views are each independently
     addressable and embeddable, so the URL describes what is mounted.

  2. Data loading is per-address, with pending, error and cancellation states.
     Loaders are the one part of this that is difficult to write correctly by
     hand, because of cancellation races.

  3. Addresses nest. /web/g/:publicId/board/:boardId and
     /web/agents/:peerId/archive compose a layout with a leaf surface.
```

### Conversion from `address.ts`

```text
  address.ts                      route tree
  ──────────────────────────────────────────────────────
  Address union member      ->    one route definition
  parse() path matching     ->    route path + params
  modifier parsing          ->    validateSearch schema
  resolver -> replaceState  ->    loader + redirect()
  BASE constant             ->    basepath config
```

### Nested layouts carry the chrome

```text
  __shellLayout      rail + rooms + surface
      /g/:publicId  /d/:peerId  /t/:eventId  /boards/:id  /agents  ...
  __paneLayout       bare, chrome-less
      the SAME leaf routes

  One leaf definition per surface. Chrome is determined by which layout parent
  matched, so "same surface, two chromes" is structural rather than conditional.
```

### The choreography this replaces

`web/src/App.tsx:246-262` coordinates a deep link across four interdependent
state variables (`pendingDeepLink`, `activeId`, `threadParentId`,
`focusMessageId`) plus an ordering dependency on the room-reset effect. It
carries four defects that a loader removes:

```text
  1. it re-runs on every roomMessages change, so each arriving SSE message
     re-runs the effect for the whole life of a pending deep link
  2. there is no failure path — an unreachable target leaves pendingDeepLink
     set indefinitely, with no timeout and no error state
  3. navigating away mid-load returns early but leaves pending state set, so
     navigating back can re-fire the focus
  4. correctness depends on effect ordering, which the source comments must
     explain
```

Those four variables collapse into one loader return value.

**Hydration is unchanged.** `web/src/data/daemon.ts:1010-1017` requests
`/web/state?room=<room>&around_event_id=<event>` and merges the window with the
loaded tail via `applyRoomState(..., { append: true })`. This already handles
targets deep in long groups and threads and is retained as-is.

### Cache ownership

```text
  Loaders are GATES only: "is the data requested, and is it ready?"
  DaemonDataSource remains the single cache and the only writer SSE feeds.

  A router-owned loader cache keyed by route would not observe the SSE stream,
  so back/forward or route re-entry would render data cached at load time while
  the live snapshot had moved on.
```

Live synchronisation between tabs is a data-layer property delivered by daemon
SSE fan-out and is independent of the routing model. Adopting TanStack Query as
the cache with SSE invalidating query keys is out of scope for this plan.

## Storybook

`@storybook/tanstack-react` is first-party and layers on `@storybook/react-vite`,
which `web/.storybook/main.ts` already uses. It wraps every story in
`<RouterProvider>` with in-memory history and type-checks `params` and `query`
against each route's search schema, so the migration is a framework swap in
`.storybook/main.ts`.

Source: <https://storybook.js.org/blog/storybook-for-tanstack-react/>

```text
  route/address unit tests   pure in, pure out. No globals, no cleanup,
                             parallel-safe. All grammar coverage lives here.
  DeepLinks.stories.tsx      drives the real Shell through the real History
                             API. Correct for composed flows; retained.
```

## Scroll restoration

```text
  @tanstack/react-virtual is already a dependency.

    router scroll restoration restores an OFFSET  (scrollTop = 4823)
    a virtual list requires an ANCHOR ITEM        ("I was at message X")

  Item heights are estimated until measured, so a given offset maps to a
  different message on a later visit. Restoration is therefore anchor-based:
  record the message id at the top of the viewport and scroll to that id. The
  virtualizer integration is ours to write; it is a separate deliverable.
```

## Scoped data contracts

```text
  src/daemon/routes/web.ts:26-44 returns one payload — launch_tools,
  launch_lifecycle, rooms, peers, messages — under one ETag computed over all
  of it. As addressable surfaces multiply, that means an embeddable board pane
  downloads the whole workspace state, the ETag invalidates on any change
  anywhere so per-surface caching is impossible, and every new feature grows
  the payload for every consumer including every popped-out pane.

  RULE: a surface that becomes a route gets a scoped endpoint, not another
  field on /web/state. The `domains` concept at src/daemon/routes/web.ts:81 is
  the seam. Route loaders enforce this by requiring each route to declare the
  data it needs.
```

## Popout reconciliation

`feat/web-multi-tab-popout` is unmerged and carries a third contract.

```text
  DECISION: the grammar in this document is canonical; that branch rebases onto it.

    ?view=pane        adopted unchanged
    /web/r/:roomId    a RESOLVER: resolves "group:1" against loaded rooms, then
                      replaceState to /web/g/:publicId. Existing pasted links
                      keep working; nothing new emits this form.
    server-side per-peer drafts (sync-qvkn)  orthogonal to addressing; carried
                      over untouched
```

## Surface migration clusters

Clustered by feature and code co-location. Each cluster is one issue under
`EPIC G`.

```text
  G1  SHELL CHROME + LAYOUT ROUTES
      App.tsx, shell-layout.tsx, shell-mode.tsx, components/Sidebar.tsx,
      rail.tsx, BottomNav.tsx, RoomHeader.tsx, TimelineRail.tsx
      -> the __shellLayout / __paneLayout split; App.tsx stops orchestrating
         deep links. Largest cluster; the others depend on it.

  G2  CHAT SURFACE + COMPOSER
      components/ChatView.tsx, MessageRow.tsx, MessageKindIcon.tsx,
      Markdown.tsx, InlineMarkdownPreview.tsx, PollWidget.tsx,
      AttachmentPreview.tsx, ScrollControls.tsx, Composer.tsx
      -> route leaf under both layouts; reads params, not shell props.
         Composer derives its draft key from the address.

  G3  THREAD SURFACE
      components/ThreadPane.tsx, ThreadSummaryPanel.tsx, threadSummaryLayout.ts
      -> route leaf; the loader port lands here.

  G4  ACTIVITY SURFACE
      components/ActivityView.tsx, ActivityItem.tsx, activity.css,
      hooks/useActivityPreferences.ts
      -> route leaf; first candidate for a scoped endpoint.

  G5  AGENTS + ARCHIVE/RESUME SURFACE
      components/AgentRoster.tsx, AgentPreview.tsx, AgentColorPicker.tsx,
      SpawnAgentDialog.tsx, agentActionMenu.ts, ArchiveRecovery.tsx,
      data/roomAgents.ts
      -> new addressable routes /web/agents and /web/agents/:peerId[/archive]

  G6  BOARDS SURFACE
      components/BoardView.tsx
      -> new nested address /web/g/:publicId/board/:boardId

  G7  NAVIGATION HOOKS
      hooks/useShellNavigation.ts, hooks/useVimNav.ts
      -> imperative navigation ported to router navigation; keybindings retained

  UNCHANGED — out of scope for EPIC G
      components/primitives.tsx, IconButton.tsx, Iconography.tsx,
      ContextMenu.tsx, ResizeHandle.tsx, Toast.tsx, ui/Sheet.tsx, lib/cn.ts,
      theme/*, styles/*
      These are route-agnostic. A migration that makes one of them import a
      router hook is incorrect.
```

Invariants, all grep-testable:

```text
  1. No component spells a path — only route definitions do.
  2. No component fetches directly — only useDataSource().
  3. No primitive imports a router hook.
```

## Phases

```text
  PHASE 1 — EPIC E   addresses
      E1 groups.public_id migration, generation, backfill
      E2 surface public_id in /web/state and web types
      E3 canonical /web/g/:publicId and /web/d/:peerId
      E4 resolvers and canonicalisation

  PHASE 2 — EPIC F   router foundation
      F1 install TanStack Router; convert address.ts to a route tree
      F2 __shellLayout / __paneLayout layout routes
      F3 port the deep-link choreography to one loader
      F4 loaders-as-gates; DataSource stays the single cache
      F5 @storybook/tanstack-react swap

  PHASE 3 — EPIC G   surface migration, G1..G7

  PHASE 4 — EPIC H   product work and data contracts
      H1 anchor-based scroll restoration
      H2 modifier discipline
      H3 window.open named targets
      H4 scoped endpoint for the activity surface
      H5 scoped endpoints for agents and boards; shrink /web/state
```

## Where the implementation differs from this proposal

```text
  ONE layout route, not two. TanStack matches on PATH, so two pathless layout
      parents over identical child paths is ambiguous. ?view=pane is a modifier,
      not a path segment, so the chrome choice is one branch in one component
      (shell/AppLayout.tsx) over one set of leaves. The property the plan wanted —
      no N x 2 branches — holds; the mechanism is a branch, not two subtrees.

  A ROOM ADDRESS IS A LAYOUT. /web/g/:publicId is a layout with chat, board and
      artifacts nested inside it, so the room gate runs once per address rather
      than once per surface. Boards extend to /web/d/:peerId/board/:boardId too:
      the board tab exists for both room kinds, and one code path beats a
      kind-conditional.

  NO STORYBOOK FRAMEWORK SWAP. @storybook/tanstack-react requires Storybook
      >= 10.5.4 plus @tanstack/react-start and start-client-core as peers — a
      full-stack framework dependency for a client-only SPA. Instead Shell mounts
      the real router, with an in-memory history when the mount point is outside
      BASE (a story iframe). Cost: no compile-time checking of story params/query,
      which no story declares today.

  RESOLUTION IS NOT TESTED IN STORYBOOK. Grammar, resolution, canonicalisation
      and the loaders-are-gates rule live in tests/web-routes.test.ts, driven
      headlessly. Storybook covers what the UI does once a route has matched.

  BOARDS HAVE NO SCOPED ENDPOINT because they have no daemon data:
      DaemonDataSource.tasks() returns an empty snapshot in every runtime. The
      agents half of H5 landed; boards had nothing to scope.
```

## Acceptance

- A pasted `/web/e/:id`, `/web/r/:roomId`, or `/web/g/by-name/:name` link lands
  on the canonical address.
- A link generated against an isolated dev daemon, pasted into production,
  produces not-found rather than a different room.
- Back/forward into a room shows live data, not load-time data.
- A deep link to a missing event shows an error state rather than hanging.
- Every surface renders standalone under `?view=pane` with no shell chrome.
- No primitive component imports a router hook.
- `cd web && bun run storybook` and `bun run test:storybook` pass.
- `around_event_id` hydration is unchanged.
- Returning to a room restores the message previously in view.
- At least one surface fetches from a scoped endpoint rather than `/web/state`.
