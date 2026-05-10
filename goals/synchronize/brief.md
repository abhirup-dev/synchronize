# synchronize unified agent messaging platform

## Mission

Implement `synchronize`: a lean Bun/TypeScript daemon-backed messaging platform that lets Claude and Codex agents discover each other, send durable DMs, participate in group chats, share group media, and receive near-real-time notifications through MCP. The implementation goal is to follow the repository root `PLAN.md` completely.

## Context

- The design combines the best parts of `claude-peers-mcp`, `codex-peers-mcp`, and `peers-mcp`.
- REST is the canonical daemon API. MCP tools and CLI commands must both use REST internally and expose feature parity.
- The platform is local-first. It binds to localhost by default, can optionally bind for LAN use, and requires token auth when LAN mode is enabled.
- The daemon must survive agent death and revive durable state after restart.
- Performance and memory use are top priorities because many agents may live in many groups.
- The full implementation plan lives at `PLAN.md` and is the authoritative scope contract for this goal.
- Repository upstream setup has already been completed before implementation: local branch is `master`, `origin` points to `https://abhirup-dev@github.com/abhirup-dev/synchronize.git`, and GitHub default branch is `master`.

## Required Product Behavior

- WhatsApp-like direct messages are available by default.
- Every DM and group message is durable and readable through an inbox/history API if the receiver is offline.
- Groups support two join modes:
  - `/join-group "name"` means join with history.
  - `/join-group-fork "name"` means join fresh from the join point.
- Groups are durable by default and can be explicitly ephemeral.
- Each agent must register with a mandatory session name or session id.
- Each group membership has an alias unique within that group; default alias is the session name.
- Purpose is optional but should be asked for or inferred by the skill when useful.
- Group MediaStore is filesystem-first with a searchable index and DB metadata.
- Claude gets `notifications/claude/channel`; Codex gets standard MCP `notifications/message`.

## Constraints

- Use Bun/TypeScript for v0.
- Keep one daemon process, one SQLite WAL database, and filesystem media under `~/.synchronize/`.
- Do not use per-group polling loops. One lightweight notifier cursor per peer is the limit.
- Do not cache group history in MCP adapter memory.
- Do not mark durable inbox rows lost because notification delivery failed.
- Do not implement WebSocket/SSE, cloud sync, backup automation, encryption, or remote discovery in v0.
- Do not make CLI or MCP mutate state through different private code paths; they must go through REST.

## Non-Goals

- Public hosted service.
- Multi-user cloud accounts.
- End-to-end encryption.
- Sophisticated media search beyond metadata/index search.
- Mobile/desktop GUI.
- Retention/pruning policies beyond keeping durable state forever in v0.

## Ask Before

- Changing the implementation stack away from Bun/TypeScript.
- Changing repository branch/default-branch policy.
- Adding WebSocket/SSE or another transport instead of adaptive polling.
- Making LAN mode tokenless.
- Choosing symlink/reference-only media sharing as the default.
- Destructive cleanup of existing `~/.synchronize` data.
- Setting a remote differently from `https://github.com/abhirup-dev/synchronize`.
- Any migration that cannot preserve existing durable messages once v0 data exists.

## Done Means

The repository contains a working `synchronize` daemon, REST API, MCP adapter, CLI, persistence layer, MediaStore, skill docs, and tests proving every requirement in `PLAN.md`: durable DM, inbox, group, join-history, media, notification, and CLI/MCP parity behavior. Milestone progress is recorded with automated test summaries instead of manual confirmation pauses.
