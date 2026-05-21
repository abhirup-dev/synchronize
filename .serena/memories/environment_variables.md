# Environment Variables

All env vars are read by the daemon and/or MCP adapter at process start.

| Var | Default | Used by | Purpose |
|-----|---------|---------|---------|
| `SYNCHRONIZE_HOME` | `~/.synchronize` | daemon, CLI, MCP | Runtime directory: `daemon.json`, `daemon.lock/`, `synchronize.db*`, `cli-peer.json`, `media/`. Override with `/tmp/...` when testing. |
| `SYNCHRONIZE_BIND` | `127.0.0.1` | daemon | Bind host. Non-localhost → token required. |
| `SYNCHRONIZE_PORT` | `0` (random) | daemon | Port. `0` picks a free port; the chosen port is written to `daemon.json` for discovery. |
| `SYNCHRONIZE_TOKEN` | unset | daemon + clients | Bearer token. **Required** when `SYNCHRONIZE_BIND != 127.0.0.1`. Clients must send `Authorization: Bearer <token>`. |
| `SYNCHRONIZE_MCP_MODE` | `codex` | MCP adapter | `codex` → `notifications/message` via polling `NotificationBridge`. `claude` → `notifications/claude/channel` via one-shot HTTP callback `EventSubscription`. |

## Runtime layout under `SYNCHRONIZE_HOME`
```
~/.synchronize/
  daemon.json              ← { baseUrl, pid, ... } — discovery file
  daemon.lock/             ← launch lock directory (atomic-mkdir lock)
  synchronize.db           ← SQLite WAL primary
  synchronize.db-wal
  synchronize.db-shm
  cli-peer.json            ← persisted CLI peer identity
  media/
    <group>/
      index.jsonl          ← greppable media index
      README.md
      <copied files>
```

## LAN-mode setup (non-localhost)
```bash
export SYNCHRONIZE_BIND=0.0.0.0
export SYNCHRONIZE_PORT=8787
export SYNCHRONIZE_TOKEN='replace-with-a-secret'
bun run src/daemon.ts
```
Clients must export the same `SYNCHRONIZE_TOKEN`. The daemon validates `Authorization: Bearer <token>` on every request.

## Why these defaults
- `BIND=127.0.0.1` + no token = safe local default.
- Non-localhost forces a token via daemon-side `assertLanModeIsProtected` (see `src/daemon.ts`).
- Random port avoids collisions when multiple developers run the daemon on the same machine (e.g. via different `SYNCHRONIZE_HOME`s).
