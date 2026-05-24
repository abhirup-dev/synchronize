# Daemon modularization plan

Design-only document for **sync-mkj.9** (epic **sync-mkj**). Captures module boundaries for splitting `src/daemon.ts` (currently **2169 lines**, up from the ~1077 the original epic measured — web-state work has roughly doubled it) before any code movement.

No runtime change is in scope for this doc. Implementation lands in **sync-mkj.10** (routes/validation) and **sync-mkj.11** (repo/media/subscriptions). Each implementation stage runs the verification gate defined below.

---

## 1. Current responsibilities of `src/daemon.ts`

Walking the file top to bottom, eight concerns are tangled in one place:

| # | Concern | Approx. lines | Representative symbols |
|---|---------|---------------|------------------------|
| 1 | DB row & context types | 22–188 | `DaemonContext`, `PeerRow`, `EventRow`, `MemberRow`, `MediaRow`, `GroupRow`, `AgentSessionRow`, `SummaryPeerRow`, `SummaryGroupRow`, `InboxRow`, `EventSubscriber`, `MentionWarning`, `DiscoveryFile` |
| 2 | Auth, bind validation, log | 190–221 | `log`, `formatError`, `resolveBind`, `assertLanModeIsProtected`, `requireAuth` |
| 3 | Route dispatch (one big `if`/`else`) | 223–1299 | `route()` — **~1077 lines**, ~30 endpoints |
| 4 | Request validation helpers | 1301–1406 | `readBody`, `requireString`, `optionalString`, `optionalInteger`, `optionalObjectJson`, `optionalNumberArray`, `requireLocalCallbackUrl`, `requireGroupName`, `parseLimit`, `parseCursor`, `parseOptionalPositiveInt` |
| 5 | Threads, mentions, roster fanout | 1408–1505 | `resolveThreadParent`, `MENTION_TOKEN_RE`, `stripBacktickedRegions`, `resolveMentions`, `computeThreadParticipants`, `fanoutRosterEventToInbox` |
| 6 | DB repo helpers + agent-session formatting | 1507–1700 | `ensurePeer`, `upsertPeer`, `getPeer`, `findPeerByHostSession`, `findPeerByRequiredHostSession`, `leaseExpiresAtForTool`, `getAgentSessionByHost`, `getAgentSessionByPeer`, `listAgentSessions`, `formatAgentSession`, `agentSessionSelectSql`, `getEvent`, `getGroup`, `getGroupById`, `getGroupMembers`, `getGroupMember`, `ensureActiveMember`, `getMedia`, `formatGroup`, `MEMBER_SELECT_SQL` |
| 7 | Web state, SSE, web subscribers | 1701–1916 | `openWebEvents`, `formatSse`, `emitWebStateChanged`, `buildWebState`, `webEventSelectSql`, `readWebRoomEvents`, `readWebRoomMedia`, `WebStateResponse`, `WebRoomSummary`, `WebEventRow`, `WebStateClient`, `WebStateChange`, `WEB_PEER_LEASE_EXPIRES_AT` |
| 8 | Notifications, media filesystem, error mapping, startup, static assets | 1918–2169 | `notifySubscribers`, `hashFile`, `guessContentType`, `appendMediaIndex`, `writeMediaReadme`, `mapSqliteConstraint`, `main`, `serveWebAsset`, `CONTENT_TYPES`, `WEB_DIST` |

Concern (3) is the dominant problem — a 1000+ line `if`/`else` chain that interleaves auth, validation, repo lookups, mutation, subscriber fanout, and web-state emission for every endpoint.

---

## 2. Target module map

```text
src/daemon.ts                          executable entrypoint — calls daemon/server.ts main()

src/daemon/
  server.ts                            Bun.serve wiring, discovery file, main()
  context.ts                           DaemonContext, DiscoveryFile, log, formatError
  auth.ts                              resolveBind, assertLanModeIsProtected, requireAuth
  validation.ts                        readBody, requireString, optionalString,
                                       optionalInteger, optionalObjectJson,
                                       optionalNumberArray, requireLocalCallbackUrl,
                                       requireGroupName, parseLimit, parseCursor,
                                       parseOptionalPositiveInt
  errors.ts                            mapSqliteConstraint (re-exports HttpError for convenience)
  routes.ts                            top-level route() dispatcher — composes per-domain routers
  routes/
    health.ts                          GET /health
    status.ts                          GET /status, GET /summary
    agent-sessions.ts                  POST /agent-sessions/register, /rename;
                                       GET /agent-sessions, GET /agent-sessions/:id
    peers.ts                           POST /peers/register, PATCH /peers/:id/heartbeat,
                                       DELETE /peers/:id, GET /peers
    subscriptions.ts                   POST /subscriptions
    messaging.ts                       POST /dm; POST /groups/:name/messages;
                                       GET /groups/:name/history; GET /events/:id;
                                       GET /events/:id/thread
    groups.ts                          POST /groups, GET /groups, GET /groups/:name,
                                       POST /groups/:name/join, /rename, /leave,
                                       PATCH /groups/:name
    media.ts                           POST /groups/:name/media,
                                       GET /groups/:name/media,
                                       GET /media/:id
    inbox.ts                           GET /peers/:id/inbox, POST /peers/:id/inbox/ack
    events.ts                          GET /peers/:id/events (cursor pull)
  repo/
    peers.ts                           ensurePeer, upsertPeer, getPeer,
                                       findPeerByHostSession, findPeerByRequiredHostSession,
                                       leaseExpiresAtForTool, PeerRow,
                                       SummaryPeerRow
    agent-sessions.ts                  AgentSessionRow, AgentSessionJoinedRow,
                                       agentSessionSelectSql, getAgentSessionByHost,
                                       getAgentSessionByPeer, listAgentSessions,
                                       formatAgentSession
    groups.ts                          GroupRow, MemberRow, MEMBER_SELECT_SQL,
                                       FormattedGroup, FormattedMember,
                                       formatGroup, getGroup, getGroupById,
                                       getGroupMembers, getGroupMember,
                                       ensureActiveMember, SummaryGroupRow
    events.ts                          EventRow, InboxRow, getEvent,
                                       resolveThreadParent, fanoutRosterEventToInbox
    mentions.ts                        MENTION_TOKEN_RE, stripBacktickedRegions,
                                       resolveMentions, computeThreadParticipants,
                                       MentionWarning
    media.ts                           MediaRow, getMedia
  media-store.ts                       hashFile, guessContentType, appendMediaIndex,
                                       writeMediaReadme  (filesystem-only, no DB)
  subscriptions.ts                     EventSubscriber, notifySubscribers
                                       (callback fanout + delivered_at + last_cursor update)
  web/
    state.ts                           buildWebState, readWebRoomEvents, readWebRoomMedia,
                                       webEventSelectSql, WebStateResponse,
                                       WebRoomSummary, WebEventRow,
                                       WEB_PEER_LEASE_EXPIRES_AT
    events.ts                          openWebEvents, formatSse, emitWebStateChanged,
                                       WebStateClient, WebStateChange
    assets.ts                          serveWebAsset, CONTENT_TYPES, WEB_DIST
```

The `web/` subgroup is **not in the original sync-mkj.9 shape** — the original predates the web UI. It must be in this design or sync-mkj.10/11 won't be acceptance-correct.

### Import direction (no cycles)

```
server.ts ─► routes.ts ─► routes/*.ts ─► repo/*.ts, validation.ts, auth.ts,
                                         media-store.ts, subscriptions.ts,
                                         web/state.ts, web/events.ts, web/assets.ts
routes/messaging.ts ─► repo/events.ts, repo/mentions.ts, repo/groups.ts
web/events.ts ◄── routes/* (via context — see §3)
subscriptions.ts ◄── routes/messaging.ts, routes/groups.ts, routes/media.ts
```

`context.ts` is leaf-most; everyone may import it. `repo/*` may import `context.ts`, `validation.ts` (for `HttpError`), and `db.ts`, nothing else.

---

## 3. `DaemonContext` stays the seam

`DaemonContext` already carries `db`, `subscribers`, `webStateClients`, `stateVersion`, `server`, `paths`, `token`, `startedAt`. Keep it as the single threaded value — no globals, no service-locator. Routes receive `(request, ctx)`; repo helpers receive `(db, …)`; subscription/web-state helpers receive `(ctx, …)`. This matches the current shape and minimizes diff.

---

## 4. Route path precedence (regression risk)

`route()` is an **ordered** `if`/`else` chain. Some paths overlap structurally and rely on the chain order. When extracting per-domain routers, the top-level dispatcher must preserve this order. Verified-overlapping pairs (must keep relative order):

| First (more specific) | Second (less specific) |
|----------------------|------------------------|
| `POST /agent-sessions/register` | `POST /agent-sessions/rename` (both POSTs under same prefix) |
| `GET /agent-sessions` | `GET /agent-sessions/:id` (`agentSessionGet` match) |
| `POST /peers/register` | `PATCH /peers/:id` (`peerHeartbeat` match), `DELETE /peers/:id` (`peerDelete`) |
| `GET /groups` | `GET /groups/:name` (`groupMatch`) |
| `POST /groups` | `POST /groups/:name/join` / `/rename` / `/leave` / `/messages` / `/media` |
| `GET /events/:id` | `GET /events/:id/thread` (`threadGet`) |
| `GET /peers/:id/inbox` | `POST /peers/:id/inbox/ack` |

Top-level `routes.ts` should `switch (firstSegment)` to a per-domain router, then each router preserves its current internal order. Add a one-line comment per overlap pointing back to this table.

---

## 5. Duplications — in scope vs deferred

### In scope (mechanical, low-risk; bundle into sync-mkj.10/11)

- **Validation helpers consolidated in one file.** `requireString`/`optionalString`/`optionalInteger`/`optionalObjectJson`/`optionalNumberArray`/`requireLocalCallbackUrl`/`requireGroupName`/`parseLimit`/`parseCursor`/`parseOptionalPositiveInt` collapse into `daemon/validation.ts`. Same signatures, same errors, single import site.
- **`MEMBER_SELECT_SQL` and `agentSessionSelectSql` move next to their query callers** in `repo/groups.ts` and `repo/agent-sessions.ts`, eliminating cross-section coupling.
- **`webEventSelectSql` + `readWebRoomEvents` + `readWebRoomMedia`** consolidate inside `web/state.ts` so the SQL fragment and its only callers live together.
- **`formatGroup` / `Boolean(active|durable|online)` coercion** consolidated as a single mapper helper inside `repo/groups.ts` (currently inlined at 4 call sites with subtle differences in field order).
- **Error mapping pattern.** `mapSqliteConstraint(error, code, message)` is correct but error-throwing call sites repeat `try { … } catch (e) { throw mapSqliteConstraint(e, …) }`. Extract a small wrapper `withSqliteConstraint(code, message, fn)` in `daemon/errors.ts` — purely mechanical.

### Cross-reference, do NOT bundle here

- **Replace bespoke `requireString`/`optionalString` with zod schemas.** This is **sync-3wc**'s territory ("Share zod schema fragments across MCP tools"). MCP tools already use zod; the daemon does not. Doing both at once turns a mechanical refactor into a semantic one. Note the link in sync-mkj.10's notes; pick it up after.
- **`PeerRow`/`GroupRow`/`MemberRow`/`EventRow` (numeric booleans) vs `api/types.ts` `Peer`/`Group`/`GroupMember`/`Event` (real booleans).** These describe the **same data at different layers** — DB rows have SQLite's `0|1`; API responses have JSON `true|false`. Deduplication requires a `RowOf<T>` mapper or a generated bridge, and a decision about which side owns the canonical shape. **Out of scope** for sync-mkj.10/11; file as follow-up.
- **Route-handler boilerplate** — `requireAuth → readBody → validate → repo lookup → mutate → notifySubscribers → emitWebStateChanged` repeats across ~20 endpoints. Tempting to build a command/middleware wrapper. **Resist for this refactor.** sync-mkj.9 says "preserve behavior." Inventing a wrapper is its own design decision; let the split surface it explicitly first. File a follow-up issue if the pattern still feels worth abstracting after sync-mkj.11 lands.

### Out of scope — separate concerns surfaced during analysis

- `src/api/types.ts` (147 lines) overlaps with daemon row types — covered by the follow-up above.
- `src/mcp/tools/register.ts` (173 lines) — similar zod-fragment dedup work, owned by sync-3wc.
- `src/client.ts` URL building — owned by sync-kii.

---

## 6. Phased verification gate

Each implementation phase below ends with the **same** gate. Never proceed to the next phase with a failing gate.

```bash
bun run typecheck
bun test tests/health.test.ts
bun test tests/messaging.test.ts
bun test tests/mcp-e2e.test.ts
bun test                       # only at end of each top-level phase
```

### Phase A — sync-mkj.10 (routes + validation + auth)

Order matters; each step is a single commit with the gate passing:

1. Extract `daemon/context.ts` (types + `log`/`formatError`). No call-site changes.
2. Extract `daemon/auth.ts` (`resolveBind`, `assertLanModeIsProtected`, `requireAuth`).
3. Extract `daemon/validation.ts` (all `readBody`/`require*`/`optional*`/`parse*`).
4. Extract `daemon/errors.ts` (`mapSqliteConstraint`, optional `withSqliteConstraint` wrapper).
5. Introduce `daemon/routes.ts` as a thin dispatcher; keep the route body inline temporarily.
6. Split into `daemon/routes/<domain>.ts` **one domain at a time**, preserving the precedence table in §4. Suggested split order (lowest risk first):
   - `health.ts`, `status.ts` (read-only, no mutation)
   - `agent-sessions.ts`
   - `peers.ts`
   - `subscriptions.ts`
   - `inbox.ts`, `events.ts`
   - `media.ts`
   - `messaging.ts`
   - `groups.ts` (largest; do last so all helpers are already in place)
7. Reduce `src/daemon.ts` to an entrypoint that imports `server.ts`'s `main()`.

### Phase B — sync-mkj.11 (repo + media-store + subscriptions + web)

8. Extract `daemon/repo/*` per the map. Each row-type module is one commit + gate.
9. Extract `daemon/media-store.ts` (pure filesystem helpers, no DB).
10. Extract `daemon/subscriptions.ts` (`notifySubscribers` + `EventSubscriber`).
11. Extract `daemon/web/state.ts`, `daemon/web/events.ts`, `daemon/web/assets.ts`.
12. Final gate: full `bun test`, plus manual smoke per `docs/integration-tmux.md` if any messaging/inbox/subscription code moved.

### Compatibility entrypoint

`src/daemon.ts` stays as the executable invoked by scripts and Makefile targets (`make daemon-relaunch`, `bun run src/daemon.ts`). After the split it is ~3 lines: import `main` from `./daemon/server.ts`, run it, exit on error. No public command, script, or installed adapter changes path.

---

## 7. Non-negotiables (carried from sync-mkj epic)

- Endpoint paths, HTTP methods, status codes, JSON response shapes — **unchanged**.
- Request body validation behavior and error codes — **unchanged**.
- SQLite schema, query semantics, `delivered_at` semantics, subscriber fanout order — **unchanged**.
- No CLI/MCP-only logic creeps into shared modules; daemon-only logic stays under `daemon/`.
- No import cycles. `repo/*` is a leaf domain; `web/*` and `routes/*` depend on `repo/*`, not the other way.

---

## 8. Open questions to resolve during implementation

- Does `daemon/web/events.ts` keep `webStateClients` on `DaemonContext` (current), or move ownership inside the module behind `subscribe()`/`emit()`? **Recommendation:** keep on context for sync-mkj.11; revisit only if a follow-up needs to swap the transport.
- `agentSessionSelectSql` is currently a function returning a string; `MEMBER_SELECT_SQL` is a const. Pick one convention (const string fragment) in `repo/*` so SQL fragments stay greppable.
- Should `daemon/errors.ts` re-export `HttpError` from `src/http.ts`, or should `repo/*` import `HttpError` directly? **Recommendation:** import directly from `src/http.ts` — `daemon/errors.ts` only owns `mapSqliteConstraint`/`withSqliteConstraint`.
