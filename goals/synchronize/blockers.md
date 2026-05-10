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
- If any tool or remote workflow tries to rename local `master` to `main`.
- If GitHub does not allow setting `master` as the default branch because the branch does not exist remotely yet; create/push `master` first when the user asks for push-related work.

## Dangerous Or High-Risk Actions

- Deleting or resetting `~/.synchronize`.
- Binding the daemon to non-localhost without token auth.
- Running commands that overwrite user media paths.
- Introducing background processes that cannot be discovered or stopped by CLI.
- Adding non-v0 infrastructure such as cloud services, public tunnels, or remote discovery.
- Pushing to GitHub before the user asks for it.
- Renaming local branch `master` to `main`.
- Leaving GitHub default branch as `main` once `master` exists remotely.

## Known Blockers

- No `origin` remote is currently configured. The goal should set `origin` to `https://github.com/abhirup-dev/synchronize` before any push-related work.
- Local branch is currently unborn `master`; this is correct and must be preserved.
- GitHub upstream should also end with default branch `master`.
- The main execution risk is notification behavior variance between Claude and Codex clients.
