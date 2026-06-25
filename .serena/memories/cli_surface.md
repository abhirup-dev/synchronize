# CLI Surface Navigation

Use this memory to find the CLI source of truth.

## Where to look

- `src/cli/index.ts` — command dispatcher.
- `src/cli/schema.ts` — typed command/help/completion surface.
- `src/cli/help.ts` — human help rendering.
- `src/cli/commands/` — command implementations.
- `README.md` — user-facing setup and workflows.
- `docs/configuration/` — config/env/remote-profile details by use case.

## Mental model

The CLI discovers, starts, or connects to a daemon through `ensureDaemon()` in
`src/client.ts`, then calls typed helpers from `src/api/`.

Remote profiles are persistent config in `$SYNCHRONIZE_HOME/config.toml`, managed
by `synchronize remote ...`. Env vars remain one-off overrides.

## Guardrails

- Group operations still require explicit `--as <session>` to avoid stale CLI
  identity bugs.
- CLI identity logic belongs in `src/cli/identity.ts`.
- Do not let Serena memory become the CLI reference; use `src/cli/schema.ts`,
  README, and `docs/configuration/` for details.

## Tests

Check `tests/cli-schema.test.ts`, `tests/cli-remote.test.ts`,
`tests/completion-*.test.ts`, and `tests/messaging.test.ts`.
