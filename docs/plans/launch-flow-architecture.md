# Predictable Production And Worktree Launch Architecture

Status: PROPOSED
Owner: abhirup
Tracking: `sync-o02e`

## Goal

Make Synchronize launches predictable by separating:

1. the production daemon;
2. the production UI bundle;
3. an optional isolated development daemon;
4. a worktree UI development server.

The normal UI-development command should open the current worktree against an
explicitly selected healthy runtime. It must never mutate production assets or
start, stop, or restart a daemon.

## Decision

- Keep Bun as the production web bundler.
- Use the already-installed Vite dependency for the development UI server and
  HMR.
- Use Portless for stable, collision-free worktree URLs and free UI ports.
- Add one non-mutating typed daemon probe shared by status and launch checks.
- Keep all daemon lifecycle operations behind explicit daemon commands.

Do not build a custom port allocator, reverse proxy, process registry, or daemon
supervisor.

## Current Problem

The production daemon currently owns both runtime APIs and the production UI:

```text
http://127.0.0.1:58405/
├── /health and agent APIs
├── /web/state
├── /web/events       (SSE)
└── /web/*            (web/dist)
```

This creates several traps:

- `web/build.ts --watch` rebuilds files but is not a dev server and has no HMR.
- The daemon serves `web/dist` from its own source checkout unless
  `SYNCHRONIZE_WEB_DIST` was fixed at daemon startup.
- Copying worktree assets into that checkout changes the UI for every production
  browser.
- A `?preview=<worktree>` query cannot choose a different asset directory.
- The web data source uses same-origin API paths, so a separate static server
  cannot reach the live application without a proxy.
- `src/client.ts` currently collapses all failed local health checks to
  “unhealthy,” allowing a hung or incompatible discovered endpoint to be
  mistaken for an absent daemon.

## Target Model

```text
                              PRODUCTION
                              ==========

 Browser
    |
    | https://synchronize.localhost:1355
    v
+-------------------------+
| Portless alias          |  friendly URL only
| -> 127.0.0.1:58405      |
+------------+------------+
             |
             v
+-------------------------------------------+
| Production synchronize daemon             |
|                                           |
| durable home ~/.synchronize               |
| REST + SSE + immutable production web/dist|
+-------------------------------------------+


                         WORKTREE DEVELOPMENT
                         ====================

 Browser
    |
    | https://<worktree>.synchronize-dev.localhost:1355
    v
+--------------------------------+
| Portless routing proxy         |
| worktree name -> free UI port  |
| HTTPS + HMR WebSocket forwarding|
+---------------+----------------+
                |
                | PORT
                v
+-------------------------------------------+
| Worktree Vite UI server                   |
|                                           |
| current worktree source + HMR             |
| proxies HTTP APIs and /web/events         |
| owns only this UI child process           |
+----------------------+--------------------+
                       |
                       | explicit daemon target
                       v
              +--------------------+
              | healthy production |
              | or dev daemon      |
              +--------------------+
```

## Ownership Boundaries

| Owner | Owns | Must never do |
|---|---|---|
| Production daemon commands | Production daemon and `~/.synchronize` | Modify worktree UI processes |
| Dev daemon commands | Isolated daemon and its separate home | Touch production runtime |
| Production web build | Production checkout's `web/dist` | Start or restart a daemon |
| Worktree UI launcher | One Vite child and Portless route | Start, stop, restart, or wipe any daemon; overwrite production assets |
| Portless | Friendly URL, free UI port, route registration | Resolve or recover Synchronize daemons |
| Vite | Development source serving, HMR, API proxy | Select or manage a daemon |

Portless may start its own routing proxy. That proxy is development
infrastructure, not a Synchronize daemon.

## Supported Modes

### Production

```text
production daemon + production web/dist
```

- runtime home: `~/.synchronize`;
- default daemon port: `58405`;
- UI served from the production checkout's built artifact;
- optionally exposed as `https://synchronize.localhost:1355`.

### Worktree UI with production data

```text
worktree Vite UI -> production daemon
```

This is the normal UI development path:

```bash
make web-dev RUNTIME=production
```

It reads real runtime data but changes no production process, state, or asset.

### Worktree UI with isolated development data

```text
worktree Vite UI -> isolated dev daemon
```

Daemon startup remains explicit:

```bash
make dev-daemon-up
make web-dev RUNTIME=dev
```

The UI launcher fails clearly if the selected dev daemon is not already healthy.

### Worktree UI with an explicit runtime URL

```bash
SYNCHRONIZE_DAEMON_URL=http://127.0.0.1:59000 \
  make web-dev RUNTIME=url
```

This uses the same readiness rules and implies no lifecycle authority.

## Command Contract

| Command | Contract |
|---|---|
| `make daemon-status` | Read-only production discovery, health, and provenance |
| `make daemon-up` | Start production only when genuinely absent |
| `make daemon-relaunch` | Explicit state-preserving production recovery |
| `make dev-daemon-status` | Read-only isolated-runtime status |
| `make dev-daemon-up` | Explicit isolated-runtime start |
| `make dev-daemon-relaunch` | Explicit isolated-runtime recovery |
| `make web-build` | Produce production `web/dist` only |
| `make web-dev RUNTIME=...` | Probe runtime, then start only Portless + Vite |
| `cd web && bun run dev:raw` | Run Vite directly using `PORT` and `HOST` |

`status` means observation. Recovery always has its own verb.

## Typed Daemon Boundary

Extract one non-mutating health probe from `src/client.ts`:

```ts
type DaemonProbe =
  | { kind: "healthy"; health: HealthResponse }
  | { kind: "discovery_missing" }
  | { kind: "unreachable"; cause: string }
  | { kind: "timed_out"; timeoutMs: number }
  | { kind: "incompatible"; expected: number; actual: unknown }
  | { kind: "auth_required" };
```

The probe:

- performs no process or filesystem mutation;
- bounds every request with a timeout;
- validates the Synchronize service name and API version;
- preserves daemon provenance from `/health`;
- returns typed data instead of deciding lifecycle policy.

Consumers decide policy:

```text
daemon status   -> print result
daemon up       -> start only when genuinely absent
web-dev         -> require healthy or exit
CLI/MCP ensure  -> may retain intentional absent-daemon autostart, but must
                   refuse timeout, incompatibility, auth failure, or an
                   occupied endpoint
```

Stable launcher errors:

```text
DAEMON_DISCOVERY_MISSING
DAEMON_UNREACHABLE
DAEMON_TIMEOUT
DAEMON_API_MISMATCH
DAEMON_AUTH_REQUIRED
UI_PORT_IN_USE
PORTLESS_ROUTE_IN_USE
```

No error path may invoke `daemon-relaunch`, `daemon-kill`, `clean-slate`,
`portless --force`, or `portless prune`.

## Vite Development Server

Vite, React support, and Tailwind support are already installed for Storybook,
so this needs configuration rather than another framework.

Add `web/vite.config.ts` with:

- `base: "/web/"`;
- `HOST` and `PORT` support;
- `strictPort: true`;
- existing React and Tailwind plugins;
- an explicit daemon proxy target supplied by the launcher;
- HMR that works through `PORTLESS_URL`.

Keep a single HTML template. Make `web/index.html` valid for Vite with a source
entry, and have `web/build.ts` replace that entry with its hashed Bun output for
production and Capacitor builds.

Proxy:

- `/web/state`;
- `/web/session`;
- `/web/events` without buffering;
- `/web/attachments`;
- `/web/resolve`;
- the root daemon API routes used by `DaemonDataSource`.

Do not proxy `/web/` document navigation or Vite assets. The proxy target is the
direct daemon URL, not another Portless UI route.

## Portless

Portless wraps the raw dev server:

```text
make web-dev
    |
    +-- resolve and probe selected runtime
    |
    +-- portless run --name synchronize-dev bun run dev:raw
                                      |
                                      +-- Vite reads PORT/HOST
```

Portless automatically prefixes linked worktrees. This plan worktree resolves
to:

```text
https://launch-flow-architecture-plan.synchronize-dev.localhost:1355
```

Use the separate `synchronize-dev` namespace so development cannot collide with
the existing production alias `synchronize.localhost`.

`dev:raw` remains available without Portless. The friendly launcher should fail
with installation guidance if Portless is missing; it should not silently
install or reconfigure the user's shared Portless service.

## Production Model From T3Code

Borrow these T3Code ideas:

- a single foreground development runner with explicit child-process ownership;
- separate backend and UI address contracts passed through environment values;
- bounded, typed readiness checks;
- strict dev-port ownership;
- Vite for source serving and HMR;
- a built client artifact served by the backend in production.

Do not borrow T3Code's paired-backend ownership. T3Code's development runner can
own both halves of its development pair. A Synchronize production daemon is a
shared runtime used by agents and other UIs, so a worktree UI launcher has no
authority over it.

Synchronize already has the correct production shape:

```text
web source -> Bun build -> web/dist <- production daemon
```

The required rule is simply that worktree previews never write to that artifact.
A future packaged binary can colocate the client with the server, but that is
outside this plan.

## Implementation Slices

### 1. Non-mutating runtime resolution

- Extract typed daemon probing.
- Make status read-only.
- Refuse duplicate autostart for timed-out, incompatible, authenticated, or
  occupied endpoints.
- Add focused health-boundary tests.

### 2. Raw Vite worktree server

- Add `dev:raw`, `/web/` source serving, HMR, HTTP proxy, and SSE proxy.
- Keep Bun production and Capacitor builds unchanged.

### 3. Runtime-aware launcher with Portless

- Require `RUNTIME=production|dev|url`.
- Probe before starting Vite.
- Print resolved UI URL, worktree revision, runtime label, daemon URL, and daemon
  revision.
- Own only the Vite child and Portless route.

### 4. Provenance and documentation

- Make worktree development visibly distinguishable from production.
- Document the command matrix and boundary-specific recovery actions.
- Verify the live production-data path and the isolated-dev path.

## Acceptance

- Two worktrees run simultaneously without port or URL collisions.
- A worktree UI uses production data without changing the production daemon or
  production assets.
- A worktree UI can instead use an already-running isolated dev daemon.
- Missing, hung, incompatible, and authenticated daemons produce distinct
  errors and never trigger recovery.
- HTTP API calls and `/web/events` work through the development origin.
- HMR works through Portless.
- The production Bun build still loads under daemon `/web/`.
- The Capacitor root asset-base build still works.
- Starting, rebuilding, and stopping a worktree UI leaves an already-open
  production UI unchanged.

## Primary References

T3Code snapshot: `41a430a88e8dde9c428f59d54dd328aa6a66a8fd`

- <https://github.com/pingdotgg/t3code/blob/41a430a88e8dde9c428f59d54dd328aa6a66a8fd/scripts/dev-runner.ts>
- <https://github.com/pingdotgg/t3code/blob/41a430a88e8dde9c428f59d54dd328aa6a66a8fd/apps/web/vite.config.ts>
- <https://github.com/pingdotgg/t3code/blob/41a430a88e8dde9c428f59d54dd328aa6a66a8fd/packages/shared/src/httpReadiness.ts>
- <https://github.com/pingdotgg/t3code/blob/41a430a88e8dde9c428f59d54dd328aa6a66a8fd/apps/server/scripts/cli.ts>
- <https://github.com/pingdotgg/t3code/blob/41a430a88e8dde9c428f59d54dd328aa6a66a8fd/apps/server/src/http.ts>

Portless snapshot: `15ef06434c81523b1b24db2d52a17caf31edecf1`

- <https://github.com/vercel-labs/portless/blob/15ef06434c81523b1b24db2d52a17caf31edecf1/README.md>
