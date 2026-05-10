# Verification: synchronize unified agent messaging platform

## Required Commands

| Command | Purpose | Expected pass condition | Evidence location |
| --- | --- | --- | --- |
| `bun install` | Install dependencies after package creation | Completes without dependency errors | `progress.jsonl` |
| `bun run typecheck` | Type-check daemon, CLI, MCP, shared code | Exit code 0 | `progress.jsonl` |
| `bun test` | Run unit and integration tests | Exit code 0, all tests pass | `progress.jsonl` |
| `bun run lint` | Static quality check if lint script exists | Exit code 0 | `progress.jsonl` |
| `synchronize --help` | Verify CLI entrypoint | Lists documented command groups | `progress.jsonl` |
| `synchronize status` | Verify daemon discovery/autostart | Shows healthy daemon and state path | `progress.jsonl` |

## Required Test Scenarios

- Register, heartbeat, list, expire, and deregister peers.
- DM online delivery.
- DM offline delivery followed by later inbox read.
- Inbox at-least-once behavior and explicit ack.
- Create durable group and verify it survives daemon restart.
- Create ephemeral group and verify it is removed during daemon startup recovery.
- Join group with history and read prior messages.
- Join group fresh and fail to read prior messages through normal history APIs.
- Reject duplicate alias in the same group.
- Send group message and fan out only to active members except sender.
- Share media and verify copied file, DB row, `index.jsonl`, and media event.
- Reject protected REST routes in LAN/token mode with missing or wrong token.
- Prove MCP adapter uses one peer-level notifier loop, not per-group loops.
- Prove CLI and MCP observe the same state created through REST.

## Manual Checks

- Run one Claude-mode MCP session and verify a test event emits `notifications/claude/channel`.
- Run one Codex-mode MCP session and verify a test event emits standard MCP `notifications/message`.
- Confirm notification failure does not remove inbox items.
- Inspect `~/.synchronize/media/<group>/index.jsonl` with `rg` and confirm metadata is findable.
- Confirm generated skill docs tell agents to enforce mandatory session identity before joining a group.
- From Codex, use the installed/provided skill flow to register, join a group, send/read a message, and confirm notification or inbox fallback works.
- From Claude, use the installed/provided skill flow to register, join a group, send/read a message, and confirm channel notification or inbox fallback works.
- At every milestone gate in `plan.md`, show evidence to the user and record explicit user confirmation before continuing.
- Confirm implementation satisfies every section of root `PLAN.md`.

## Evidence Rules

- Append every completed command and manual check to `progress.jsonl`.
- Evidence entries must include timestamp, command/check name, pass/fail status, and relevant output or artifact path.
- If a command cannot run because the implementation stage has not created it yet, record that as pending, not passing.
- Do not claim completion from code inspection alone unless the requirement is explicitly an inspection requirement.
