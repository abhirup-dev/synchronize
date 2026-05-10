# Codex Goal Prompt: synchronize unified agent messaging platform

```text
/goal Implement `synchronize`: a lean Bun/TypeScript daemon, REST API, MCP adapter, CLI, durable inbox, group chat, join-history modes, MediaStore, and Claude/Codex notification bridge for local agent messaging.

Use `PLAN.md` and `goals/synchronize/` as the durable source of truth:
- Follow root `PLAN.md` completely. It is the authoritative implementation plan.
- Read `brief.md` for the mission, constraints, non-goals, and ask-before rules.
- Follow `plan.md` for the architecture, REST/MCP/CLI parity requirements, implementation slices, acceptance criteria, and performance constraints.
- Use `verification.md` for exact commands, required scenarios, manual checks, and evidence rules.
- Respect `blockers.md`; stop and ask before any listed high-risk action or unresolved decision.
- Append concrete progress and proof to `goals/synchronize/progress.jsonl` after each meaningful implementation or verification step.

Required outcome:
- REST daemon is canonical and owns durable SQLite state plus filesystem MediaStore.
- CLI and MCP expose feature parity over REST.
- DMs are near-real-time when peers are online and durable when receivers are offline.
- Groups support `/join-group` with history and `/join-group-fork` fresh from join point.
- Agents must register with mandatory session identity; group aliases are unique within each group.
- Claude uses `notifications/claude/channel`; Codex uses standard MCP `notifications/message`; durable inbox remains authoritative fallback.
- Default bind is localhost; LAN mode is opt-in and token-protected.
- Performance constraints are preserved: one notifier cursor per peer, no per-group polling, paginated reads, bounded adapter buffers.
- After each milestone listed in `plan.md`, record automated command/test evidence and continue without manual confirmation unless a blocker is hit. Include separate Codex-skill and Claude-skill integration evidence summaries.

Do not implement WebSocket/SSE, cloud sync, encryption, backup automation, GUI, retention policies, or remote discovery in this goal.

Before marking complete, run the verification commands and required scenarios from `verification.md`. The goal is only complete when every acceptance item in `plan.md` has concrete evidence recorded in `progress.jsonl`.
```
