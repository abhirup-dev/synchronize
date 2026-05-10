# Blockers: synchronize unified agent messaging platform

## Open Questions

- Exact repository packaging layout is not fixed yet; default to a single Bun workspace unless existing repo constraints require otherwise.
- Exact MCP client behavior for Codex `notifications/message` may need empirical verification once the adapter exists.
- Final media maximum file size and message maximum size should be chosen conservatively during implementation and documented.

## Stop And Ask

- If Codex does not surface `notifications/message` reliably enough for near-real-time delivery.
- If a schema or migration would make existing durable data unreadable.
- If implementing REST/MCP/CLI parity requires dropping a required feature from any surface.
- If LAN support needs anything stronger than shared-token auth in v0.
- If a group history implementation cannot enforce fresh-join isolation without complex policy machinery.
- If user does not confirm a milestone gate after Codex presents evidence.
- If implementation cannot satisfy a requirement in root `PLAN.md` without changing scope.

## Dangerous Or High-Risk Actions

- Deleting or resetting `~/.synchronize`.
- Binding the daemon to non-localhost without token auth.
- Running commands that overwrite user media paths.
- Introducing background processes that cannot be discovered or stopped by CLI.
- Adding non-v0 infrastructure such as cloud services, public tunnels, or remote discovery.
- Changing repository branch/default-branch policy.

## Known Blockers

- Root `PLAN.md` is now the authoritative plan; if it changes, the goal files should be rechecked for consistency.
- The main execution risk is notification behavior variance between Claude and Codex clients.
