# daemon-forensics.md

The single highest-leverage diagnostic in this codebase is **"which worktree
is the daemon actually running from?"** If you change code and the change
doesn't take effect, the daemon is almost certainly running from somewhere
else.

## Provenance check (do this first)

```bash
make inspect-daemon
```

Look at the `worktree:` line. It shows the full `ps -ww` command of the
daemon process. The path after `bun run` is the source-of-truth for which
worktree's code is running.

If that path doesn't match the worktree you're editing in: **you've hit the
daemon-spawn-from-master trap.** Stop and fix this before debugging anything
else.

## The daemon-spawn-from-master trap

The daemon auto-spawns when any MCP client (Claude Code, Pi, Codex)
connects. The MCP binary that spawns it is `synchronize-mcp`, which
`bun link` symlinks to whichever worktree most recently ran `make link`.

So if:
1. Worktree A ran `make link` at some point (or `make install-*`)
2. Worktree B has the code you're editing
3. An MCP client connects with no daemon running

…the daemon will spawn from worktree A. Your edits in worktree B never
execute. This is the most common silent failure during multi-worktree
debugging.

### Recovery

From the correct worktree (the one with your edits):

```bash
make link            # rebinds the symlink to this worktree
make daemon-kill     # stops the wrong-worktree daemon
# next MCP call (or `synchronize status`) auto-spawns from THIS worktree
```

Confirm with `make inspect-daemon` afterward.

## Health probes

```bash
curl -s http://127.0.0.1:58405/status | jq
```

Fields to look at:
- `peers`, `groups`, `events` counts — sanity check against expectations
- `uptime_ms` — has it been restarted recently? Cross-check with operator timeline
- If the call hangs or refuses: daemon is dead or wedged

If `daemon.json` claims a pid but `kill -0 $pid` fails, the file is stale.
Next MCP call respawns; `make daemon-kill` cleans it up immediately.

## Port collision

The daemon binds `DEFAULT_PORT=58405` (see `src/constants.ts`). If two
daemons try to bind it (rare, but happens when an old process leaks):

```bash
lsof -nP -iTCP:58405 -sTCP:LISTEN
```

Each listener is a separate daemon. Kill the unwanted one(s) by pid.

For dev-server mode you can avoid this entirely by setting
`SYNCHRONIZE_PORT=0` (random free port) — see `dev-server-mode.md`.

## Lock cleanup

The daemon writes `~/.synchronize/daemon.lock/` (a directory used as an
exclusive lock during startup). `STALE_LOCK_MS=30s` — locks older than that
are considered stale and overwritten.

If startup fails repeatedly with lock errors and the lock dir is < 30s old,
something is wedged. Remove it manually:

```bash
rm -rf ~/.synchronize/daemon.lock
```

This is safe only when you're certain no daemon process is holding it
(`make inspect-daemon` should show `alive: NO` or no daemon.json at all).

## Restart cascade — what each target preserves

| Target | Stops process? | Wipes state? | Use when |
|---|---|---|---|
| `make daemon-kill` | yes | **no** | You need to restart cleanly without losing peers/groups/messages |
| `make daemon-relaunch` | yes (then starts) | no | Quick bounce — pick up code changes without state loss |
| `make clean-slate` | yes | **yes** (`rm -rf ~/.synchronize`) | You explicitly want a fresh state for testing. Never use on production runtime. |

`daemon-kill` historically wiped state — that's been split so live debugging
sessions don't accidentally nuke their context.

For dev runtime: `dev-daemon-kill`, `dev-daemon-relaunch`, `dev-clean-slate`
behave identically against `./.dev-synchronize`. See `dev-server-mode.md`.

## Pre-flight checklist (before launching a round of agents)

Before kicking off a multi-agent session, confirm:

1. `make inspect-daemon` shows the **expected worktree** in the `worktree:` line
2. `make inspect-peers` shows no leftover peers from a previous unrelated session (soft-deleted is fine; alive-but-unexpected is not)
3. `tmux list-sessions | grep '^sync-'` returns only sessions you intend to use
4. `lsof -nP -iTCP:58405 -sTCP:LISTEN` returns exactly one daemon (or zero, if you want a fresh spawn)
5. Lease setting is sane — `grep DEFAULT_LEASE_MS src/constants.ts`. 7 days is current default; if you've shortened it for testing, peers will start dying naturally faster than you expect.

## Mid-session health check

The shorthand is `make doctor`. It runs all of the above plus peer/group/
event snapshots in one shot. Run it any time something feels off.

## Wind-down — leaving clean state for next session

Default: do nothing. The next session starts where this one left off.
Daemon stays alive (it's lightweight). Peers stay registered. Lease keeps
them online.

If you need to actually wipe (between unrelated test scenarios, or because
state has become corrupted):

```bash
make clean-slate     # wipe production runtime
# or
make dev-clean-slate # wipe dev runtime only
```

Never wipe production runtime if other operators may have running agents
backed by it — soft-deleted peers can be resurrected, but inbox queues and
agent_session bindings are lost.

## Make-target reference (daemon-touching)

| Target | What it does |
|---|---|
| `daemon-kill` | SIGTERM the daemon pid from `daemon.json`; preserves state |
| `daemon-relaunch` | `daemon-kill` then `synchronize status` (which auto-spawns) |
| `clean-slate` | `daemon-kill` then `rm -rf $SYNCHRONIZE_HOME` |
| `dev-daemon-kill` | Same as `daemon-kill` but against `$(CURDIR)/.dev-synchronize` |
| `dev-daemon-relaunch` | Dev daemon restart, also re-runs `link` and `reinstall-books` |
| `dev-clean-slate` | Wipe dev runtime |
| `link` | `bun install && bun link` — rebinds `synchronize-mcp` to this worktree |
| `install-claude` / `install-codex` / `install-pi` | Register MCP server for the named client + copy skill dir into their config |

## See also

- `peer-lifecycle.md` — most "daemon broken" complaints are actually peer issues
- `dev-server-mode.md` — isolated SYNCHRONIZE_HOME for ad-hoc testing
- `glossary.md` — file-and-symbol index when you need to dive into code
