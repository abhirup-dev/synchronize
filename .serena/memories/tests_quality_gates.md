# Tests And Quality Gates Series

Covers current test coverage and where new behavior is locked in. Search terms: tests, quality gates, api.test, mcp-e2e, messaging, integration harness.

## Standard quality gates

The older task completion checklist still applies: run typecheck/tests when code changes. The project uses Bun/TypeScript tests plus optional integration harnesses.

Common commands are still:

- `bun run typecheck`.
- `bun test`.
- targeted `bun test tests/api.test.ts` for daemon/API behavior.
- targeted `bun test tests/mcp-e2e.test.ts` for MCP stdio behavior.

## Current high-value test files

`tests/api.test.ts` is now the most important executable spec for backend behavior. It covers:

- agent session bindings upsert/rename.
- group member `host_session_id` surfacing.
- alias rename audit event.
- group description create/list/patch/clear.
- mention resolution, unresolved warnings, self-mention filtering.
- thread reply collapse and history filtering.
- `/threads/:root` endpoint behavior.
- backtick carve-out for mention parsing.
- peer soft-delete resurrection.

`tests/mcp-e2e.test.ts` covers:

- full stdio MCP behavior.
- structured `{ error: { code, message, status? } }` error envelopes.
- parsed `mentions` output and no raw `mentions_json` in MCP responses.
- `bridge_group_history` modes and invalid `event_ids` + `thread_of` combination.

`tests/messaging.test.ts` covers CLI spawn/end-to-end behavior, including session-name/hook-adjacent flows.

`tests/peer-id-env.test.ts` covers `SYNCHRONIZE_PEER_ID` sticky peer id behavior.

`extensions/pi-synchronize/tests/subscription.test.ts` covers Pi subscription callback behavior.

## Integration harnesses

The Python harness under `scripts/integration-aoe/` is the higher-fidelity validation layer for real CLI/tmux/AoE/Pi workflows. It complements the Bun suite and should be used for changes that affect live multi-agent behavior.

Important scenarios:

- `group_policy_cli.py` for CLI group policy.
- `pi_mcp_group_policy.py` for Pi group policy.
- `pi_mcp_thread_baton.py` for real multi-agent thread/mention baton.

## When to broaden tests

Use `tests/api.test.ts` for daemon contract changes. Add MCP e2e coverage when changing tool response shape or descriptions that agents depend on. Run/extend AoE harnesses when the change affects real host integration, tmux submission, Pi delivery, or multi-agent coordination.
