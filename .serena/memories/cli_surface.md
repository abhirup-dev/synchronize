# CLI Surface Series

Covers current CLI command architecture and new command surfaces. Search terms: CLI, commands, group, hook, launch, top, register, identity.

## Architecture

`src/cli/index.ts` is the side-effect-free `main(argv)` dispatcher. `src/cli.ts` is the script shim with `import.meta.main` guard. Per-command modules live under `src/cli/commands/` and expose `run(argv)`.

The CLI auto-starts/discovers the daemon through `ensureDaemon()` in `src/client.ts`, then calls typed functions from `src/api/`.

CLI identity guardrails live in `src/cli/identity.ts`. Do not move them into `src/api/` or the daemon without intentionally changing trust boundaries.

## Commands to remember

Existing command families:

- `status`, `top`, `register`, `whoami`, `peers`, `dm`, `inbox`, `group`, `media`.

Newer command families:

- `hook` — supports agent auto-registration flows, especially Claude/Pi-style hooks.
- `launch` — supports launching/registration workflows around agent sessions.

Group command additions:

- create with `--description`.
- rename alias inside group.
- history with `--thread-of EVENT_ID`.
- send with thread/mention semantics through API arguments.

Media command addition:

- `media share` supports `--description TEXT`.

## Rendering

`src/cli/render/summary.ts` and `src/cli/render/table.ts` are shared terminal render helpers. Recent changes added richer summary output for new group/thread/session state.

## Identity/session behavior

The CLI still requires explicit `--as <session>` on group operations to avoid stale identity bugs. That guard is CLI-local.

Agent-session auto-registration introduced `SYNCHRONIZE_SESSION_NAME`; hook/launch commands and integration harnesses use it to bind native host sessions to synchronize peer state.

## Useful files

- `src/cli/index.ts` — dispatcher.
- `src/cli/help.ts` — command documentation and current UX contract.
- `src/cli/identity.ts` — identity persistence/guardrails.
- `src/cli/commands/group.ts` — most policy-heavy CLI command.
- `src/cli/commands/hook.ts` and `src/cli/commands/launch.ts` — agent-session/hook additions.
- `tests/messaging.test.ts` — CLI spawn/end-to-end coverage.
- `scripts/integration-aoe/sync_itest_aoe/scenarios/group_policy_cli.py` — real CLI integration workflow.
