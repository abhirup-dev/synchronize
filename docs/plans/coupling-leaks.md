# Address And Runtime Decoupling

Status: PROPOSED
Owner: abhirup
Epic: `EPIC D`
Companion: `docs/plans/launch-flow-architecture.md` (same branch)
Downstream: `docs/plans/routing-and-address-model.md` (branch `feat/routing-contract`)

Scope: behaviour-preserving refactors. No user-visible URL changes on this
branch. The address grammar, the router, and the group identifier land
downstream and require this first.

## Background: a URL carries two meanings

In server code a URL means one thing — which handler runs. In a single-page app
the same string carries two unrelated meanings, and the platform does not
separate them:

```text
  https://host:1355/web/g/ops?view=pane
  └───── meaning 1 ─────┘└──── meaning 2 ────┘
   NETWORK ADDRESS         APPLICATION STATE
   fetched once            mutated continuously with no network request,
                           via history.pushState / replaceState
```

Keeping these two meanings separate is the whole purpose of the structure below.

## The frame

```text
        DEPLOYMENT AXES                     CONTRACT LAYERS
        vary per environment,               near-invariant,
        chosen by the LAUNCHER              owned by the CODEBASE
        ──────────────────────              ─────────────────────
        ORIGIN                              BASE
          which host:port serves the app      where the app is mounted
          127.0.0.1:58405                     inside that origin: /web/
          <wt>.synchronize-dev...:1355

        RUNTIME                             ROUTE
          which daemon holds the data         which surface is showing
          production / isolated dev           + how it is chromed
```

**Governing rule:** ROUTE is expressible without knowing ORIGIN, RUNTIME, or
BASE. A route states what the user is looking at — not where the server is,
which daemon holds the data, or how the bundle is mounted.

These are two independent axes, not a containment hierarchy: in production
ORIGIN and RUNTIME are the same process; in worktree development they are
different processes. That is why they must be separate knobs.

## D1 — ROUTE must not depend on BASE

Current coupling:

```text
  web/src/deeplinks.ts:10
      loc.pathname.match(/\/web\/(?:e|t)\/([^/?#]+)/)
                          ^^^^^^ BASE, inside the ROUTE parser
```

Because it is a regex literal rather than a config value, it does not read as a
decision, and it propagates: any environment that mounts the app somewhere other
than `/web/` silently mis-parses every deep link.

The failure is silent, which is what makes it expensive:

```text
  a dev server serving the document at base "/" cannot own /web/e/abc.
  the request escapes Vite, reaches the daemon, and the SPA fallback at
  src/daemon/server.ts:1394 returns web/dist/index.html — the PRODUCTION
  bundle, HTTP 200, dead HMR, no error anywhere.
```

### Required design

```text
  web/src/routing/address.ts — a PURE module

      const BASE = "/web/";                 // the single site of this string
      parse(loc: {pathname, search}) -> Parsed | null
      serialize(parsed) -> string

  constraints:
    * no React import, no context, no hooks
    * no window access except an injectable default argument
    * BASE is "/web/" in every environment, including the dev server, so dev
      and production share identical paths
```

Parsing behaviour is identical to today on this branch: the same three forms
(`/web/e/:id`, `/web/t/:id`, `?event=`), the same outputs. Only the coupling
changes.

`EPIC C` depends on this: the dev server's pass-through list is exactly the set
of client-route prefixes, and this module owns them.

## D2 — RUNTIME must not be inferred from ORIGIN

Current coupling:

```text
  web/src/data/daemon.ts:425
      this.baseUrl = (opts.baseUrl ?? window.location.origin).replace(/\/$/, "")
                      ^^^^^^^^^^^^ present, and never passed
```

Deriving the runtime from whoever served the document is the correct *default*
and an incorrect *constraint*. Supplying `opts.baseUrl` from `pickDataSource()`
(`web/src/App.tsx:46`) is what allows a worktree UI to read the production
runtime.

### Required design

```text
  RUNTIME is resolved once, by the launcher, and injected at DataSource
  construction.

  RULE: no component reads RUNTIME or window.location.origin. Every read goes
        through useDataSource(). This keeps a future SharedWorker or desktop-IPC
        DataSource a one-switch change at App.tsx:46.
```

## What this enables

Each supported scenario becomes an assignment of the deployment axes, with the
contract layers identical throughout:

```text
  scenario           ORIGIN                          RUNTIME       BASE   ROUTE
  ────────────────────────────────────────────────────────────────────────────
  production         127.0.0.1:58405                 = ORIGIN      /web/  same
  worktree A dev     a.synchronize-dev...:1355       prod daemon   /web/  same
  worktree B dev     b.synchronize-dev...:1355       prod daemon   /web/  same
  worktree A + dev   a.synchronize-dev...:1355       dev daemon    /web/  same
  popped-out window  inherits opener                 = opener      /web/  same
  desktop (Tauri)    127.0.0.1:58405 external URL    = ORIGIN      /web/  same
  ────────────────────────────────────────────────────────────────────────────
                     ^ varies                        ^ varies      ^ invariant
```

```text
       MANY WORKTREE UIs, ONE PRODUCTION RUNTIME

  worktree A          worktree B          worktree C
       |                   |                   |
       +--- one Vite dev server per worktree ------+
       |  own port (Portless), own HMR, own source
       |  none owns a daemon
       +---------------+---------------------------+
                       | RUNTIME — injected
                       v
              production daemon :58405
```

The desktop app points native windows at daemon URLs
(`WebviewUrl::External`), so `BASE` remains `/web/` there and in-app tabs are
windows at different addresses.

## Testing

```text
  address.ts unit tests    pure input, pure output. No globals, no cleanup,
                           parallel-safe. All grammar coverage lives here.

  DeepLinks.stories.tsx    unchanged. It drives the real Shell through the real
                           History API, which is correct for composed-flow
                           coverage. Its openAt() helper (lines 47-50) mutates
                           global history with manual cleanup — acceptable at
                           that level, and the reason grammar coverage does not
                           belong there.
```

## Acceptance

- `web/src/routing/address.ts` is the only place in `web/src` route handling
  that spells `/web/`; a grep proves it.
- `address.ts` is pure: no React import, no hooks, no unguarded `window` access.
- Parse/serialize behaviour is unchanged for `/web/e/:id`, `/web/t/:id`, `?event=`.
- Existing `DeepLinks.stories.tsx` play tests pass with no modifications.
- `pickDataSource()` passes an explicit `baseUrl`; no component reads
  `window.location.origin`.
- No user-visible URL changes.

## Downstream scope (branch `feat/routing-contract`)

```text
  groups.public_id and the /web/g/:publicId, /web/d/:peerId grammar
  resolvers (/web/e/, /web/r/, /web/g/by-name/) and canonicalisation
  TanStack Router adoption and the loader port
  ?view=pane / ?focus= modifier discipline
  anchor-based scroll restoration, window.open named targets
  scoped per-surface endpoints
```
