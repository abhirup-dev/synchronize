# Config unification: one resolver, a bounded env surface

> Status: **Planning — design agreed in principle.** Dedicated epic
> (config-unification), related to `sync-kp1` (multi-machine) which triggered it
> but broader in scope (touches daemon, launch, summary, llm, and the test
> harness).
>
> Builds directly on the profile layer shipped in
> [`multi-machine-cli-devex.md`](./multi-machine-cli-devex.md) (`sync-7mcv`):
> `src/config.ts` + `resolveConnection` already prove the pattern for the
> *connection* vars. This plan generalizes that pattern to all operator config.

## Problem

~40 distinct `SYNCHRONIZE_*` env vars are read via ad-hoc `process.env[...]`
across 16 source files, and **17 test files mutate them** to drive behavior.
Worse, defaults are computed **eagerly at module load** in `constants.ts`
(`positiveEnvMs(ENV_LEASE_MS, …)` runs at import), so config cannot be injected —
which is *exactly why* tests resort to env mutation + subprocess spawning.

## The key decision: two categories, not one

The sprawl comes from treating two different things the same way. Separating them
is what bounds the work and prevents recurrence.

### Category A — operator CONFIG (belongs in the unified resolver)

Stable settings an operator chooses for a deployment. Resolved once as
**defaults < config.toml < env** and read from a typed object, never
`process.env` directly.

| Section | Vars |
|---|---|
| `daemon` | `BIND`, `PORT`, `TOKEN`, `LEASE_MS`, `PEER_RETENTION_MS`, `SWEEP_INTERVAL_MS` |
| connection (done) | `REMOTE_URL`, `TOKEN`, `HEALTH_TIMEOUT_MS` → already in `config.ts` |
| `mcp` | `MCP_HEARTBEAT_MS` |
| `pi` | `PI_POLL_MS`, `PI_HEARTBEAT_MS`, `PI_SKILL_DIRS`, `PI_DEBUG`, `PI_AUTH_SOURCE` |
| `summary` | `SUMMARY_K`, `SUMMARY_STRATEGY`, `SUMMARY_POLL_INTERVAL_MS`, `SUMMARY_FIRST_K`, `SUMMARY_LAST_K`, `SUMMARY_MIN_REPLIES`, `SUMMARY_COLD_AFTER_MS`, `SUMMARY_BATCH_SIZE` |
| `llm` | `LLM_MODEL`, `LLM_PROVIDER` |
| `launch_worker` | `LAUNCH_WORKER_POLL_MS`, `LAUNCH_WORKER_LEASE_MS`, `LAUNCH_WORKER_BATCH_SIZE` |
| `skills` | `CLAUDE_SKILL_DIRS`, `WEB_DIST`, `HOOK_ENABLE` |

### Category B — process IPC / correlation (stays env, deliberately)

Set by a launcher for a *single spawned process*, consumed once, never
user-facing. These are inter-process handoff, not config — putting them in a
config file would be wrong. This is the **bounded env surface** that remains.

| Var | Why it stays env |
|---|---|
| `HOME` | bootstrap: it *locates* the config file (chicken-and-egg) |
| `PEER_ID`, `LAUNCH_ID`, `SESSION_NAME` | per-process identity correlation |
| `MCP_MODE` | per-process adapter role (claude vs codex) |
| `STARTED_BY_CLIENT`, `CONFIGURED_CLI`, `CONFIGURED_MCP`, `CLI`, `MCP` | launch wiring markers |
| `SUMMARY_LIVE_TEST` | test-only marker |

Rule of thumb: **if a launcher injects it per-process, it's IPC (env). If an
operator sets it for a machine, it's config (resolver).**

## Design

```
  defaults (in resolver, ONE place)
        │   <  config.toml  [daemon]/[mcp]/[summary]/…
        │        │   <  process.env  (always wins — tests & one-offs intact)
        ▼        ▼        ▼
   loadRuntimeConfig(paths, env)  ──►  typed RuntimeConfig
        { daemon:{bind,port,token,leaseMs,…}, mcp:{…}, summary:{…}, llm:{…},
          launchWorker:{…}, skills:{…}, remotes, active }
        │
        └─ call sites read config.daemon.leaseMs   (NOT process.env / eager const)
```

- Extends the existing `src/config.ts`. `RuntimeConfig` is a superset that
  includes the connection/profile pieces already there.
- **Defaults move out of `constants.ts` eager reads** into the resolver, so they
  are values, not import-time env snapshots. `constants.ts` keeps only true
  constants (file names, API_VERSION, enums) and env-var *name* constants.
- Back-compat is total: env still overrides, so migration is incremental and
  never breaks a running deployment.

## Test harness strategy (a primary goal)

Today: `Bun.spawn({ env: { SYNCHRONIZE_HOME, SYNCHRONIZE_PORT: "0", … } })` and
in-process `process.env.X = …` mutation.

Target:
- **In-process tests** call `loadRuntimeConfig` with an explicit `env`/overrides
  object (the resolver already takes `env` as a param — see `resolveConnection`).
  No global mutation, no leak between tests.
- **Daemon-subprocess tests** drop a `config.toml` into the per-test temp
  `SYNCHRONIZE_HOME` (already unique per test) instead of threading env. A
  `writeTestConfig(home, overrides)` helper centralizes this.
- A `testConfig(overrides)` builder returns a `RuntimeConfig` for unit tests.

Net: the env soup disappears from test invocations; only `SYNCHRONIZE_HOME` (the
Category-B bootstrap var) is set per test.

## Migration phases (staged, each independently green)

```
1. resolver       loadRuntimeConfig + typed RuntimeConfig; relocate constants.ts
                  eager defaults; connection section folded in.   ← foundation
2. daemon+tunables migrate daemon (bind/port/token/lease/retention/sweep) + mcp/
                  pi/launch_worker reads to the resolver.
3. features        migrate summary/llm/skills reads to the resolver.
4. test harness    writeTestConfig + testConfig helpers; convert env-mutating
                  tests; document the Category-B env surface as the only one left.
```

Each phase keeps env override working, so the suite stays green throughout and
no behavior changes — this is a refactor toward injectability, not a semantics
change.

### Phase 4 status (delivered)

The shared harness lives in `tests/helpers/daemon.ts`:

- `startTestDaemon({ config, env, home, port })` — consolidates the ~10
  duplicated `Bun.spawn` + discovery-poll loops. Tunables go through `config`
  (written to `config.toml` in the per-test home), NOT env.
- `writeTestConfig(home, overrides)` / `configToml(overrides)` — emit the
  `[daemon]`/`[mcp]`/`[remote.*]` TOML the resolver reads.
- `testRuntimeConfig(overrides)` — a resolved `RuntimeConfig` for in-process
  unit tests, no file or env.

Converted off env-mutation onto config.toml: `presence`, `peer-revival`,
`daemon-config-toml`; consolidated onto the harness: `messaging`, `launch-route`.
Remaining `startDaemon` duplicators (`api`, `summary`, `mcp`, `list-my-groups`,
`launch-reconcile`, `health`) can migrate opportunistically — several legitimately
pass Category-B/API-key env and already use the `env` escape hatch.

### The bounded env surface that remains (Category B only)

After unification, the ONLY `SYNCHRONIZE_*` env a caller (or test) sets is:

| Var | Role |
|---|---|
| `SYNCHRONIZE_HOME` | bootstrap — locates the runtime dir + config.toml |
| `SYNCHRONIZE_PORT=0` | tests only — random free port so parallel daemons don't collide |
| `SYNCHRONIZE_PEER_ID` / `LAUNCH_ID` / `SESSION_NAME` | per-process identity correlation (launcher → MCP) |
| `SYNCHRONIZE_MCP_MODE` | per-process adapter role (claude vs codex) |
| `SYNCHRONIZE_STARTED_BY_CLIENT` / `CONFIGURED_CLI` / `CONFIGURED_MCP` / `CLI` / `MCP` | launch wiring markers |
| `SYNCHRONIZE_SUMMARY_LIVE_TEST`, `OPENROUTER_API_KEY` | test/live-smoke markers (via the harness `env` escape hatch) |

Everything else (lease/retention/sweep, bind/port/token, mcp heartbeat, and —
as Phases 2/3 complete — summary/llm/skills/launch-worker tunables) is operator
*config*, resolved from defaults < config.toml < env and read off a typed object.

## Non-goals

- Changing any default value or runtime behavior (pure structural unification).
- Moving Category-B IPC vars into config (explicitly wrong — see taxonomy).
- A hot-reload/watch mechanism for config (resolved per process start is fine).

## Invariants

- `process.env` always overrides config.toml which overrides defaults.
- Category-B env vars remain the deliberate, documented, minimal env surface.
- `constants.ts` holds constants + env-var *names*, not resolved values.
- The connection/profile schema from `sync-7mcv` is unchanged, only absorbed.
