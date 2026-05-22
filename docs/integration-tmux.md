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

## Group Policy Scenarios

Group-policy v0 has two local AoE-backed harnesses:

```bash
uv run scripts/integration_group_policy_tmux.py
uv run scripts/integration_group_policy_pi.py
```

Use the deterministic tmux harness as the stable regression layer. It launches
fake shell agents and drives the `synchronize` CLI directly, so it should be the
first choice when validating daemon semantics such as:

- group identity creation and description updates
- alias join, rename, leave, and reclaim behavior
- default history versus thread history
- `@alias` mention resolution
- inbox delivery for group messages and roster events

Use the real Pi harness as a manual/local smoke. It launches actual interactive
Pi agents through AoE and asks them to use MCP tools for the same kind of
workflow. It is intentionally more expensive and less deterministic than the
fake-shell harness, but it proves the product path where agents discover their
own identity and coordinate through the synchronize MCP control plane.

The real Pi group-policy workflow is:

```text
AoE/tmux launches two Pi agents
        |
        v
pi-extension auto-registers both peers with synchronize
        |
        v
harness sends a no-tool warmup prompt to each Pi pane
        |
        v
creator Pi:
  bridge_whoami
  bridge_list_peers
  bridge_create_group
  bridge_join_group(alias="alpha")
  bridge_send_group(root marker)
        |
        v
replier Pi:
  bridge_whoami
  bridge_list_groups
  bridge_join_group(alias="beta")
  bridge_group_history(find root event)
  bridge_send_group(in_reply_to=<root>, message contains @alpha)
        |
        v
harness validates REST group state, aliases, mentions_json, and thread history
```

The Pi prompt should stay self-discovery based. Do not pass a Pi agent its own
`peer_id`, native session id, or the exact destination peer id unless a scenario
is explicitly testing low-level identity handling. Prefer `bridge_whoami`,
`bridge_list_peers`, `bridge_list_groups`, and group history tools, then assert
the canonical REST state from the harness.

Pi's MCP adapter may connect lazily. A pane that shows `MCP: 0/1 servers` can
still be healthy if the tool metadata cache is available; the first MCP tool
call may connect the server and flip the footer to `MCP: 1/1 servers`. Harnesses
should not treat startup `MCP: 0/1` as a failure. Instead, validate:

- pi-extension registration appears in `/agent-sessions?tool=pi`
- the interactive pane answers the warmup prompt
- the workflow causes expected REST state changes
- transcripts contain the expected MCP tool names

Useful group-policy commands:

```bash
uv run scripts/integration_group_policy_tmux.py --command-timeout 45 --start-timeout 90
uv run scripts/integration_group_policy_pi.py --command-timeout 180 --registration-timeout 120 --warmup-timeout 120 --start-timeout 120
```

Use `--keep` for manual inspection:

```bash
uv run scripts/integration_group_policy_pi.py --keep
aoe -p <profile> list
aoe -p <profile> session attach <session-name>
tmux list-sessions
tmux capture-pane -p -S -500 -t <pane-id>
```

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
uv run scripts/integration_pi.py --thinking low
uv run scripts/integration_pi.py --auth-source ~/.pi/agent/auth.json
```

Use `--keep` to preserve the AoE profile, tmux sessions, temporary Pi home,
temporary Pi sessions, and synchronize daemon state for manual inspection. The
Pi TUI must be submitted with tmux's named `Enter` key; `C-m` does not reliably
submit prompts in this setup.
