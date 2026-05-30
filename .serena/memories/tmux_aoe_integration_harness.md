# tmux / AoE Integration Harness Series

Covers the integration harnesses added after the older Serena memories. Search terms: tmux, AoE, integration test, Pi, harness, scripts, real agents.

## Purpose

The repository now has real-agent integration harnesses for validating synchronize across CLI, tmux, AoE, and Pi-style MCP sessions. These are separate from Bun unit/e2e tests and are meant for operator-level confidence in multi-agent behavior.

## Main package

`./scripts/integration-aoe/sync_itest_aoe/` is the reusable Python harness package.

Important modules:

- `runtime.py` — run ids, artifact writing, shared `HarnessError`, output directories.
- `tmux.py` — tmux session/window/pane orchestration.
- `aoe.py` — AoE profile/session orchestration.
- `pi_env.py` — Pi environment setup, including `SYNCHRONIZE_SESSION_NAME`.
- `sync_rest.py` — REST helper for daemon assertions and state inspection.

Scenarios live under `scripts/integration-aoe/sync_itest_aoe/scenarios/`:

- `cli_dm.py` — CLI direct-message smoke.
- `group_policy_cli.py` — deterministic CLI group policy workflow.
- `pi_mcp_dm.py` — real Pi MCP direct-message workflow.
- `pi_mcp_group_policy.py` — Pi MCP group policy workflow.
- `pi_mcp_thread_baton.py` — three-agent thread/mention baton workflow.

## Wrapper scripts

Top-level wrapper scripts make common scenarios easy to run:

- `scripts/integration_tmux.py`.
- `scripts/integration_pi.py`.
- `scripts/integration_group_policy_tmux.py`.
- `scripts/integration_group_policy_pi.py`.
- `scripts/integration_thread_baton_pi.py`.

Check `scripts/README.md` and `docs/integration-tmux.md` before changing invocation semantics.

## Artifact discipline

The harness writes JSON artifacts for validation state. These are useful for debugging failures without re-running every agent interaction. Do not remove artifact writes casually; they are the postmortem trail.

## What the harness validates

- CLI registration and DM flows.
- group alias identity/rename/description behavior.
- thread collapse and history retrieval.
- mention resolution and inbox-vs-push delivery.
- Pi session registration and agent-session bindings.
- real multi-agent baton behavior across Pi sessions.

## Operational notes

The project memory from `bd remember` says Pi interactive sessions under tmux/AoE require tmux named `Enter` (`tmux send-keys ... Enter`) to submit prompts reliably. `C-m` can insert without submitting in the Pi TUI.

These harnesses may depend on local tools, profiles, and interactive-agent behavior. Treat them as high-signal integration checks, not as fast unit tests.
