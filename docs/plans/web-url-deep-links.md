# Web URL Deep Links For Rooms, Threads, And Messages

Status: DRAFT
Owner: abhirup

## Goal

Add pasteable, instance-local URLs that open the Synchronize web UI directly to a
room, thread, or message.

The primary use case is derivable links: when an agent or test knows the running
UI base URL and an event id, it should be able to construct a link, paste it in a
browser, and land on the right surface:

- a DM message opens the DM room and scrolls to the message;
- a top-level group message opens the group chat and scrolls to the message;
- a group thread reply opens the group chat, opens the thread pane, and scrolls
  the thread pane to the reply;
- a thread root opens the group chat and can open or focus the thread surface
  without needing the caller to know group id or thread shape ahead of time.

This plan targets the solid version, not the thin "recent messages only" MVP.
Deep links must work for older messages that are outside the current bounded
`/web/state` window.

## Current State

The daemon already has most of the raw data needed to resolve a target:

- `GET /events/:event_id?peer_id=...` returns a visible event and enforces
  per-peer visibility.
- group message rows include `parent_event_id` and `reply_to_event_id`, so the
  daemon can distinguish a root message from a thread reply.
- DM rows carry `sender_peer_id` and `recipient_peer_id`, so the web peer can
  derive the other participant and therefore the `dm:<peer_id>` room id.
- `/web/state?room=...` is already the web UI hydration surface, and the daemon
  serves `/web/*` with an `index.html` fallback, so path-style client routes can
  be added without a static-serving redesign.

The web UI also has useful pieces:

- `Shell` owns `activeId`, `tab`, `threadParentId`, and the split-pane thread
  layout.
- `ActivityView` can jump to a room and message through an in-memory callback.
- `ThreadPane` already accepts `focusMessageId` and can scroll a virtualized
  reply list to a focused reply.
- Storybook now mounts the real exported `Shell` for composed flows, giving us a
  deterministic way to test URL-to-UI state against `MockDataSource`.

The missing pieces are a URL contract, a daemon-side web resolver, target
hydration for older events, and app-shell routing state.

## URL Contract

Use event-first links as the canonical derivable shape:

```text
/web/e/:eventId
```

Additional readable aliases may be supported, but they should resolve through
the same target model:

```text
/web/t/:rootEventId
/web/r/:roomId
/web/r/:roomId/m/:eventId
```

`/web/e/:eventId` is the durable form to expose from CLI/MCP/test output because
the caller only needs:

1. the active daemon/UI base URL, from `synchronize status`;
2. the numeric event id already returned by send/reply APIs.

The hostname and port identify the running UI instance. The event id identifies
the message inside that instance's SQLite database. Links are not intended to be
portable across different daemon homes.

## Target Model

Introduce a small web target model shared by the daemon response and the web
data adapter:

```ts
type WebDeepLinkSurface = "dm" | "group-main" | "group-thread";

interface WebDeepLinkTarget {
  event_id: number;
  message_id: string;
  room_id: string;          // group:<group_id> or dm:<other_peer_id>
  surface: WebDeepLinkSurface;
  parent_event_id: number | null;
  parent_message_id: string | null;
  focus_event_id: number;
  focus_message_id: string;
}
```

Rules:

- DM event: `surface = "dm"`, `room_id = dm:<other_peer_id>`, no parent.
- Group root event: `surface = "group-main"`, `room_id = group:<group_id>`,
  `parent_* = null`, focus the root.
- Group reply event: `surface = "group-thread"`, `room_id = group:<group_id>`,
  `parent_* = parent_event_id`, focus the reply.
- Thread-root alias (`/web/t/:rootEventId`): resolve as `group-thread` with
  focus on the root, so the thread pane can open directly.

## Daemon Changes

### Resolver endpoint

Add:

```text
GET /web/resolve?event_id=:id&peer_id=:webPeerId
```

The route belongs under `src/daemon/routes/web.ts` because this is a web
projection, not a generic agent API.

Responsibilities:

- require auth consistently with `/web/state`;
- use the same visibility rules as `GET /events/:event_id`;
- derive `room_id`, `surface`, parent ids, and focus ids;
- return the resolved event and, for thread replies, the root event needed to
  render the thread parent if the normal room window would not include it;
- reject invalid ids with the existing structured error style.

### Target hydration

Deep links must not depend on the target being in the latest room window. Add an
explicit target hydration mode to `/web/state`:

```text
GET /web/state?room=:roomId&around_event_id=:eventId&peer_id=:webPeerId
```

For group rooms:

- include a bounded window of top-level group messages around the target root
  when the target is a top-level message;
- when the target is a thread reply, include the thread root in the main-message
  set and include a bounded reply window around the reply;
- preserve the existing newest-window behavior when `around_event_id` is absent.

For DM rooms:

- include a bounded DM window around the target event.

The response should still use the existing `WebStateResponse` shape so
`DaemonDataSource.applyRoomState` remains the single mapping path. Add metadata
only if the UI needs to know whether the exact target was included:

```ts
target?: {
  event_id: number;
  included: boolean;
  before_count?: number;
  after_count?: number;
}
```

Use conservative limits. A window of roughly 40 before / 40 after is enough for
context without turning deep links into unbounded transcript loads.

## Web Data Adapter Changes

Extend the `DataSource` contract with web-target methods:

```ts
resolveDeepLink(eventId: string): Promise<WebDeepLinkTarget>;
hydrateDeepLinkTarget(target: WebDeepLinkTarget): Promise<void>;
```

`DaemonDataSource` should call `/web/resolve` and then `/web/state` with
`around_event_id`.

`MockDataSource` should resolve from `seed.ts` data so Storybook can exercise the
same app-shell flow without a daemon. This is intentionally a mock of the web
projection, not a daemon behavior test.

## Web App Changes

### Route parsing

Add a tiny URL parser in `web/src/App.tsx` or a new `web/src/deeplinks.ts`:

- parse `/web/e/:eventId`;
- parse `/web/t/:rootEventId`;
- optionally parse `?event=:eventId` as a compatibility/debug form;
- ignore unknown paths by falling back to the current first-room behavior.

Do not introduce a full router unless the app gains more route families. The
required state can be represented by the existing shell state plus one pending
target object.

### Navigation state

Change `Shell` state from only:

```ts
threadParentId: string | null
```

to:

```ts
threadParentId: string | null
focusMessageId: string | null
pendingDeepLink: WebDeepLinkTarget | null
```

On initial load:

1. parse the URL;
2. resolve the target;
3. hydrate the target window;
4. set `activeId`, `tab = "chat"`, `threadParentId` if needed, and
   `focusMessageId`;
5. scroll and flash when the DOM/virtualizer has materialized the target.

### Main chat focusing

`ChatView` currently has an internal `handleJumpTo` used by the thread-summary
panel. Promote that behavior into a prop:

```ts
focusMessageId?: string;
onFocusedMessage?(): void;
```

When `focusMessageId` changes and the message exists in `rows`, scroll the
virtualizer to it, then flash `#msg-${id}`. This covers top-level group messages
and DMs.

### Thread focusing

The main `Shell` render path should pass `focusMessageId` into `ThreadPane`.
`ThreadPane` already knows how to scroll a reply into view when
`focusMessageId !== parentId`; extend it to flash after scrolling and to treat
`focusMessageId === parentId` as "focus/flash the parent row".

### URL updates after in-app navigation

When a user reaches a message through normal UI actions, update the address bar:

- Activity row jump: `/web/e/:eventId`;
- opening a thread root: `/web/t/:rootEventId` or `/web/e/:rootEventId`;
- focusing a reply from Activity: `/web/e/:replyEventId`;
- switching rooms without a message target: `/web/r/:roomId`.

Use `history.pushState` for user-initiated navigation and `replaceState` for
initial route normalization. Add a `popstate` listener so back/forward restores
the corresponding room/thread/message state.

## Storybook Scope

Storybook is not the daemon truth source. It should encode the app-shell and
component behavior against `MockDataSource`:

- Add or extend `Flows.stories.tsx` with `Flows/URL Deep Links`.
- Mount the real `Shell`.
- Seed/resolve deterministic mock targets for:
  - DM message link opens the DM and focuses the message;
  - group root link opens the group chat and focuses the main-list message;
  - group reply link opens the group chat, opens the thread pane, and focuses
    the reply;
  - old/off-screen target link hydrates enough mock context for the virtualized
    list to scroll to it.
- Use `play` functions with `step()` labels, following the existing
  `Flows/Activity to Thread` template.
- Keep any paced/watchable demo tagged `!test`.

Run:

```bash
cd web && bun run test:storybook
```

Expected Storybook assertions:

- the correct room becomes active in the sidebar/header;
- the thread pane is absent before a reply deep link and present after;
- the target text is absent/off-screen before focus where applicable and visible
  after focus;
- the target row receives the highlight class;
- back/forward restores at least one prior deep-link target in the composed
  shell.

## Bun/API Test Scope

Add daemon/data tests for server truth:

- `/web/resolve` derives `dm`, `group-main`, and `group-thread` targets.
- `/web/resolve` rejects missing `peer_id`, unknown event ids, and private DM
  targets the web peer cannot see.
- `/web/state?around_event_id=...` includes an old DM target outside the normal
  latest window.
- `/web/state?around_event_id=...` includes an old top-level group target outside
  the normal latest window.
- `/web/state?around_event_id=...` for a thread reply includes both the thread
  root and the reply window.
- Static serving still returns the React app for `/web/e/:eventId` while keeping
  `/web/state`, `/web/session`, and `/web/events` as API routes.
- `DaemonDataSource` maps resolver + target hydration into the same `Message`
  snapshots used by normal room loading.

Run:

```bash
bun test
cd web && bun run typecheck
cd web && bun run storybook:build
cd web && bun run test:storybook
```

## Live UI Probe Scope

Do one manual or automated live `/web` smoke with a throwaway
`SYNCHRONIZE_HOME`:

1. start a daemon from the implementation worktree;
2. create one group, one thread reply, and one DM;
3. copy `/web/e/:eventId` links for all three cases;
4. paste each link into a fresh browser tab;
5. verify the correct room/thread/message is visible and highlighted;
6. verify refresh preserves the same target;
7. verify browser back/forward across two deep links.

This live probe is required because Storybook does not prove daemon routing,
auth, SSE, or real `/web/state` hydration.

## Rollout Phases

### Phase 1: Web target resolver

- Add `GET /web/resolve`.
- Add resolver tests for target derivation and visibility.
- No UI changes yet.

### Phase 2: Target hydration

- Add `around_event_id` support to `/web/state`.
- Keep the response shape compatible with existing clients.
- Add old-message and thread-reply hydration tests.

### Phase 3: App-shell deep-link state

- Add URL parsing and initial target resolution.
- Add main-chat focus props and thread focus/highlight completion.
- Add browser history updates and `popstate` handling.

### Phase 4: Storybook composed-flow coverage

- Extend `MockDataSource` with resolver/hydration behavior.
- Add `Flows/URL Deep Links` stories and `play` tests.
- Run `test:storybook`.

### Phase 5: Live probe and polish

- Verify against a throwaway daemon and built web bundle.
- Add any missing empty/error UI for unresolved or unauthorized targets.
- Document the canonical link shape in README or web docs once behavior is
  stable.

## Size Estimate

This is a medium feature.

Expected implementation size:

- daemon resolver and hydration: 200-350 LOC;
- data source contract and adapters: 100-180 LOC;
- app-shell URL/focus/history plumbing: 180-300 LOC;
- Storybook flows and fixtures: 120-220 LOC;
- tests: 250-450 LOC.

Total expected change: roughly 850-1,500 LOC including tests and stories.

Expected effort: 2-4 focused engineering days. The critical path is not static
routing; it is making virtualized old-message hydration deterministic and keeping
the Storybook/live-daemon verification split clean.

## Risks And Open Questions

- **Visibility model for web peer.** The web activity feed can observe all group
  events but only its own DMs. The resolver must preserve this boundary.
- **Window semantics.** `around_event_id` needs stable ordering and bounded
  context without breaking existing cursor behavior.
- **Thread root focus.** Product choice: `/web/e/:rootId` can focus the root in
  the main chat, while `/web/t/:rootId` opens the thread pane. This plan supports
  both, but the implementation should pick the least surprising default.
- **History churn.** Avoid pushing a new history entry for internal hydration or
  repeated focus effects. Only user-visible navigation should push.
- **Mock parity.** Storybook should mock the web projection enough to test UI
  behavior, but daemon correctness still belongs to Bun tests.

## Non-Goals

- No cross-daemon portable URLs.
- No hosted/shareable public links.
- No full React Router migration.
- No unbounded transcript loading for old links.
- No Storybook dependency on a live daemon.
