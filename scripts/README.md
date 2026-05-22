# Integration Harness Notes

This directory contains local integration harnesses that exercise
`synchronize` through real terminal surfaces.

## Harnesses

- `integration_tmux.py` launches AoE-managed shell panes and drives the
  `synchronize` CLI directly. Use it for deterministic smoke tests.
- `integration_pi.py` launches real interactive Pi agents through AoE and asks
  them to use the `synchronize` MCP tools. Use it for production-like workflow
  tests.

Both harnesses treat AoE as the cockpit and tmux as the automation substrate.

## Real Pi Workflow Pattern

Use `integration_pi.py` when a workflow needs to prove that real agents can
coordinate over the synchronize control plane.

The harness creates a worktree-local test world:

- `.synchronize-itest/runs/<run-id>/pi-agent`
- `.synchronize-itest/runs/<run-id>/pi-sessions`
- `.synchronize-itest/runs/<run-id>/synchronize-home`
- an isolated AoE profile
- AoE/tmux pane captures and Pi JSONL transcripts

The temporary Pi config copies only `auth.json` from the user's real Pi setup.
All MCP, skill, and extension paths come from the current worktree:

- `bin/synchronize-mcp`
- `extensions/pi-synchronize/src/index.ts`
- `skills/synchronize-pi`

This lets multiple worktrees run different versions of the integration code
without sharing Pi sessions, Pi config, AoE profiles, or synchronize daemon
state.

## Extending Scenarios

For a new workflow scenario:

1. Launch enough Pi sessions for the workflow.
2. Wait for extension auto-registration via `/agent-sessions?tool=pi`.
3. Use REST state to get canonical `peer_id` values.
4. Send short deterministic prompts into the relevant Pi panes.
5. Ask Pi to use MCP tools only, never the CLI.
6. Assert synchronize REST state as the primary source of truth.
7. Assert Pi transcripts contain the expected MCP tool names.
8. Capture panes and transcripts on failure.

Prefer small vertical scenarios over broad scripted conversations. A good
scenario proves one behavior end to end: DM, group join, group send, inbox ack,
media share, conflict handling, or blocked-agent notification.

Keep prompts as high-level as the product flow allows. Do not pass the sender's
own `peer_id`, the recipient `peer_id`, or native Pi session ids into the
prompt unless the scenario is specifically testing low-level identity handling.
For normal workflows, make the agent use `bridge_whoami` for self-awareness and
`bridge_list_peers` / group tools for discovery, then let REST assertions verify
that it selected the right peer.

## tmux Input Caveat

Pi's interactive TUI does not reliably submit prompts with `C-m` under tmux.
Use the named key:

```bash
tmux send-keys -t "$PANE" Enter
```

Use `tmux send-keys -l "$PROMPT"` for literal prompt text, then send named
`Enter` separately.

## Debugging

Run with `--keep` when developing scenarios:

```bash
uv run scripts/integration_pi.py --keep
```

Then inspect with:

```bash
aoe -p <profile> list
aoe -p <profile> session attach <session-name>
tmux list-sessions
tmux capture-pane -p -S -500 -t <pane-id>
```

Without `--keep`, the harness removes AoE sessions/profile and stops the test
daemon. It keeps run diagnostics that are useful for failure analysis.
