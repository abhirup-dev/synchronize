# dev-server-mode.md

When you need to test daemon changes, run throwaway demos, or experiment
with agent flows without touching the runtime your live agents depend on —
use dev-server mode.

## The core idea

Every piece of synchronize runtime state lives under `$SYNCHRONIZE_HOME`:

- `synchronize.db` — the SQLite database
- `daemon.json` — discovery (pid/port/base_url)
- `pi-extension.log` — extension lifecycle log
- `media/` — group media assets
- `pi-sessions/` — Pi session manifest files
- `daemon.lock/` — startup lock

Override that env var and the entire runtime moves. The default is
`~/.synchronize`; the convention for an isolated dev runtime is
`$(CURDIR)/.dev-synchronize` (per-worktree, so it doesn't collide with
other branches).

```bash
export SYNCHRONIZE_HOME=$(pwd)/.dev-synchronize
```

Production agents remain bound to `~/.synchronize` and are unaffected.

## Make targets for dev runtime

The Makefile uses `DEV_SYNC_HOME := $(CURDIR)/.dev-synchronize`.

| Target | What it does | Preserves state? |
|---|---|---|
| `dev-daemon-kill` | Stops the dev daemon | **yes** |
| `dev-daemon-relaunch` | Stops + relinks + reinstalls books + starts | yes |
| `dev-clean-slate` | Stops + `rm -rf $DEV_SYNC_HOME` | **no** (full wipe) |
| `dev-reset` | Alias for `dev-daemon-relaunch` | yes |

All four are scoped to `DEV_SYNC_HOME` and will never touch your real
`~/.synchronize`.

## Running diagnostics against the dev runtime

`make doctor` and the `inspect-*` targets honor `SYNCHRONIZE_HOME`. Override
on the command line:

```bash
SYNCHRONIZE_HOME=$(pwd)/.dev-synchronize make doctor
SYNCHRONIZE_HOME=$(pwd)/.dev-synchronize make inspect-peers
```

Same for the underlying script directly:

```bash
SYNCHRONIZE_HOME=$(pwd)/.dev-synchronize bash scripts/doctor.sh all
```

And for the CLI itself:

```bash
SYNCHRONIZE_HOME=$(pwd)/.dev-synchronize bun run synchronize top
SYNCHRONIZE_HOME=$(pwd)/.dev-synchronize bun run synchronize status
```

## Port collisions with the prod daemon

Both daemons default to `DEFAULT_PORT=58405`. If your prod daemon is
already bound there, the dev daemon will fail to start with a bind error.

Options:
1. **Random port**: `SYNCHRONIZE_PORT=0 SYNCHRONIZE_HOME=...` — daemon picks a free port and writes it to `daemon.json`. Clients discover via `daemon.json`, so this works transparently.
2. **Specific port**: `SYNCHRONIZE_PORT=58406 SYNCHRONIZE_HOME=...` — use when you want predictability across restarts.
3. **Stop prod first**: `make daemon-kill` if you don't need the prod daemon alive while testing.

`SYNCHRONIZE_PORT=0` is the safest default for ad-hoc dev runs.

## Pointing MCP clients at the dev daemon

The harder part of dev-server mode: MCP clients (Claude Code, Pi) discover
the daemon via `daemon.json`, which is keyed off `SYNCHRONIZE_HOME`. To make
an MCP client talk to your dev daemon, you must launch the client with
`SYNCHRONIZE_HOME` set to `DEV_SYNC_HOME`.

For Claude Code launched from a terminal:
```bash
SYNCHRONIZE_HOME=$(pwd)/.dev-synchronize claude
```

For Pi via tmux: prefix the tmux session launch with the env var, or
`export` it before `pi` starts.

`make install-claude` / `install-pi` / `install-codex` register the MCP
server using the default `~/.synchronize`. The dev runtime relies on you
overriding the env at client-launch time, not on a separate MCP
registration.

## Recipes

### "I want to test a daemon change in isolation"

```bash
# In your edit worktree:
make link                                    # rebind the symlink here
SYNCHRONIZE_PORT=0 \
  SYNCHRONIZE_HOME=$(pwd)/.dev-synchronize \
  bun run src/daemon.ts &                    # start dev daemon
SYNCHRONIZE_HOME=$(pwd)/.dev-synchronize \
  bun run src/cli.ts top                     # smoke test
```

Confirm with `make inspect-daemon` (override env). Inspect the daemon's
`worktree:` line — it should point at the worktree you just edited.

### "I want a throwaway round of agents without polluting prod"

```bash
make dev-clean-slate          # start from zero
make dev-daemon-relaunch      # start dev daemon, port-collision-prone
# launch agents with SYNCHRONIZE_HOME pointing at DEV_SYNC_HOME
# play with them
make dev-clean-slate          # wipe when done
```

For repeatable demo seeds: `SYNCHRONIZE_HOME=$(pwd)/.dev-synchronize bun
run scripts/seed-demo.ts` populates groups + messages programmatically.

### "I want to A/B compare prod vs dev state"

```bash
make doctor                                                   # prod snapshot
SYNCHRONIZE_HOME=$(pwd)/.dev-synchronize make doctor          # dev snapshot
```

Diff manually. Useful for verifying that a behavioral change you made in
the daemon code actually affects state the way you expected.

## Common foot-guns

| Trap | How it bites | Fix |
|---|---|---|
| Env var leaked into prod tooling | You set `SYNCHRONIZE_HOME=...dev...` in your shell, forget about it, and `make doctor` reports on the wrong runtime | Unset when done, or set it per-command (don't `export`) |
| Port collision with prod | Dev daemon fails to start, with cryptic bind error | Use `SYNCHRONIZE_PORT=0` or kill prod daemon first |
| MCP client connects to prod daemon by accident | You ran `claude` without `SYNCHRONIZE_HOME` set; MCP adapter discovered prod and registered there | Always prefix client launches when testing |
| `install-*` from dev worktree symlinked `synchronize-mcp` to dev code, breaking prod | `make link` always rebinds — running it in dev affects prod-daemon-spawn too | Re-run `make link` from your prod-canonical worktree afterward |
| Demo seed script ran against prod | You forgot to set `SYNCHRONIZE_HOME` and `scripts/seed-demo.ts` wrote groups to prod | Always prefix; check `make inspect-groups` after to confirm |

## When NOT to use dev-server mode

- For diagnosing a live production bug — you need to inspect the actual
  runtime that's misbehaving. Use prod `make doctor` directly.
- For final integration testing of changes that will be merged — at some
  point you need to verify against prod runtime semantics (same default
  port, same `~/.synchronize` location).
- For multi-machine scenarios — dev mode is single-machine only.

## See also

- `daemon-forensics.md` — port collision diagnosis, daemon-spawn-from-master
  trap (which is dev-mode-adjacent)
- `glossary.md` — where `SYNCHRONIZE_HOME`, `DEFAULT_PORT`, `DEV_SYNC_HOME`
  are defined in code/Makefile
