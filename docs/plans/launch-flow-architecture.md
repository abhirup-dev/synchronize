# Predictable Production And Worktree Launch Architecture

Status: PROPOSED
Owner: abhirup
Epics: `EPIC A` runtime resolution, `EPIC B` build simplification, `EPIC C` dev server
Companion: `docs/plans/coupling-leaks.md` (same branch)
Downstream: `docs/plans/routing-and-address-model.md` (branch `feat/routing-contract`)

## Goal

Separate four concerns that are currently fused:

1. the production daemon;
2. the production UI bundle;
3. an optional isolated development daemon;
4. a worktree UI development server.

The UI-development command opens the current worktree against an explicitly
selected healthy runtime. It never mutates production assets and never starts,
stops, or restarts a daemon.

## Architecture

```text
                              PRODUCTION

  Browser --https://synchronize.localhost:1355--> [Portless alias]
                                                        |
                                                        v
                                          production daemon :58405
                                          ~/.synchronize, REST + SSE
                                          + immutable web/dist


                          WORKTREE DEVELOPMENT

  Browser --https://<wt>.synchronize-dev.localhost:1355/web/--> [Portless proxy]
                                                                     | PORT
                                                                     v
                                                        Vite dev server
                                                        worktree source + HMR
                                                        forwards API/SSE
                                                                     |
                                                        injected runtime target
                                                                     v
                                             healthy production OR dev daemon
```

Bun remains the production bundler. Vite — already installed for Storybook —
serves development source with HMR. Portless supplies stable per-worktree URLs
and free ports. No custom port allocator, reverse proxy, process registry, or
daemon supervisor.

## Ownership boundaries

| Owner | Owns | Must never do |
|---|---|---|
| Production daemon commands | Production daemon and `~/.synchronize` | Touch worktree UI processes |
| Dev daemon commands | Isolated daemon and its separate home | Touch production runtime |
| Production web build | Production checkout's `web/dist` | Start or restart a daemon |
| Worktree UI launcher | One Vite child and one Portless route | Start/stop/restart/wipe any daemon; overwrite production assets |
| Portless | Friendly URL, free port, route registration | Resolve or recover daemons |
| Vite | Source serving, HMR, API forwarding | Select or manage a daemon |

Portless may run its own routing proxy. That proxy is development
infrastructure, not a Synchronize daemon.

## EPIC A — Non-mutating runtime resolution

### Defect being corrected

`src/client.ts:157` `isHealthy()` returns a bare boolean, collapsing timeout,
wrong service, wrong API version, auth-required and connection-refused into
`false`. `src/client.ts:65` `ensureDaemon()` reads `false` as *absent* and
spawns a daemon — so a hung daemon at the discovered endpoint gets a second
daemon spawned on top of it.

### Required design

```ts
type DaemonProbe =
  | { kind: "healthy"; health: HealthResponse }
  | { kind: "discovery_missing" }
  | { kind: "unreachable"; cause: string }
  | { kind: "timed_out"; timeoutMs: number }
  | { kind: "incompatible"; expected: number; actual: unknown }
  | { kind: "auth_required" };
```

The probe mutates no process and no file, bounds every request with a timeout,
validates service name and API version, preserves `/health` provenance, and
returns typed data rather than deciding policy.

Policy belongs to consumers:

```text
  daemon-status    print the variant. never act.
  web-dev          require healthy, else exit non-zero.
  ensureDaemon()   spawn ONLY on discovery_missing | unreachable.
                   refuse on timed_out | incompatible | auth_required.
```

Stable launcher error codes:

```text
  DAEMON_DISCOVERY_MISSING   DAEMON_UNREACHABLE   DAEMON_TIMEOUT
  DAEMON_API_MISMATCH        DAEMON_AUTH_REQUIRED
  UI_PORT_IN_USE             PORTLESS_ROUTE_IN_USE
```

No error path may invoke `daemon-relaunch`, `daemon-kill`, `clean-slate`,
`portless --force`, or `portless prune`.

## EPIC B — Build simplification

### One template, both bundlers

`web/index.html` carries a real module script and no placeholders:

```html
<script type="module" src="./src/main.tsx"></script>
```

Vite serves it verbatim. Bun consumes the same file as an HTML entrypoint:

```ts
Bun.build({
  entrypoints: ["./index.html"],
  publicPath: "/web/",
  naming: { chunk: "[name].[hash].[ext]", asset: "[name].[hash].[ext]" },
  // entry naming stays DEFAULT so index.html keeps a stable name
})
```

Bun emits a stable `index.html` plus `index.<hash>.js` and `index.<hash>.css`,
rewrites the tags, hoists the script into `<head>`, and injects the stylesheet
link. Those hashed names satisfy the daemon's immutable-cache regex
(`src/daemon/server.ts:1419`). CSS reaches both bundlers through
`web/src/main.tsx` → `web/src/styles/css.ts`, so no CSS placeholder is required.

This removes the `__JS_BUNDLE__` / `__CSS_BUNDLE__` mechanism and the output
scanning at `web/build.ts:60-78`.

### Single asset base

Capacitor is removed. `ASSET_BASE` becomes the literal `/web/`.

```text
  web/build.ts             delete WEB_ASSET_BASE / WEB_DIST_DIR plumbing
  web/build.ts             delete --watch mode
  web/package.json         delete build:watch
  web/index.html           delete __JS_BUNDLE__ / __CSS_BUNDLE__
  Makefile:90-91           delete the second (mobile) build in verify-web
  Makefile:51,78           update help text and comment
  web/src/App.tsx:269-280  delete the Capacitor hardware-back listener
  web/src/shell-mode.tsx   delete the capacitor flag; KEEP responsive sizing
  mobile/                  delete the directory
```

## EPIC C — Worktree dev server

### The dev config is not named `vite.config.ts`

`web/.storybook/main.ts` uses `@storybook/react-vite` and registers
`tailwindcss()` in `viteFinal` because no root `vite.config.ts` exists.
Storybook's builder auto-merges `web/vite.config.ts` if present, which would
apply `base` to Storybook and register Tailwind twice.

```text
  web/vite.dev.config.ts     invoked as: vite --config vite.dev.config.ts
  web/.storybook/main.ts     unchanged
```

### Configuration

- `base: "/web/"`. Client routes live under `/web/`, so Vite's `htmlFallback`
  must own that namespace. Serving the document at `/` lets `/web/e/abc` escape
  Vite and reach the daemon, whose SPA fallback (`src/daemon/server.ts:1394`)
  returns the production bundle with HTTP 200 and dead HMR. Holding `/web/` also
  keeps dev and production paths identical.
- `server.port = Number(process.env.PORT)`. Vite does not read `PORT` itself;
  Portless sets it.
- `strictPort: true`.
- Existing React and Tailwind plugins.

### Forwarding: pass-through list, daemon by default

The app calls fourteen route families and that set grows with every backend
feature. An allow-list proxy fails dev-only and silently when an entry is
missing — Vite's SPA fallback answers `200 text/html`, so `res.json()` throws
`Unexpected token '<'` and presents as a frontend bug. Client-route prefixes are
few, stable, and fail loudly, so they are the list that is maintained by hand.

```text
  requests arriving at the dev server
             |
             v
  [1] Vite internal middlewares — claim /web/@vite/*, /web/src/*,
      /web/@fs/*, /web/node_modules/.vite/*
             |  unclaimed
             v
  [2] configureServer POST hook
        PASS-THROUGH LIST: /web/ exact, plus each client-route prefix from
        web/src/routing/address.ts
          -> next() -> htmlFallback -> dev index.html
             |  everything else
             v
  [3] pipe to the injected daemon URL, stream the response back
        no buffering, no compression, so SSE is unaffected
        /web/state /web/session /web/events /web/attachments /web/resolve
        /groups/* /peers/* /events/* /dm /threads/* /archive/* /resume/*
        /activity/* /agent-sessions/*  and every future route, config-free
```

The POST hook is the correct slot: Vite installs it after its internal
middlewares and before `htmlFallback`, so the rule is positive — a request that
reaches it has already been declined by Vite and therefore belongs to the
daemon. HMR is unaffected because WebSocket `upgrade` events bypass the
middleware chain.

Client-route prefixes come from `address.ts`, so `EPIC D` lands first.

### Portless

```text
  make web-dev
      +-- resolve and probe the selected runtime
      +-- portless run --name synchronize-dev bun run dev:raw
                                    +-- Vite reads PORT/HOST
```

Portless prefixes linked worktrees automatically, producing
`https://<worktree>.synchronize-dev.localhost:1355`. The `synchronize-dev`
namespace keeps development clear of the production alias
`synchronize.localhost`.

`dev:raw` runs Vite without Portless. When Portless is absent the launcher
fails with installation guidance; it never installs or reconfigures the user's
shared Portless service.

## Command contract

| Command | Contract |
|---|---|
| `make daemon-status` | Read-only production discovery, health, provenance |
| `make daemon-relaunch` | Explicit state-preserving production recovery |
| `make dev-daemon-status` | Read-only isolated-runtime status |
| `make dev-daemon-relaunch` | Explicit isolated-runtime recovery |
| `make web-build` | Produce production `web/dist` only |
| `make web-dev [RUNTIME=production\|dev]` | Probe runtime, then start only Portless + Vite |
| `cd web && bun run dev:raw` | Run Vite directly using `PORT`/`HOST` |

`status` means observation. Recovery always has its own verb. `synchronize
status` already autostarts a genuinely absent daemon, which is what
`daemon-relaunch` invokes, so no separate `up` verb exists.
`SYNCHRONIZE_DAEMON_URL`, when set, fully specifies the runtime and takes
precedence over `RUNTIME`.

`CLAUDE.md` describes `daemon-relaunch` as "kill + wipe `~/.synchronize`, start
fresh". That is incorrect — `daemon-kill` preserves state and `clean-slate` is
the wiper. Correct the documentation in this epic.

## Acceptance

- Two worktrees run simultaneously without port or URL collisions.
- A worktree UI uses production data without changing the production daemon or
  production assets.
- A worktree UI can instead use an already-running isolated dev daemon.
- Missing, hung, incompatible, and authenticated daemons produce distinct
  errors and never trigger recovery.
- HTTP API calls and `/web/events` work through the development origin.
- A daemon route added with no dev-config change still reaches the daemon.
- HMR works through Portless.
- Refreshing a client deep link in dev serves the dev bundle, not `web/dist`.
- The production Bun build loads under daemon `/web/`.
- `cd web && bun run storybook` and `bun run test:storybook` pass.
- Starting, rebuilding, and stopping a worktree UI leaves an already-open
  production UI unchanged.

## Reference

T3Code snapshot `41a430a88e8dde9c428f59d54dd328aa6a66a8fd` supplies the
patterns adopted here: a foreground development runner with explicit
child-process ownership, address contracts passed through environment values,
bounded typed readiness checks, strict dev-port ownership, Vite for source
serving, and a built client artifact served by the backend in production.

Its paired-backend ownership does not transfer. A T3Code dev runner may own
both halves of its pair; a Synchronize daemon is a shared runtime with agent
MCP and CLI consumers attached, so the worktree UI launcher holds no authority
over it.

- <https://github.com/pingdotgg/t3code/blob/41a430a88e8dde9c428f59d54dd328aa6a66a8fd/scripts/dev-runner.ts>
- <https://github.com/pingdotgg/t3code/blob/41a430a88e8dde9c428f59d54dd328aa6a66a8fd/apps/web/vite.config.ts>
- <https://github.com/pingdotgg/t3code/blob/41a430a88e8dde9c428f59d54dd328aa6a66a8fd/packages/shared/src/httpReadiness.ts>
- Portless snapshot `15ef06434c81523b1b24db2d52a17caf31edecf1` — <https://github.com/vercel-labs/portless/blob/15ef06434c81523b1b24db2d52a17caf31edecf1/README.md>
