# Architecture

## System shape

`synchronize` is local-first: one daemon owns durable state and every other surface is a thin adapter over localhost REST.

```text
Claude/Codex MCP      Pi extension        CLI             Web UI
     stdio              in-process       commands        browser
       \                    |              |              |
        \                   | HTTP JSON    | HTTP JSON    | HTTP/SSE
         \                  |              |              |
          +-----------------+--------------+--------------+
                            |
                    Bun daemon (`src/daemon.ts`)
                            |
             SQLite WAL + filesystem media store
                            |
                 ~/.synchronize discovery/home
```

## Runtime owner

- `src/daemon.ts` owns HTTP routing, auth, SQLite repositories, group/message/inbox/media behavior, peer leases, web state/SSE, agent-session binding, and launch reconciliation.
- `src/db.ts` defines the schema. Key tables include peers, agent_sessions, groups, group_members, events, inbox, media, and web/session support tables.
- `src/paths.ts`, `src/fs.ts`, `src/http.ts`, `src/constants.ts`, and `src/provenance.ts` provide shared runtime helpers.

## Adapter layers

- `src/client.ts` discovers the daemon via `daemon.json` and provides `requestJson` transport.
- `src/api/` is the typed REST facade consumed by CLI and MCP. It is the safest place to add client-facing daemon operations.
- `src/cli/` is argv parsing plus command modules; it can auto-start the daemon.
- `src/mcp/` is the stdio MCP adapter. `SYNCHRONIZE_MCP_MODE=claude` uses a localhost callback subscription; `codex` mode uses polling notifications.
- `extensions/pi-synchronize/` is a co-versioned Pi adapter with its own lightweight REST client and event delivery into Pi user messages.
- `web/src/` is the local React UI over `/web/state` and `/web/events`.

## Launch architecture

- `src/launch/build.ts` builds tool argv and launch env.
- `src/launch/service.ts` validates launch requests, mints launch/peer ids, tracks pending launch intents in memory, applies Claude launch defaults, and exposes consume/stop/pending operations.
- `src/launch/backend.ts` implements the AOE backend: profile readiness, `aoe add --cmd-override`, `aoe session start`, best-effort Claude dev-channel prompt confirmation, stop, and list.
- Daemon `/agent-sessions/launch` calls `LaunchService.launch`; `/agent-sessions/register` calls `reconcileLaunch`; `/agent-sessions/stop` delegates to backend stop.

## Invariants

- Daemon discovery is via `~/.synchronize/daemon.json`; stale PID should cause a relaunch on next client status/ensure path.
- The daemon is the only durable state owner; adapters should not maintain independent durable bus state.
- Group aliases are unique per active group member.
- Durable inbox is the fallback when live channel delivery fails.
- Peer liveness is lease-based; shutdown hooks are not treated as reliable offline signals.
- Launch ids are short-lived correlation keys; peer ids are durable identities.
- Non-localhost bind requires `SYNCHRONIZE_TOKEN` bearer auth.

## High-risk touchpoints

- `src/daemon.ts` route/repository helpers, especially group membership, launch reconciliation, web state caching, and peer leases.
- `src/client.ts` and `src/api/*.ts`, because CLI, MCP, and scripts share them.
- `src/mcp/lifecycle.ts` and `src/mcp/tools/register.ts`, because they decide peer identity and notification activation.
- `src/launch/*` and `scripts/claude-hooks-config.ts`, because AOE launch correctness depends on env propagation, hooks, and backend behavior all lining up.
