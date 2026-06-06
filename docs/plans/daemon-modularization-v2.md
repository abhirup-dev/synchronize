# Daemon Modularization V2 Plan

Date: 2026-06-07
Branch: `codex/daemon-refactor-expanded-scope`
Base: `origin/master` at `bc5babf`
Primary Beads epic: `sync-mkj`

## Why This Plan Exists

The original daemon modularization plan was written when `src/daemon.ts` was
roughly 1,077 lines, then revised once when it had grown to about 2,169 lines.
Current `master` has moved past both snapshots. The daemon is now 4,110 lines
and owns more than REST routing, validation, persistence, media, and
subscriptions.

Current daemon responsibilities include:

- HTTP server startup, discovery file writing, runtime config, provenance, auth,
  LAN token enforcement, startup logging, and worker lifecycle.
- A 1,501-line ordered `route()` function with 73 route or route-match checks.
- Request body/query validation, selector parsing, route-specific coercion, and
  response/error shaping.
- Peer lifecycle, presence, soft-delete/revival, activity state, inbox acking,
  and remote pull events.
- Agent session registration, lookup, rename, launch, stop, durable launch
  reconciliation, AOE correlation, and launch lifecycle projection.
- Group creation, path management, join/rename/patch/leave behavior, alias
  policy, history windows, and roster fanout.
- DM/reply/group-message delivery, mention parsing, thread-parent
  normalization, recipient fanout, inbox insertion, subscription fanout, and web
  state invalidation.
- Reactions, thread discovery, thread status, thread transcript rendering, and
  summary cache/worker integration.
- Media copy/hash/index/readme helpers, group media routes, standalone media
  retrieval, web draft attachment staging, and web attachment cleanup.
- Web live-state snapshot building, web room event/media reads, web local peer
  identity, `/web/events` SSE, web static asset serving, and ETag generation.
- SQL event query surface and global activity feed.

The refactor must therefore be larger than the old `sync-mkj.10` and
`sync-mkj.11` descriptions. The goal is still a behavior-preserving structural
split, but the module map and verification gates need to match the daemon that
exists today.

## Non-Goals

- Do not redesign the REST API, response envelope, database schema, launch
  lifecycle state machine, web state shape, or MCP/CLI client contracts.
- Do not replace daemon validation helpers with zod in this refactor. That is a
  separate semantic/schema unification decision.
- Do not introduce route middleware, command wrappers, or repository
  abstractions unless the extraction requires a tiny compatibility helper.
- Do not combine this with peer heartbeat-only lifecycle work, remote daemon UX,
  Tauri shell work, or web performance work.
- Do not split packages or move shared API types across layer boundaries yet.

## Strategy

Refactor from the outside inward.

The daemon is high-risk because it is both the durable state owner and the
wire-contract owner. Route order, validation errors, JSON field shapes, and
side-effect order are the dangerous parts. The plan therefore starts by locking
down contract tests, then extracts stable seams, then splits route domains while
leaving data access beside the moved handlers, and only then extracts repository
and storage helpers.

This ordering has three benefits:

1. Route behavior is captured before code movement, so regressions are visible.
2. Shared helper extraction creates small imports without forcing route-domain
   decisions too early.
3. Domain routers can be moved one at a time while `src/daemon.ts` remains an
   executable compatibility entrypoint after every step.

The refactor must be iterative by construction. Each step should either move a
small, coherent block without changing its internals, or add tests that describe
existing behavior. Avoid "improve while moving" changes. If a moved block looks
wrong, preserve it first, then file a follow-up.

```text
Current state

  src/daemon.ts
  +---------------------------------------------------------------+
  | startup | auth | validation | route() | SQL helpers | web     |
  | launch  | groups | messages | threads | media | subscribers  |
  +---------------------------------------------------------------+
       4,110 lines, many responsibilities, one behavior surface


Target path

  Step 0        Step 1             Step 2              Step 3+
  tests   ->    seams       ->     dispatcher    ->    small route slices
  +---+         +------+           +---------+          +-------------+
  |   |         | auth |           | routes  |          | health      |
  |   |         | val  |           | ordered |          | status      |
  +---+         +------+           +---------+          | query       |
                                                       +-------------+

  Each arrow is independently typechecked and tested.
```

## Refactor Rules

These rules matter more than the exact module names.

```text
Allowed in one step

  move code unchanged
  add imports/exports
  preserve route order
  add characterization tests
  remove dead imports after a move

Not allowed in the same step

  move code + rewrite logic
  move code + change response shape
  move code + change DB schema
  move code + redesign validation
  move code + introduce middleware abstraction
```

Every implementation slice should be reviewable as a small mechanical diff:

```text
slice shape

  1. tests or characterization
  2. mechanical extraction
  3. typecheck/focused tests
  4. commit
  5. next slice
```

## Semantic Freeze Contract

This refactor is a structural rewrite only. The implementation must treat the
current daemon as the spec until a separate product issue says otherwise.

```text
semantic behavior is frozen

  same endpoint paths
  same HTTP methods
  same status codes
  same JSON field names
  same error codes/messages
  same DB schema and migrations
  same event insertion order
  same inbox/read/ack semantics
  same subscriber callback semantics
  same web state shape
  same launch lifecycle transitions
```

How this will be enforced:

1. Write pre-refactor daemon tests first: route precedence, validation, and
   response-shape snapshots. Production movement is blocked until these pass.
2. Move code mechanically. Prefer copy/move with minimal import/export edits;
   do not rewrite conditionals, SQL, response construction, or side-effect order
   while moving.
3. Keep each phase small enough that the diff can be reviewed as "same code in a
   new file." If the diff contains behavioral edits, split it.
4. Run focused tests after every slice and the HTTP contract fixture after any
   route-family movement.
5. Preserve compatibility entrypoints. `src/daemon.ts` must keep starting the
   daemon throughout the refactor.
6. Track line-count movement after every phase. The coordinator must report
   `daemon.ts`, `routing.ts`, and new-module line counts, and investigate any
   phase that mostly duplicates code instead of moving it.
7. Reuse helpers from previous phases before creating new ones. New helpers are
   allowed only when they remove real duplication or clarify an existing seam;
   they are not a license to fork route logic.
8. File follow-up Beads issues for tempting semantic cleanups instead of
   bundling them here.

```text
change classification

  structural and allowed
    move function A from daemon.ts to daemon/validation.ts
    export type B from daemon/context.ts
    replace local function reference with imported function
    delete now-unused import
    introduce shared helper C because two moved routes already used the same logic

  semantic and not allowed in this refactor
    change validation from hand-written checks to zod
    alter an error message while moving code
    change SQL query shape
    change event fanout order
    change web state JSON shape
    rename response fields
    introduce a new lifecycle state
    copy a route body into a new file while leaving the original live copy behind
```

Review checklist for every implementation commit:

```text
[ ] Is this primarily movement, not redesign?
[ ] Do route precedence tests still pass?
[ ] Do validation tests still pass if helpers moved?
[ ] Do response-shape snapshots still pass if routes moved?
[ ] Did any DB schema, migration, or API type change? If yes, stop.
[ ] Did any existing test need a semantic expectation update? If yes, stop.
[ ] Does src/daemon.ts still execute?
[ ] Did this phase reuse prior helpers instead of copying validation/auth/selector logic?
[ ] Did the line-count report show movement rather than duplicated live code?
```

## Target Shape

```text
src/daemon.ts                         executable compatibility entrypoint
src/daemon/
  server.ts                           startup, Bun.serve, discovery, workers
  context.ts                          DaemonContext, shared row types, logging
  auth.ts                             bind/token validation and request auth
  validation.ts                       readBody, require*, optional*, parse*
  errors.ts                           sqlite constraint mapping helpers
  routing.ts                          top-level ordered dispatcher
  responses.ts                        route-local response helpers if needed
  selectors.ts                        thread selector parsing/projection
  mentions.ts                         mention token parsing and warnings
  threads.ts                          thread parent/status/transcript helpers
  routes/
    health.ts                         /health
    web.ts                            /web/state, /web/session, attachments,
                                      /web/events, static /web assets
    status.ts                         /status, /summary
    agent-sessions.ts                 /agent-sessions/*
    peers.ts                          /peers/register, heartbeat, activity,
                                      list, delete
    subscriptions.ts                  /subscriptions
    query.ts                          /query/events
    messaging.ts                      /dm, /reply, group messages
    groups.ts                         /groups, group paths, join, rename,
                                      patch, leave, history
    reactions.ts                      /events/:id/reactions
    threads.ts                        /threads, /threads/:id/*
    media.ts                          /groups/:name/media, /media/:id,
                                      web staged attachment helpers if retained
    inbox.ts                          /peers/:id/inbox, inbox ack
    events.ts                         /events/:peer_id remote pull
    activity.ts                       /activity/:peer_id
  repo/
    peers.ts                          peer rows, ensure/upsert/revival/presence
    agent-sessions.ts                 binding rows, list/get/format
    groups.ts                         groups, members, paths, alias formatters
    events.ts                         event lookup/formatting, reply targets,
                                      reactions, inbox, recipient projection
    threads.ts                        thread discovery/status/summary queries
    media.ts                          media rows and lookup
    activity.ts                       activity feed query
    launch.ts                         launch lifecycle projection/reconcile
  services/
    delivery.ts                       message fanout, inbox insertion,
                                      subscription/web invalidation calls
    subscriptions.ts                  callback subscribers and cursor updates
    web-state.ts                      buildWebState and web room projections
    web-events.ts                     SSE client set and state-change broadcast
    media-store.ts                    filesystem copy/hash/readme behavior
    web-assets.ts                     static asset serving
    launch-worker.ts                  durable launch recovery/worker loop
```

The final names can be adjusted during implementation if a smaller boundary is
clearer, but the ownership rule should hold: routes parse HTTP and call domain
helpers; repositories own SQL row mapping; services own cross-domain side
effects; `server.ts` owns process startup and shutdown wiring.

The dependency direction should stay boring:

```text
                     +------------------+
                     | src/daemon.ts    |
                     | entrypoint only  |
                     +---------+--------+
                               |
                               v
                     +------------------+
                     | daemon/server.ts |
                     | startup + serve  |
                     +---------+--------+
                               |
                               v
                     +------------------+
                     | daemon/routing.ts|
                     | ordered dispatch |
                     +---------+--------+
                               |
             +-----------------+-----------------+
             |                 |                 |
             v                 v                 v
     +---------------+ +---------------+ +---------------+
     | routes/low    | | routes/medium | | routes/high   |
     | health/status | | peers/inbox   | | groups/msg    |
     +-------+-------+ +-------+-------+ +-------+-------+
             |                 |                 |
             +-----------------+-----------------+
                               |
                               v
              +----------------+----------------+
              | repos + services + validation   |
              +---------------------------------+
```

The target is not "more files" for its own sake. The target is that future
changes can land near the concept they affect:

```text
Before

  Want to change group history?
    -> edit giant route()
    -> touch helper far below route()
    -> reason about web/subscriber side effects in same file

After

  Want to change group history?
    -> routes/groups.ts       HTTP parsing and response
    -> repo/groups.ts         SQL/group row mapping
    -> repo/threads.ts        thread projection if needed
    -> services/delivery.ts   fanout only if delivery changes
```

## Route Precedence To Preserve

Current `route()` is an ordered `if` chain. The top-level dispatcher must
preserve the following relative order, either by keeping one ordered dispatcher
or by making each domain router try exact routes before parameterized routes.

| More specific / earlier today | Less specific / later today |
|---|---|
| `POST /agent-sessions/register`, `/launch`, `/stop`, `/rename` | `GET /agent-sessions/:tool/:host_session_id` |
| `POST /peers/register`, `PATCH /peers/:id/heartbeat`, `POST /peers/activity` | `DELETE /peers/:id` |
| `GET /peers/:id/inbox`, `POST /peers/:id/inbox/ack` | `GET /events/:peer_id` remote pull |
| `POST /groups`, `GET /groups` | `GET/PATCH /groups/:name` |
| `GET/POST /groups/:name/paths` | `GET/PATCH /groups/:name` |
| `POST /groups/:name/join`, `/rename`, `/leave`, `/messages`, `/media` | `GET/PATCH /groups/:name` |
| `GET /events/:id`, `GET/POST /events/:id/reactions` | `GET /events/:peer_id` remote pull |
| `GET /threads/:id/status`, `GET/POST /threads/:id/summary` | `GET /threads/:id` |
| `GET /web/state`, `/web/events`, `/web/session`, `/web/attachments` | static `/web`, `/web/`, `/web/*` |
| `GET /media/:id` | group media list/post routes |

Every extracted router should include a short comment for any local overlap it
depends on.

Route matching should evolve in two safe stages:

```text
Stage A: one ordered dispatcher, monolithic route body moved

  routing.ts
  +------------------------------------------------+
  | if /health                                    |
  | if /web/state                                 |
  | if /web/events                                |
  | ... same order as current daemon.ts ...       |
  | throw not_found                               |
  +------------------------------------------------+

Stage B: ordered dispatcher delegates to domains

  routing.ts
  +------------------------------------------------+
  | try health routes                             |
  | try web routes                                |
  | try status routes                             |
  | try agent-session routes                      |
  | ... same domain order as current route() ...  |
  | throw not_found                               |
  +------------------------------------------------+

Domain routers return:

  handled response  -> Response
  not this route    -> null
  invalid request   -> throw existing HttpError
```

## Phases

### Phase 0: Contract Baseline

Purpose: make the current daemon observable before movement. This phase is
mandatory and blocks all production refactor work.

Actions:

- Add route precedence tests for the current endpoint set, not the old plan's
  stale `/events/:id/thread` shape.
- Add validation tests for `readBody`, `requireString`, `optionalString`,
  `optionalInteger`, `optionalObjectJson`, `optionalIntegerArray`,
  `optionalStringArray`, `requireLocalCallbackUrl`, `requireGroupName`,
  `requireLaunchPath`, `parseLimit`, `parseCursor`, selector parsing, thread
  format parsing, and group history event-id parsing.
- Add response-shape snapshots before moving route code. These snapshots should
  normalize volatile values such as timestamps, PIDs, ports, temp paths, hashes
  where the exact value is not the contract, but they must preserve status,
  error code/message, field presence, booleans, arrays, and route-specific JSON
  shape.
- Add fallthrough coverage for unknown paths returning the existing
  `not_found` envelope.
- Add subscriber cleanup coverage for failed callback delivery.
- Add SSE cancellation coverage for `/web/events` client cleanup.

Gate:

- `bun test tests/api.test.ts`
- the new daemon contract/validation tests
- `bun run typecheck`

Diagram:

```text
No production movement yet

  current daemon --------------+
                               |
                               v
                    +---------------------+
                    | characterization    |
                    | tests + fixtures    |
                    +---------------------+
                               |
                               v
                    "we know what must not change"
```

Phase 0 completion criteria:

```text
[ ] route precedence tests exist and pass
[ ] validation tests exist and pass
[ ] response-shape snapshots exist and pass
[ ] fallthrough not_found test exists and passes
[ ] subscriber failure cleanup test exists and passes
[ ] SSE cancellation cleanup test exists and passes
[ ] no production daemon code has moved yet
```

### Phase 1: Shared Seams, No Route Movement

Purpose: shrink `src/daemon.ts` without changing route order.

Actions:

- Extract `context.ts`: `DaemonContext`, common rows/interfaces used across
  route and helper modules, `log`, `formatError`.
- Extract `auth.ts`: `resolveBind`, `assertLanModeIsProtected`, `requireAuth`.
- Extract `validation.ts`: body/query validation helpers with the same
  signatures and errors.
- Extract `selectors.ts`: selector parsing and selector-to-summary-strategy
  helpers.
- Extract `errors.ts`: `mapSqliteConstraint` and a minimal
  `withSqliteConstraint` only if it removes repeated identical try/catch blocks
  mechanically.
- Keep the route body in `src/daemon.ts`.

Gate after each file or small batch:

- `bun run typecheck`
- focused tests touching the moved helpers.

Low-risk reason:

These helpers have clear inputs and throw existing `HttpError`s. They do not own
route order or database mutations. This is the safest first production movement.

```text
Before

  daemon.ts
  +------------------------------------------------+
  | route()                                       |
  | readBody / requireString / parseLimit         |
  | requireAuth / resolveBind                     |
  +------------------------------------------------+

After

  daemon.ts                      daemon/
  +----------------------+       +------------------+
  | route()              | ----> | validation.ts    |
  | same route order     | ----> | auth.ts          |
  | same route bodies    | ----> | selectors.ts     |
  +----------------------+       +------------------+
```

### Phase 2: Entrypoint And Dispatcher

Purpose: make the route split possible while preserving the executable surface.

Actions:

- Introduce `src/daemon/server.ts` with startup/main wiring.
- Keep `src/daemon.ts` as a thin compatibility entrypoint that calls
  `main()`.
- Introduce `src/daemon/routing.ts` as the ordered dispatcher.
- Move the current `route()` body to `routing.ts` first, still monolithic.

Gate:

- `bun run typecheck`
- `bun test tests/health.test.ts tests/runtime-config.test.ts`
- one CLI status smoke with `SYNCHRONIZE_HOME` under `/tmp`.

Low-risk reason:

This phase changes file boundaries, not domain ownership. The daemon should
still have one ordered route body after this phase.

```text
Before

  src/daemon.ts
  +-----------------------------+
  | main()                      |
  | Bun.serve                   |
  | route()                     |
  +-----------------------------+

After

  src/daemon.ts        daemon/server.ts        daemon/routing.ts
  +----------+         +----------------+      +----------------+
  | main()   | ----->  | Bun.serve      | ---> | route()        |
  | wrapper  |         | discovery      |      | same body      |
  +----------+         +----------------+      +----------------+
```

### Phase 3: Low-Risk Route Families

Purpose: prove the router pattern on low-mutation surfaces.

Extract in this order:

1. `routes/health.ts`
2. `routes/status.ts`
3. `routes/query.ts`
4. `routes/activity.ts`
5. `routes/subscriptions.ts`

Why: these are narrow, have fewer route-overlap hazards, and establish the
return convention for "not handled" without touching the heaviest message/group
mutations first.

Gate:

- `bun run typecheck`
- focused tests for health, summary/status, query events, activity, and
  subscriptions.

Iterative sequence:

```text
3.1 health
  routing.ts -> routes/health.ts
  gate: health tests + typecheck

3.2 status/summary
  routing.ts -> routes/status.ts
  gate: status/summary tests + typecheck

3.3 query events
  routing.ts -> routes/query.ts
  gate: query tests + typecheck

3.4 activity
  routing.ts -> routes/activity.ts
  gate: activity tests + typecheck

3.5 subscriptions
  routing.ts -> routes/subscriptions.ts
  gate: subscription callback tests + typecheck
```

Visual target after Phase 3:

```text
  routing.ts
  +--------------------------------------------------+
  | healthRouter.tryHandle()                         |
  | web still inline                                 |
  | statusRouter.tryHandle()                         |
  | agent sessions still inline                      |
  | peers/groups/messages still inline               |
  | queryRouter.tryHandle()                          |
  | activityRouter.tryHandle()                       |
  | subscriptionsRouter.tryHandle()                  |
  +--------------------------------------------------+
```

### Phase 4: Identity And Launch Route Families

Purpose: isolate peers and agent sessions before message delivery is moved.

Extract in this order:

1. `routes/agent-sessions.ts`
2. `routes/peers.ts`
3. `routes/inbox.ts`
4. `routes/events.ts` for remote event pull
5. `routes/launch-worker.ts` or service extraction only after route movement
   proves stable.

Why: peer/session identity is a dependency of messaging, groups, inbox, web
state, launch lifecycle, and remote polling. Moving it before groups reduces the
amount of cross-file state later.

Gate:

- `bun run typecheck`
- `bun test tests/peer-revival.test.ts tests/presence.test.ts`
- launch-related focused tests, especially `tests/launch-route.test.ts`,
  `tests/launch-reconcile.test.ts`, and `tests/launch-service.test.ts`.

Why this comes before messaging:

```text
  messages/groups/web/launch all depend on identity

             +----------------+
             | peers          |
             | agent_sessions |
             +-------+--------+
                     |
      +--------------+--------------+
      |              |              |
      v              v              v
  messaging       web state       launch lifecycle
```

Move identity first so later high-risk route moves can import stable peer and
agent-session helpers instead of dragging identity logic around repeatedly.

### Phase 5: Conversation Route Families

Purpose: separate event-producing routes while preserving side-effect order.

Extract in this order:

1. `routes/reactions.ts`
2. `routes/threads.ts`
3. `routes/messaging.ts`
4. `routes/groups.ts`

Why: groups and messaging are the highest-risk area. They combine auth,
membership, mention warnings, thread normalization, inbox fanout, subscriber
callbacks, web invalidation, and SQLite constraint mapping. Reactions and
threads are smaller and exercise event lookup helpers before the larger
mutation routes move.

Gate:

- `bun run typecheck`
- `bun test tests/messaging.test.ts tests/api.test.ts tests/mcp.test.ts`
- specific thread summary tests.

Risk ladder:

```text
lower risk                                      higher risk

  reactions  ->  threads  ->  messaging  ->  groups
     |             |             |             |
     |             |             |             +-- aliases, membership,
     |             |             |                 history, paths, fanout
     |             |             +---------------- mentions, inbox,
     |             |                               subscriptions, web state
     |             +------------------------------ projections, summaries
     +-------------------------------------------- small event mutation
```

The side-effect order must be preserved:

```text
group message today

  validate
    -> load group/member
    -> resolve thread parent
    -> resolve mentions
    -> insert event
    -> insert inbox rows
    -> notify subscribers
    -> emit web state change
    -> return event + warnings

During extraction, keep this order exactly.
```

### Phase 6: Web And Media Route Families

Purpose: isolate UI-facing state and filesystem behavior.

Extract in this order:

1. `routes/media.ts` for group media and `/media/:id`.
2. `services/media-store.ts` for filesystem copy/hash/readme behavior.
3. `routes/web.ts` for `/web/state`, `/web/session`, staged attachments,
   `/web/events`, and static assets.
4. `services/web-state.ts`, `services/web-events.ts`, and
   `services/web-assets.ts`.

Why: web state and media both cross DB and filesystem boundaries. Keeping web
route extraction after messaging/groups means the web snapshot can consume
stable repositories instead of carrying route-local SQL fragments forever.

Gate:

- `bun run typecheck`
- `bun test tests/web-daemon-data.test.ts tests/activity-endpoint.test.ts`
- `cd web && bun run typecheck`
- `cd web && bun run build`

Why this comes after conversation routes:

```text
  web state is a projection of the daemon, not the owner of daemon behavior

  events/groups/peers/media/launch
            |
            v
      buildWebState()
            |
            v
       web data source
```

Extracting web after event-producing routes means `services/web-state.ts` can
sit on top of stable route/repo boundaries instead of becoming a second place
where route logic hides.

Media split:

```text
  routes/media.ts
      |
      +--> repo/media.ts          DB rows
      |
      +--> services/media-store.ts
             filesystem copy/hash/readme
```

### Phase 7: Repository And Service Extraction

Purpose: remove SQL and cross-domain side effects from route modules.

Extract repositories in this order:

1. `repo/peers.ts`
2. `repo/agent-sessions.ts`
3. `repo/events.ts`
4. `repo/threads.ts`
5. `repo/groups.ts`
6. `repo/media.ts`
7. `repo/activity.ts`
8. `repo/launch.ts`

Extract services after their underlying repositories exist:

1. `services/subscriptions.ts`
2. `services/delivery.ts`
3. `services/web-state.ts`
4. `services/web-events.ts`
5. `services/launch-worker.ts`

Why: route files should first be created by moving existing code. Only after the
route ownership is visible should SQL be pulled downward. This avoids a single
large commit that simultaneously changes routing, SQL ownership, and side-effect
placement.

Gate after each repository or service:

- `bun run typecheck`
- route family tests for the moved helper.

This is intentionally late. Moving SQL before routes are split creates giant
diffs because every route and every helper changes at the same time.

```text
Do not start here:

  daemon.ts
    |
    +-- route split
    +-- SQL split
    +-- delivery split
    +-- web split

That creates one unreadable review.


Start here instead:

  route split first
    |
    v
  repo split one table/domain at a time
    |
    v
  service split after call sites are visible
```

### Phase 8: Final Cleanup And Verification

Purpose: make sure the refactor did not leave a half-split daemon.

Actions:

- Keep `src/daemon.ts` tiny and executable.
- Remove dead exports and circular imports.
- Update README/doc references only if paths or test commands changed.
- Update Beads issue descriptions/dependencies to match the v2 plan.
- Add this plan to `.claude/skills/synchronize-debugging/reference-v0-plans.md`
  after the Beads work is filed/updated.
- Run Plannotator review for this plan and incorporate feedback before code
  movement resumes.

Final gate:

- `bun run typecheck`
- `cd web && bun run typecheck`
- `cd web && bun run build`
- `bun test`
- MCP E2E/focused integration tests relevant to touched surfaces
- manual smoke with a throwaway `SYNCHRONIZE_HOME=/tmp/...`

Final shape should look like this:

```text
  src/daemon.ts
       |
       v
  daemon/server.ts
       |
       v
  daemon/routing.ts
       |
       +--> routes/*
               |
               +--> validation/auth/selectors
               +--> repo/*
               +--> services/*

  No route imports another route.
  No repo imports a route.
  Services may compose repos, but should not parse HTTP.
```

## Beads Mapping

Existing issues were revised instead of trusted verbatim:

- `sync-mkj.9`: closed by this v2 plan. The original notes referred to an
  unmerged stale plan.
- `sync-mkj.12`: closed by Phase 0 route precedence, validation, fallthrough,
  SSE, and subscriber cleanup coverage.
- `sync-mkj.13`: closed by Phase 0 normalized HTTP contract fixtures.
- `sync-mkj.10`: route extraction umbrella for Phases 1 through 6. Do not
  implement it directly as one broad task.
- `sync-mkj.11`: Phase 7 repository and service extraction.
- `sync-mkj.8`: Phase 8 final verification and cleanup.

Detailed phase children:

- `sync-mkj.14`: Phase 1 shared seams. Closed by commit `e0ab335`.
- `sync-mkj.15`: Phase 2 entrypoint and dispatcher. Closed by commit `4bbf9bb`.
- `sync-mkj.16`: Phase 3 low-risk route families.
- `sync-mkj.17`: Phase 4 identity, inbox, events, and launch routes.
- `sync-mkj.18`: Phase 5 conversation-producing routes.
- `sync-mkj.19`: Phase 6 web and media routes.

Every future phase bead includes the same anti-duplication gate: reuse helpers
from earlier phases where possible, introduce new helpers only to remove real
duplication, and report `daemon.ts`, `routing.ts`, and new-module line counts.

## Test Matrix

The test suite is part of the refactor, not an afterthought. Every phase gets
tests before or beside movement, and every high-risk behavior has an explicit
characterization case.

```text
test strategy

  broad contract tests
        |
        +--> prove external HTTP behavior stays stable

  focused route tests
        |
        +--> prove the domain being moved still works

  helper/unit tests
        |
        +--> prove extracted pure-ish helpers keep exact errors

  integration smoke
        |
        +--> prove CLI/MCP/web/daemon still cooperate
```

### Phase 0 Test Cases: Baseline And Contract Capture

Implement before moving production code.

New file candidates:

- `tests/daemon-validation.test.ts`
- `tests/daemon-route-precedence.test.ts`
- `tests/daemon-http-contract.test.ts`
- `tests/daemon-sse-subscriptions.test.ts`

Validation cases:

| Helper | Cases |
|---|---|
| `readBody` | invalid JSON, JSON array, JSON string, JSON null, valid object |
| `requireString` | missing, null, empty, whitespace, non-string, trims valid string |
| `optionalString` | missing, null, non-string, whitespace becomes undefined, trims valid string |
| `optionalFormString` | missing form key, file value rejected, whitespace ignored, valid string |
| `optionalInteger` | missing, null, float rejected, numeric string rejected, integer accepted |
| `requirePositiveInteger` | missing, zero, negative, float, positive integer |
| `optionalObjectJson` | missing/null returns null, array rejected, primitive rejected, object stringified |
| `optionalIntegerArray` | missing, empty array, non-array, zero, negative, float, valid positive ints |
| `optionalStringArray` | missing, non-array, empty item, non-string item, trims and dedupes |
| `optionalSqlParams` | missing, non-array, object item rejected, string/number/boolean/null accepted |
| `optionalReactionOp` | missing defaults to add, add/remove/toggle accepted, unknown rejected |
| `requireEmoji` | control chars rejected, long value rejected, short emoji/alias accepted |
| `requireLocalCallbackUrl` | invalid URL, https rejected, non-localhost rejected, localhost accepted |
| `requireGroupName` | empty, bad first char, bad punctuation, too long, valid dotted/underscored name |
| `requireLaunchPath` | relative path rejected, root accepted, trailing slashes normalized |
| `parseLimit` | missing default, zero, negative, non-number, cap at max, valid positive |
| `parseCursor` | missing zero, negative rejected, non-number rejected, valid zero/positive |
| selector parsing | default last, first requires k, all rejects k, invalid strategy, max cap |
| thread format parsing | default summary, summary/status/events/transcript accepted, json rejected |
| group history view | default flat, event_ids implies events, invalid view, missing event_ids rejected |

Route precedence cases:

| Pair | Assertions |
|---|---|
| `/agent-sessions/register` vs `/agent-sessions/:tool/:host_session_id` | register body hits register route; GET lookup still works |
| `/agent-sessions/launch|stop|rename` vs lookup | static action routes are never parsed as host-session lookup |
| `/peers/register` vs `/peers/:id` | register creates peer; delete still deletes exact peer |
| `/peers/:id/heartbeat` vs `/peers/:id` | heartbeat returns heartbeat semantics; delete returns delete semantics |
| `/peers/:id/inbox` vs `/peers/:id/inbox/ack` | GET does not consume ack path; ack mutates only on POST |
| `/groups` vs `/groups/:name` | list/create stay root routes; named get/patch stay named routes |
| `/groups/:name/paths` vs `/groups/:name` | path list/create never fall into group get/patch |
| `/groups/:name/join|rename|leave|messages|media` vs `/groups/:name` | action routes keep action behavior |
| `/events/:id/reactions` vs `/events/:peer_id` | reactions route does not become remote event pull |
| `/events/:id` vs `/events/:peer_id` | numeric event lookup and peer event pull remain distinguishable by method/query behavior |
| `/threads/:id/status|summary` vs `/threads/:id` | status/summary exact suffixes win over generic thread route |
| `/web/state|events|session|attachments` vs static `/web/*` | API routes never serve static fallback |
| `/media/:id` vs `/groups/:name/media` | standalone media lookup and group media routes remain separate |

HTTP contract fixture cases:

- `GET /health`: status, version, DB path presence, uptime shape.
- `GET /status`: peer/group/event counts, token-required flag, provenance fields.
- `GET /summary`: peers, groups, pending inbox, activity state, media counts.
- `POST /peers/register`: peer shape, lease, soft-delete resurrection behavior.
- `PATCH /peers/:id/heartbeat`: cursor/lease behavior and 404 for soft-deleted peer.
- `POST /peers/activity`: accepted activity states, invalid state rejection.
- `GET /peers`: online boolean, host session fields, activity state.
- `DELETE /peers/:id`: soft-delete shape and idempotent/not-found behavior as currently implemented.
- `POST /agent-sessions/register`: binding shape, peer linkage, host-session metadata.
- `GET /agent-sessions`: filter by tool, joined peer fields, launch id fields.
- `GET /agent-sessions/:tool/:host_session_id`: found and not-found shapes.
- `POST /agent-sessions/rename`: peer rename and binding response.
- `POST /agent-sessions/launch`: validation failures and accepted launch envelope, using test-safe backend stubs where possible.
- `POST /agent-sessions/stop`: not-found and accepted stop behavior.
- `POST /groups`, `GET /groups`, `GET/PATCH /groups/:name`: durable flag, description, media dir, uniqueness errors.
- `GET/POST /groups/:name/paths`: path normalization, active flag, invalid absolute path rejection.
- `POST /groups/:name/join|rename|leave`: alias policy, active state, event emission.
- `POST /dm`: recipient lookup, max body length, inbox event shape.
- `POST /reply`: reply target routing, group/thread context response shape.
- `POST /groups/:name/messages`: message event, mentions warnings, skill directives, thread parent behavior.
- `GET /groups/:name/history`: flat, threads, events views; cursor/limit behavior.
- `GET /events/:id`: visible event shape, not-found shape.
- `GET/POST /events/:id/reactions`: add/remove/toggle and aggregate shape.
- `GET /threads`, `/threads/:id`, `/threads/:id/status`, `/threads/:id/summary`: selector format, transcript/events/status shapes.
- `GET /peers/:id/inbox`, `POST /peers/:id/inbox/ack`: read/ack state and cursor behavior.
- `GET /events/:peer_id`: remote pull cursor, no mutation outside delivery/read semantics currently present.
- `POST /query/events`: SQL query success and validation failure envelopes.
- `GET /activity/:peer_id`: awaiting flag, global ordering, unknown peer behavior.
- `POST /groups/:name/media`, `GET /groups/:name/media`, `GET /media/:id`: copied metadata shape and missing media.
- `POST/DELETE /web/attachments`: draft staging and cleanup behavior.
- `POST /web/session`: local web peer shape and alias behavior.
- `GET /web/state`: ETag, launch tool projection, rooms/events/media shape.
- `GET /web/events`: initial connected event, subsequent state_changed event, cancellation cleanup.
- unknown route: 404 `not_found` envelope.

Subscriber/SSE cases:

- Subscriber callback receives event after DM/group message.
- Subscriber callback failure removes subscriber before the next event.
- Subscriber callback token is sent unchanged.
- `/web/events` stream sends `connected`.
- Cancelling `/web/events` removes the client from `ctx.webStateClients`.
- A state change after cancellation does not throw or attempt to write to the dead stream.

### Phase 1 Test Cases: Shared Helper Extraction

Run the complete `tests/daemon-validation.test.ts` after each extraction batch.

Additional assertions:

- `auth.ts` preserves token-required behavior for localhost vs non-localhost
  bind.
- `resolveBind` preserves malformed `SYNCHRONIZE_PORT` hard failure.
- `requireAuth` preserves missing, malformed, and correct bearer token behavior.
- Selector helper extraction preserves summary strategy mapping:
  `last -> last_k`, `first -> first_k`, `all -> all`.

Gate:

```bash
bun run typecheck
bun test tests/daemon-validation.test.ts tests/health.test.ts
```

### Phase 2 Test Cases: Entrypoint And Dispatcher

Before moving any domain route out of the monolithic dispatcher, assert the
server still boots through the original executable path.

Cases:

- `bun run src/daemon.ts` starts and writes discovery under a throwaway
  `SYNCHRONIZE_HOME`.
- `synchronize status` can talk to the daemon started through the compatibility
  entrypoint.
- `GET /health` and unknown route still work after `route()` moves to
  `daemon/routing.ts`.
- Runtime config tests still pass for env/config/default precedence.
- Provenance fields remain present in `/status`.

Gate:

```bash
bun run typecheck
bun test tests/health.test.ts tests/runtime-config.test.ts tests/daemon-route-precedence.test.ts
```

### Phase 3 Test Cases: Low-Risk Routes

For each moved low-risk router, run its focused tests plus route precedence.

`routes/health.ts`:

- `/health` success shape.
- `/health` works without auth when token is absent.
- `/health` behavior with auth remains whatever current behavior is captured as.
- unknown `/health/extra` falls through to `not_found`.

`routes/status.ts`:

- `/status` count fields remain stable after seeded peers/groups/events/media.
- `/status` token-required/provenance/base URL fields remain stable.
- `/summary` peer/group/media/pending-inbox projections remain stable.
- `/summary` includes activity states and host-session fields as before.

`routes/query.ts`:

- Valid event query returns current result shape.
- Invalid SQL/query payload returns existing error envelope.
- Optional SQL params validation is unchanged.
- Auth behavior unchanged.

`routes/activity.ts`:

- Global activity rows are ordered as current behavior.
- Awaiting flag is true for unacked inbox rows and false after ack/reaction/reply behavior captured by tests.
- Unknown peer behavior is preserved.
- Limit/cursor behavior is preserved.

`routes/subscriptions.ts`:

- Valid local callback URL registers.
- Non-local callback URL rejected.
- Registered callback receives next event.
- Failed callback removes subscriber.

Gate:

```bash
bun run typecheck
bun test tests/health.test.ts tests/summary.test.ts tests/activity-endpoint.test.ts
bun test tests/daemon-route-precedence.test.ts tests/daemon-sse-subscriptions.test.ts
```

### Phase 4 Test Cases: Identity And Launch Routes

`routes/agent-sessions.ts`:

- Register binding for Claude/Pi-like payloads.
- Register updates existing binding without changing immutable fields unexpectedly.
- List all sessions and filter by `tool`.
- Lookup by host tool/session id returns joined peer metadata.
- Rename updates peer/session binding as current route does.
- Launch validation errors match current codes/messages.
- Launch accepted envelope includes launch id, peer id, target group, AOE fields.
- Stop not-found and accepted stop behavior match current route.

`routes/peers.ts`:

- Register creates peer with lease and activity state.
- Re-register resurrects soft-deleted peer and memberships.
- Heartbeat extends lease and last cursor.
- Heartbeat for soft-deleted peer returns current 404 shape.
- Activity accepts configured valid states and rejects invalid states.
- List peers preserves online boolean, host-session linkage, and activity fields.
- Delete preserves soft-delete behavior.

`routes/inbox.ts`:

- Inbox fetch returns recipient-projected events.
- Fetch updates delivered/read fields exactly as current behavior.
- Ack marks acked rows and emits web state domains as before.
- Cursor and limit behavior unchanged.

`routes/events.ts`:

- Remote pull by peer id returns events after cursor.
- Remote pull next cursor behavior unchanged.
- Pull does not claim another peer's inbox.
- Missing peer behavior unchanged.

Launch worker/service extraction tests:

- Durable launch recovery handles queued/running/stopped states as current tests capture.
- AOE title/profile/attach command values unchanged.
- Failed launch records failure code and event.
- Stopped launch peer deactivation still emits expected web state.

Gate:

```bash
bun run typecheck
bun test tests/peer-revival.test.ts tests/presence.test.ts tests/peer-client.test.ts
bun test tests/launch-route.test.ts tests/launch-reconcile.test.ts tests/launch-service.test.ts tests/launch-store.test.ts
bun test tests/daemon-route-precedence.test.ts tests/daemon-http-contract.test.ts
```

### Phase 5 Test Cases: Conversation Routes

`routes/reactions.ts`:

- Add reaction creates one row.
- Re-adding same peer/emoji is idempotent or matches current behavior.
- Remove deletes only that peer/emoji.
- Toggle alternates exactly as current behavior.
- Reaction on missing/non-reactable event returns existing error.
- Reaction response includes aggregate counts and aliases.
- DM reaction target behavior is preserved.

`routes/threads.ts`:

- Thread list includes discoverable roots in current order.
- Thread status includes reply count, participant count, last event id.
- Thread summary GET returns cached summary behavior.
- Thread summary POST validates selectors/provider settings.
- Thread `format=events` honors selector strategy and truncation.
- Thread `format=transcript` renders the same speaker/body ordering.
- `format=json` still returns the removed-format error.

`routes/messaging.ts`:

- DM validates sender/recipient/body length.
- DM inserts sender/recipient event and inbox rows as before.
- Reply to DM routes to the right recipient set.
- Reply to group thread normalizes to root parent.
- Reply to non-message roster/media event is rejected.
- Mention warnings ignore backticked regions.
- Mention warnings report aliases not in group.
- Self-mention behavior remains unchanged.
- Skill directive JSON is stored and recipient-scoped as before.
- Subscriber fanout and web invalidation domains remain unchanged.

`routes/groups.ts`:

- Group create handles durable/ephemeral, name collision, description, media dir.
- Group paths create/list preserve active/default path behavior.
- Join enforces alias uniqueness and history-from behavior.
- Rename preserves alias reclaim/audit event behavior.
- Patch preserves description/durable changes.
- Leave deactivates membership and emits roster event.
- Message route preserves membership checks, mention resolution, thread parent, inbox fanout, subscriber fanout, and web state domains.
- History flat view preserves cursor/limit and reaction attachment.
- History threads view preserves root/reply grouping.
- History events view preserves explicit event id selection and authorization.

Gate:

```bash
bun run typecheck
bun test tests/messaging.test.ts tests/api.test.ts tests/mcp.test.ts
bun test tests/thread-summary-layout.test.ts tests/summary.test.ts
bun test tests/daemon-route-precedence.test.ts tests/daemon-http-contract.test.ts
```

### Phase 6 Test Cases: Web And Media Routes

`routes/media.ts` and `services/media-store.ts`:

- Media upload copies source into the group media directory.
- SHA-256, size, extension, content type, original path, copied path match current behavior.
- Missing source path returns existing error.
- Missing group/member authorization returns existing error.
- Group media list ordering and description fields remain stable.
- `/media/:id` returns metadata or current missing-media error.
- Ephemeral group cleanup still removes media directories via `pruneEphemeralGroups`.

`routes/web.ts`, `services/web-state.ts`, `services/web-events.ts`,
`services/web-assets.ts`:

- `/web/session` resolves local web peer and group alias state as before.
- `/web/attachments` stages files with safe draft ids.
- `DELETE /web/attachments` removes staged draft directory and handles missing drafts as before.
- `/web/state` preserves top-level keys, room summaries, peers, events, media,
  activity, launch tools, launch lifecycle, and skill catalog fields.
- `/web/state` ETag changes on state-changing operations and remains stable otherwise.
- `/web/events` connected/state_changed events preserve payload shape.
- `/web/events` cleanup on cancel is verified.
- Static `/web`, `/web/`, and `/web/*` still serve built assets and do not catch API routes.
- Web build assets can be served from `SYNCHRONIZE_WEB_DIST` when configured.

Gate:

```bash
bun run typecheck
bun test tests/web-daemon-data.test.ts tests/activity-endpoint.test.ts
bun test tests/daemon-sse-subscriptions.test.ts tests/daemon-http-contract.test.ts
cd web && bun run typecheck
cd web && bun run build
```

### Phase 7 Test Cases: Repository And Service Extraction

Repository extraction test rule:

For every repository module, keep route-level contract tests as the primary
proof. Add unit tests only when a mapper has meaningful logic that can regress
without HTTP coverage.

Repository-specific cases:

| Repository | Cases |
|---|---|
| `repo/peers.ts` | ensure/upsert/revive, lease presence, activity state, host-session lookup, soft-delete filtering |
| `repo/agent-sessions.ts` | binding upsert/list/get, joined peer projection, launch id fields |
| `repo/events.ts` | visible event lookup, recipient projection, reply destination, reaction attachment, inbox ack |
| `repo/threads.ts` | thread discovery, participant counts, status rows, selector projection |
| `repo/groups.ts` | group get/list/path/member formatters, alias active state, default paths |
| `repo/media.ts` | media insert/get/list row mapping and missing item behavior |
| `repo/activity.ts` | global activity query and awaiting projection |
| `repo/launch.ts` | launch projection, durable reconcile, stopped peer deactivation |

Service-specific cases:

| Service | Cases |
|---|---|
| `services/subscriptions.ts` | callback success, callback failure removal, cursor update |
| `services/delivery.ts` | DM/group/reply fanout, inbox rows, warnings, web invalidation domains |
| `services/web-state.ts` | snapshot shape and room/event/media projections |
| `services/web-events.ts` | connected event, state_changed event, cancellation cleanup |
| `services/launch-worker.ts` | queued work claim, success transition, failure transition, recovery |

Gate:

```bash
bun run typecheck
bun test tests/api.test.ts tests/messaging.test.ts tests/mcp.test.ts
bun test tests/web-daemon-data.test.ts tests/launch-reconcile.test.ts
bun test tests/daemon-http-contract.test.ts
```

### Phase 8 Test Cases: Final Verification

Full suite and smoke:

- `bun run typecheck`
- `cd web && bun run typecheck`
- `cd web && bun run build`
- `bun test`
- `bun test tests/mcp-e2e.test.ts`
- CLI smoke with throwaway `SYNCHRONIZE_HOME`: status, register peer, create group, send group message, fetch history.
- MCP smoke with throwaway `SYNCHRONIZE_HOME`: register, list peers, create/join group, send, reply/react if feasible.
- Web smoke with throwaway `SYNCHRONIZE_HOME`: `/web/state`, `/web/events`, static asset route.
- Launch smoke only if launch routes/workers changed in the final slice; use existing AOE test harness and clean the profile afterward.

Final regression checklist:

```text
[ ] all old tests pass
[ ] new contract tests pass
[ ] daemon starts from src/daemon.ts
[ ] route not_found envelope unchanged
[ ] route precedence tests pass
[ ] web build succeeds
[ ] no temporary daemon/AOE/tmux sessions left behind
[ ] Beads issues updated
[ ] plan index updated
```

## Risks And Controls

| Risk | Control |
|---|---|
| Route precedence changes | Phase 0 precedence tests; ordered dispatcher; exact-before-parameterized route comments |
| Error envelope drift | HTTP contract fixtures and validation tests |
| Side-effect order drift | Move code first, extract services second; focused message/group/inbox tests |
| Web state regressions | Web daemon data tests, web typecheck/build, SSE cleanup test |
| Launch lifecycle regression | Keep launch service/store unchanged; isolate route movement before worker extraction |
| Config/provenance regression | Keep startup extraction separate from route extraction; health/runtime-config tests |
| Filesystem/media cleanup regression | Extract media-store after media route tests exist |
| Circular imports | Enforce route -> repo/service -> context direction; repositories cannot import routes |

## Stop Conditions

Stop and reassess if any phase requires changing API response shape, DB schema,
launch lifecycle state transitions, event delivery semantics, or web state shape.
Those are product changes, not refactor work, and should become separate Beads
issues.
