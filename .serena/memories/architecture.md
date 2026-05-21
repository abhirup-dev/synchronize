# Architecture

## Layers

```
   Claude MCP   Codex MCP   Pi extension   synchronize CLI
   stdio        stdio       in-process     human/operator
       \           |           |              /
        \          | HTTP JSON |             /
         `--------(REST + callback subscription)--'
                             |
                    +--------v---------+
                    | synchronize      |
                    | daemon           |  (Bun HTTP, 127.0.0.1, random port)
                    +--------+---------+
                             |
              +--------------+--------------+
              v              v              v
        SQLite WAL DB   MediaStore FS  discovery + lock
                                       (~/.synchronize/)
```

The Pi extension (`extensions/pi-synchronize/`) is structurally a fourth adapter: it discovers the daemon via `~/.synchronize/daemon.json`, registers a peer over REST, opens a Claude-channel-style callback subscription, and forwards each delivered `Event` into the host Pi session as a `pi.sendUserMessage` (steer / followUp / nextTurn). It ships its own REST client (`extensions/pi-synchronize/src/client.ts`) because Pi runs the extension without the rest of the workspace.

**Key invariant**: the daemon is the *only* component that owns durable state. CLI and MCP are pure REST adapters over `src/client.ts`. After phase-1 refactor, `rg "requestJson" src/cli src/mcp` is empty — adapters call through the typed `src/api/` facade, never raw transport.

## Layer responsibilities

- **`src/daemon.ts`** (~1077 LOC, monolithic — phase-2 target). Owns route dispatch, validation, SQLite repository, media filesystem behavior, event subscription fanout, server startup.
- **`src/api/`** — typed REST operation facade. Domain-split modules: `status.ts`, `peers.ts`, `inbox.ts`, `events.ts`, `groups.ts`, `media.ts`, plus shared `types.ts`. `src/api.ts` is a 1-line compat shim (`export *`).
- **`src/cli/`** — argv parsing + per-command modules under `commands/`, terminal rendering under `render/`. `src/cli.ts` is a shim with `import.meta.main` guard so it can double as a script. Auto-starts daemon via `ensureDaemon()`.
- **`src/mcp/`** — MCP stdio server. Factory-closure pattern: `createMcpServer()` builds private `AdapterState`, threads `{ mcp, state, emit, lifecycle }` as `ToolContext` into tool registrars in `src/mcp/tools/`.
- **`src/client.ts`** — daemon discovery (`~/.synchronize/daemon.json`) + `requestJson` transport. Consumed by `api/`, `cli/`, `mcp/`.
- **`src/db.ts`, `src/fs.ts`, `src/http.ts`, `src/paths.ts`, `src/constants.ts`** — shared low-level helpers.
- **`extensions/pi-synchronize/`** — out-of-tree Pi coding-agent adapter. `index.ts` wires `session_start` → register peer + subscribe; `subscription.ts` mirrors `EventSubscription` (one-shot HTTP callback); `delivery.ts` maps daemon `Event` → Pi `sendUserMessage` (steer/followUp); `log.ts` always-on file logging at `~/.synchronize/pi-extension.log`.

## God nodes (most-connected abstractions)

From graphify analysis: `requestJson()` (34 edges), `ensureDaemon()` (30 edges), `route()` (28 edges), `ClientConfig`, `parseFlags()`, `ensureDir()`, `requireIdentity()`, `Event`, `EventSubscription`. These are the cross-cutting touchpoints — touch with care.

## Key invariants

- **Daemon discovery** via `~/.synchronize/daemon.json` (`baseUrl`, `pid`). Stale PID → next `synchronize status` relaunches.
- **Group aliases** are unique per group. CLI commands require explicit `--as <session>` to prevent stale-identity bugs.
- **Ephemeral groups** are dropped on daemon start. Durable groups/messages retained indefinitely in v0 (no retention policy yet).
- **Non-localhost bind** (`SYNCHRONIZE_BIND != 127.0.0.1`) requires `SYNCHRONIZE_TOKEN` (Bearer auth).
- **Durable inbox** is the universal fallback whenever channel/notification delivery fails. MCP adapter is intentionally thin — it does not replay missed deliveries on its own.
- **CLI identity guardrails** (`requireIdentity`, `resolveCliRegisterPeerId`, `--as` enforcement) live in `src/cli/identity.ts` only. They are NOT in `src/api/` and NOT in the daemon — the daemon trusts its REST callers.
