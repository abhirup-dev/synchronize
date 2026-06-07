# Backend / Daemon Runtime Navigation

Use this memory to orient yourself in the daemon, then read the referenced files
for details.

## Shape

`src/daemon.ts` is the entrypoint, but the daemon runtime is modularized:

- `src/daemon/server.ts` — startup, runtime config, background workers,
  route wiring, provenance, and web/static serving.
- `src/daemon/routes/` — resource-specific route handlers.
- `src/db.ts` — schema and migrations.
- `src/api/` — typed REST facade used by CLI, MCP, web, tests, and launch flows.
- `src/config.ts` — runtime config resolver.

The daemon remains the only durable-state owner. Other surfaces talk to it
through REST/API helpers.

## Durable invariants

- Non-localhost bind requires bearer-token protection.
- Durable inbox is the fallback for all live delivery modes.
- Peer deletion is soft-delete; stable peer ids can resurrect intentionally.
- Thread replies collapse to a root event rather than nesting.
- Web static serving, web live state, and launch lifecycle are daemon-backed but
  separate concerns.

## Where to verify

- `docs/configuration/` for daemon config and env rules.
- `README.md` for operator workflows.
- `tests/api.test.ts`, `tests/daemon-config-toml.test.ts`,
  `tests/archive-*.test.ts`, and `tests/launch-*.test.ts` for executable
  behavior.
