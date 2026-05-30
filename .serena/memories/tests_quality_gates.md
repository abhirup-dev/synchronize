# Tests And Quality Gates

## Standard gates

- `bun run typecheck` for TypeScript.
- `bun test` for the full Bun suite.
- Use targeted Bun tests while iterating, then broaden based on blast radius.
- Web changes should also run `cd web && bun run typecheck` and `cd web && bun run build`.
- Real-agent behavior may require the Python/AOE harness under `scripts/integration-aoe/`.

## High-value targeted tests

- Backend/API contract: `bun test tests/api.test.ts`.
- Messaging/CLI e2e: `bun test tests/messaging.test.ts`.
- MCP stdio behavior: `bun test tests/mcp.test.ts tests/mcp-e2e.test.ts`.
- Presence/lease behavior: `bun test tests/presence.test.ts tests/peer-revival.test.ts`.
- Agent session hooks/config: `bun test tests/claude-hooks-config.test.ts tests/pi-mcp-config.test.ts`.
- AOE launch behavior: `bun test tests/launch-build.test.ts tests/launch-service.test.ts tests/launch-reconcile.test.ts tests/launch-route.test.ts tests/aoe-backend.test.ts`.

## Launch-specific coverage

- `tests/launch-build.test.ts`: agent command/env construction, Claude dev-channel flags, and launch env variables.
- `tests/launch-service.test.ts`: launch validation, `--model haiku` default for daemon-launched Claude sessions, caller `--model` override, pending intent lifecycle, stop delegation.
- `tests/launch-reconcile.test.ts`: group auto-join, fresh history, standalone no-op, unknown/null launch id no-op, foreign peer id preserving intent, alias-collision join_failed, idempotence.
- `tests/launch-route.test.ts`: daemon route validation for `/agent-sessions/launch`.
- `tests/aoe-backend.test.ts`: AOE command construction, profile/group/add/start order, rollback on start failure, no headless `--launch`, prompt auto-confirm, stop/list parsing.

## Integration harnesses

- `scripts/integration-aoe/sync_itest_aoe/` is the real-agent harness package.
- Use `group_policy_cli.py` for CLI group policy behavior.
- Use `pi_mcp_group_policy.py`, `pi_mcp_dm.py`, `pi_mcp_thread_baton.py`, and `pi_peer_revival.py` for Pi/AOE/MCP multi-agent behavior.
- Harness artifacts are useful postmortem evidence; do not remove artifact writes casually.

## Graphify readiness checks

For unified-memory readiness, also verify:

```bash
graphify benchmark graphify-out/graph.json
graphify query "LaunchService reconcileLaunch bridge_launch agent-sessions launch" --graph graphify-out/graph.json --budget 2400
```

A clean Graphify graph should not route through `.codex`, `.synchronize-itest`, `.serena`, `.beads`, `.demo-synchronize`, `.pytest_cache`, `.claude/worktrees`, or `work/`.
