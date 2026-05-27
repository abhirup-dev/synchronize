# Integration Harness Notes

This directory contains local integration harnesses that exercise
`synchronize` through real terminal surfaces.

## Harnesses

- `integration_tmux.py` launches AoE-managed shell panes and drives the
  `synchronize` CLI directly. Use it for deterministic smoke tests.
- `integration_pi.py` launches real interactive Pi agents through AoE and asks
  them to use the `synchronize` MCP tools. Use it for production-like workflow
  tests.
- `integration_group_policy_tmux.py` runs deterministic fake-shell group-policy
  workflows through AoE/tmux.
- `integration_group_policy_pi.py` runs a real Pi MCP group-policy workflow
  through AoE/tmux.
- `integration_thread_baton_pi.py` runs the real three-agent Pi thread-baton
  workflow using the legacy tmux-pane assertion path.
- `integration_thread_baton_pi_logs.py` runs the same real Pi thread-baton
  workflow but validates through stateful Pi JSONL session watchers.

Both harnesses treat AoE as the cockpit and tmux as the automation substrate.
The executable files are stable wrappers; shared support code lives under
`integration-aoe/sync_itest_aoe`.

## Code Layout

- `integration-aoe/sync_itest_aoe/runtime.py` owns run ids, command execution,
  logging, JSON helpers, common errors, environment setup, and daemon cleanup.
- `integration-aoe/sync_itest_aoe/aoe.py` owns AoE profile/session lifecycle
  and AoE diagnostics.
- `integration-aoe/sync_itest_aoe/tmux.py` owns tmux pane discovery, pane
  mapping, capture, shell command submission, and Pi prompt submission.
- `integration-aoe/sync_itest_aoe/sync_rest.py` owns synchronize REST access.
- `integration-aoe/sync_itest_aoe/pi_env.py` owns isolated Pi config/session
  provisioning and transcript reads.
- `integration-aoe/sync_itest_aoe/pi_session_*` owns structured Pi JSONL
  watching, normalized session events, and reusable query helpers.
- `integration-aoe/sync_itest_aoe/scenarios/` contains the workflow-specific
  tests.

New workflows should be small scenario modules that compose these primitives.
Avoid reimplementing AoE setup, tmux input, Pi provisioning, REST polling, or
diagnostic capture inside each scenario.

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

The harness installs `npm:pi-mcp-adapter` into the temporary Pi home before
launching interactive panes. Pi's MCP adapter can connect lazily: a pane may
start with `MCP: 0/1 servers` and still be healthy because tool metadata is
cached and the first MCP tool call connects the server. Do not use startup
`MCP: 1/1` as a readiness requirement. Use extension auto-registration,
warmup prompt response, REST state changes, and transcript evidence instead.

## Group Policy Workflows

Use the deterministic CLI workflow first:

```bash
uv run scripts/integration_group_policy_tmux.py --command-timeout 45 --start-timeout 90
```

It covers group creation, descriptions, alias join/rename/leave/reclaim,
threaded history, mention resolution, inbox routing, and roster events without
depending on LLM behavior.

Use the real Pi MCP workflow for production-like agent behavior:

```bash
uv run scripts/integration_group_policy_pi.py --command-timeout 180 --registration-timeout 120 --warmup-timeout 120 --start-timeout 120
```

That scenario launches two Pi agents, waits for pi-extension registration,
sends a no-tool liveness prompt to each pane, then asks the creator agent to
create/join/send to a group and the replier agent to join/read history/send a
thread reply containing an `@alias` mention. The harness validates group
membership aliases, root and reply senders, `parent_event_id`, resolved
`mentions_json`, and thread history through REST.

For a three-agent threaded fanout check, use the thread-baton workflow:

```bash
uv run scripts/integration_thread_baton_pi.py --command-timeout 240 --registration-timeout 120 --warmup-timeout 120 --start-timeout 120
```

It creates a group thread where alpha starts the baton, beta replies with an
`@gamma` mention, gamma replies with an `@alpha` mention, then alpha posts a
final validation reply with no mentions. The harness waits for beta and gamma
to receive that no-mention validation event before prompting them to acknowledge
it, which exercises thread participant push fanout separately from mention
resolution.

Use the watcher-backed sibling when validating the same behavior through Pi's
native session logs instead of terminal text:

```bash
uv run scripts/integration_thread_baton_pi_logs.py --command-timeout 240 --registration-timeout 120 --warmup-timeout 120 --start-timeout 120
```

That runner maps daemon `agent_sessions?tool=pi` bindings to Pi JSONL files,
creates one watcher per session, and asserts assistant markers, actual MCP
tool calls, forbidden tool calls, and injected `<synchronize_event>` envelopes
through structured queries. Pane captures remain diagnostics only.

Run with `--keep` when you want to inspect the live AoE/tmux session:

```bash
uv run scripts/integration_group_policy_pi.py --keep
aoe -p <profile> list
aoe -p <profile> session attach <session-name>
tmux capture-pane -p -S -500 -t <pane-id>
```

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

Prompts must also be explicit about constraints and failure behavior. When a
scenario sends prompts to multiple agents, each prompt should say:

- which tools may be used and which surfaces are forbidden;
- how many times a send/action should happen;
- what the agent should do if a tool call fails or validation is unclear;
- when to stop and report failure instead of retrying;
- whether injected `<synchronize_event>` messages should be ignored or handled.

Do not rely on the agent to infer these boundaries. Ambiguous prompts can create
cyclic reply loops where agents keep treating each other's test messages as new
instructions. Harnesses should detect this from synchronize state early, before
manual pane inspection is needed. For group workflows, prefer a REST-side loop
guard that polls recent group events and warns/fails if the same body or
alternating bodies repeat above a small threshold in a short window. Pane
captures and transcripts should explain the loop after the fact, not be the
first place the maintainer learns it happened.

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
