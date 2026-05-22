# AoE/tmux Integration Harness

`scripts/integration_tmux.py` is a local smoke harness for checking
`synchronize` through real terminal sessions.

The harness uses:

- Agent of Empires as the session cockpit.
- tmux/libtmux as the automation substrate.
- `synchronize` CLI commands inside AoE-managed shell panes.
- `synchronize` REST state as the primary assertion surface.

It is not part of the normal `bun test` suite and is not required for CI.

## Requirements

Install these on the machine running the smoke:

```bash
aoe --version
tmux -V
bun --version
uv --version
```

The Python dependency on `libtmux` is declared inline in the script and is
installed by `uv run`.

## Run

```bash
uv run scripts/integration_tmux.py
```

By default the harness:

1. Creates a unique AoE profile named `sync-itest-<timestamp>`.
2. Starts five AoE custom shell sessions named `sync-agent-1` through
   `sync-agent-5`.
3. Maps those sessions to tmux panes.
4. Runs `synchronize register`, `synchronize dm`, and `synchronize inbox --ack`
   inside the panes.
5. Validates daemon state through REST.
6. Removes the AoE sessions/profile and temporary `SYNCHRONIZE_HOME`.

Useful flags:

```bash
uv run scripts/integration_tmux.py --keep
uv run scripts/integration_tmux.py --agents 5
uv run scripts/integration_tmux.py --profile sync-itest-debug
uv run scripts/integration_tmux.py --log-dir /tmp/sync-itest
```

Use `--keep` when debugging. It preserves the AoE profile and tmux sessions so
you can inspect them with AoE or raw tmux.

## Diagnostics

Every run writes a log directory. On failure, the directory includes:

- harness run summary and preflight details
- AoE `list --json` and `status --json` output
- tmux pane discovery output
- captured pane output for all test agents
- synchronize `/status`, `/peers`, and scenario validation data when available

REST state is the pass/fail source. Direct SQLite inspection is reserved for
future diagnostics and should not become the primary assertion path.
