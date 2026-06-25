# daemon-forensics.md

Use this for daemon health, wrong-worktree provenance, stale discovery files,
port collisions, startup locks, and restart decisions.

## First Check

```bash
make inspect-daemon
```

The `worktree:` line is the most important field. It is the command for the
daemon process that is actually serving clients. If it points at a different
worktree than the one you are editing, fix provenance before debugging code.

For remote/profile questions, use the CLI doctor instead of the local runtime
snapshot:

```bash
synchronize remote doctor
synchronize remote show
```

That path validates active profile resolution, reachability, auth, and API
version. It does not replace `make doctor` for local process/DB inspection.

## Current Runtime Sources

| Need | Go to |
|---|---|
| Diagnostic implementation | `scripts/doctor.sh` |
| Make targets | `Makefile` |
| Remote/profile doctor | `src/cli/commands/remote.ts`, `src/remote/status.ts` |
| Discovery/autostart | `src/client.ts` |
| Daemon startup/context | `src/daemon/server.ts` |
| Runtime config and precedence | `docs/configuration/runtime.md`, `src/config.ts` |
| Test/dev runtime isolation | `docs/configuration/testing-and-harnesses.md` |

## Wrong-Worktree Trap

MCP clients auto-spawn through the currently linked `synchronize-mcp`. The link
belongs to whichever worktree most recently ran `make link` or an install
target. If no daemon is running, the next MCP call can therefore start a daemon
from an older worktree.

Recovery from the intended worktree:

```bash
make link
make daemon-kill
make inspect-daemon
```

The next `synchronize status` or MCP call should spawn from the relinked
worktree. Keep production runtime state intact unless the operator asks for a
wipe.

## Restart Decision

```text
Need only current facts?
  -> make doctor / inspect-*

Need code changes picked up while preserving DB/media/inbox?
  -> make daemon-kill or make daemon-relaunch

Need a repro that must not touch production runtime?
  -> SYNCHRONIZE_HOME=$(pwd)/.dev-synchronize SYNCHRONIZE_PORT=0 ...

Need to wipe production runtime?
  -> only after explicit operator approval
```

## State-Preserving Targets

| Target | Effect |
|---|---|
| `make daemon-kill` | Stops daemon pid from `daemon.json`; preserves runtime state. |
| `make daemon-relaunch` | Stops daemon, then starts via `synchronize status`; preserves state. |
| `make clean-slate` | Stops daemon and wipes `$SYNCHRONIZE_HOME`; production-destructive. |
| `make dev-daemon-kill` | Same as daemon-kill against `$(CURDIR)/.dev-synchronize`. |
| `make dev-daemon-relaunch` | Relinks/reinstalls and restarts dev runtime. |
| `make dev-clean-slate` | Wipes dev runtime only. |

For full details, read `Makefile` and `scripts/doctor.sh`; this skill should
not duplicate every target body.

## Common Checks

```bash
lsof -nP -iTCP:58405 -sTCP:LISTEN
```

Use this only after `make inspect-daemon` when a port collision is plausible.
For dev runs, prefer `SYNCHRONIZE_PORT=0`.

If startup mentions `daemon.lock`, confirm no daemon is alive before removing
the lock directory. Lock and timeout constants live in `src/constants.ts`; config
knobs live in `docs/configuration/`.

## See Also

- `dev-server-mode.md` for isolated runtime workflow.
- `peer-lifecycle.md` when daemon health is fine but peers are missing.
- `docs/debugging/sql-queries.md` for DB inspection.
