# AoE/tmux Integration Harness

`scripts/integration_tmux.py` is a local smoke harness for checking
`synchronize` through real terminal sessions.

The harness uses:

- Agent of Empires as the session cockpit.
- tmux/libtmux as the automation substrate.
- `synchronize` CLI commands inside AoE-managed shell panes.
- `synchronize` REST state as the primary assertion surface.

It is not part of the normal `bun test` suite and is not required for CI.

The public scripts are thin wrappers. Reusable AoE/tmux/Pi support code lives
under `scripts/integration-aoe/sync_itest_aoe`, with workflow-specific scenarios
under `scripts/integration-aoe/sync_itest_aoe/scenarios`.

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

## Extending the Suite

Add new workflow tests as scenario modules under
`scripts/integration-aoe/sync_itest_aoe/scenarios`. Scenarios should read as
setup, action, assertions, and diagnostics while reusing the shared runtime,
AoE, tmux, REST, and Pi environment helpers. This keeps future group, media,
inbound notification, and blocked-agent workflows from duplicating harness
lifecycle code.

## Real Pi Agent Smoke

`scripts/integration_pi.py` is the manual production-like smoke. It launches
real interactive Pi coding-agent sessions through AoE and asks one Pi agent to
send another Pi agent a `synchronize` DM through MCP.

Run it explicitly:

```bash
uv run scripts/integration_pi.py
```

The Pi harness is intentionally not part of `bun test` or CI. It uses the real
local `pi` binary and the copied OAuth credentials from `~/.pi/agent/auth.json`.

By default it writes worktree-local state under `.synchronize-itest/runs/<id>`:

- a temporary `PI_CODING_AGENT_DIR`
- a temporary `PI_CODING_AGENT_SESSION_DIR`
- a temporary `SYNCHRONIZE_HOME`
- AoE, tmux, REST, pane, and Pi transcript diagnostics

It never writes to the real `~/.pi/agent` directory. The temporary Pi config
loads only:

- `npm:pi-mcp-adapter`
- this worktree's `extensions/pi-synchronize/src/index.ts`
- this worktree's `skills/synchronize-pi`
- this worktree's `bin/synchronize-mcp`

Useful flags:

```bash
uv run scripts/integration_pi.py --keep
uv run scripts/integration_pi.py --profile sync-pi-debug
uv run scripts/integration_pi.py --model gpt-5.4-mini
uv run scripts/integration_pi.py --auth-source ~/.pi/agent/auth.json
```

Use `--keep` to preserve the AoE profile, tmux sessions, temporary Pi home,
temporary Pi sessions, and synchronize daemon state for manual inspection. The
Pi TUI must be submitted with tmux's named `Enter` key; `C-m` does not reliably
submit prompts in this setup.
