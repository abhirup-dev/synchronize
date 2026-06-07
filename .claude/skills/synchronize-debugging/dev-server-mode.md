# dev-server-mode.md

Use a throwaway `SYNCHRONIZE_HOME` when testing daemon/client behavior without
touching the runtime used by live agents.

## Minimal Pattern

```bash
SYNCHRONIZE_HOME=$(pwd)/.dev-synchronize \
SYNCHRONIZE_PORT=0 \
bun run src/daemon.ts
```

Run diagnostics against that runtime with the same env prefix:

```bash
SYNCHRONIZE_HOME=$(pwd)/.dev-synchronize make doctor
SYNCHRONIZE_HOME=$(pwd)/.dev-synchronize bun run src/cli.ts status
```

For remote-profile config checks, use:

```bash
SYNCHRONIZE_HOME=$(pwd)/.dev-synchronize bun run src/cli.ts remote doctor
SYNCHRONIZE_HOME=$(pwd)/.dev-synchronize bun run src/cli.ts remote show
```

## What Moves

All durable runtime state is under `SYNCHRONIZE_HOME`: discovery, database,
media, logs, Pi session manifests, and startup locks. Production stays at
`~/.synchronize` unless the env var is set for that process.

For the full configuration contract, read:

```text
docs/configuration/testing-and-harnesses.md
docs/configuration/runtime.md
docs/configuration/environment.md
```

## Make Targets

| Target | Scope |
|---|---|
| `dev-daemon-kill` | Stops the per-worktree dev daemon. |
| `dev-daemon-relaunch` | Relinks/reinstalls and restarts dev runtime. |
| `dev-clean-slate` | Wipes only `$(CURDIR)/.dev-synchronize`. |
| `dev-reset` | Alias for dev relaunch. |

Target definitions live in `Makefile`; do not re-document their internals here.

## Risk Controls

```text
per-command env prefix  -> avoids leaking dev home into later prod commands
SYNCHRONIZE_PORT=0      -> avoids default-port collision
make inspect-daemon     -> proves which worktree/runtime is serving
```

When launching MCP clients against dev state, launch the client process with
the same `SYNCHRONIZE_HOME`; otherwise it will discover production state.

## See Also

- `daemon-forensics.md` for wrong-worktree and restart decisions.
- `docs/configuration/testing-and-harnesses.md` for harness-specific details.
