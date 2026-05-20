# Codebase Layout

```
src/
├── api/                       ← typed REST facade (phase-1 split)
│   ├── index.ts               ← barrel
│   ├── types.ts               ← DTOs: StatusResponse, Peer, Event, Group, GroupMember,
│   │                            MediaItem, EventSubscriptionRegistration, SummaryResponse,
│   │                            SummaryPeer
│   ├── status.ts              ← getStatus, getSummary, findReusablePeer
│   ├── peers.ts               ← registerPeer, heartbeatPeer, deletePeer, listPeers
│   ├── inbox.ts               ← readInbox, ackInbox, sendDm
│   ├── events.ts              ← readEvents, subscribeToEvents
│   ├── groups.ts              ← createGroup, listGroups, joinGroup, leaveGroup,
│   │                            sendGroupMessage, getGroupHistory
│   └── media.ts               ← shareMedia, listMedia, getMedia
├── api.ts                     ← 1-line compat shim: `export * from "./api/index.ts"`
│
├── cli/                       ← CLI (phase-1 split)
│   ├── index.ts               ← main(argv) — side-effect-free
│   ├── help.ts, flags.ts, identity.ts, warnings.ts
│   ├── render/{table,summary}.ts
│   └── commands/{status,top,register,whoami,peers,dm,inbox,group,media}.ts
├── cli.ts                     ← shim with `import.meta.main` guard + renderSummary re-export
│
├── mcp/                       ← MCP server (phase-1 split)
│   ├── index.ts, state.ts, util.ts, notifications.ts
│   ├── codex-notifier.ts      ← NotificationBridge — polling loop for codex mode
│   ├── claude-subscription.ts ← EventSubscription — callback server for claude mode
│   ├── lifecycle.ts, server.ts
│   └── tools/
│       ├── context.ts         ← ToolContext = { mcp, state, emit, lifecycle }
│       ├── register.ts        ← bridge_register, bridge_whoami
│       ├── peers.ts           ← bridge_list_peers
│       ├── messaging.ts       ← bridge_dm, bridge_inbox
│       ├── groups.ts          ← bridge_create_group, bridge_join_group, bridge_leave_group,
│       │                        bridge_send_group, bridge_group_history, bridge_list_groups
│       └── media.ts           ← bridge_share_media, bridge_list_media, bridge_get_media
├── mcp.ts                     ← compat shim: re-exports createMcpServer + NotificationBridge +
│                                EventSubscription + emitMcpNotification + their *Options types
│
├── daemon.ts                  ← ★ ~1077 LOC monolith — phase-2 split target ★
├── client.ts                  ← daemon discovery + requestJson; consumed by api/, cli/, mcp/
├── constants.ts               ← MCP_HEARTBEAT_MS, DEFAULT_NOTIFICATION_BUFFER,
│                                NOTIFIER_ACTIVE_MS, NOTIFIER_IDLE_MS
├── db.ts                      ← SQLite open + migrations
├── fs.ts                      ← readJson/writeJson helpers
├── http.ts                    ← request helpers (daemon-side)
└── paths.ts                   ← runtime path layout under ~/.synchronize

tests/
├── api.test.ts                ← REST facade unit-ish tests
├── messaging.test.ts          ← CLI spawn end-to-end (~16 KB, the big one)
├── mcp.test.ts                ← MCP adapter tests
├── mcp-e2e.test.ts            ← full stdio MCP end-to-end
└── health.test.ts             ← daemon lifecycle + discovery

bin/
├── synchronize                ← calls main(process.argv.slice(2)) from src/cli/
└── synchronize-mcp            ← stdio MCP entrypoint

scripts/
└── seed-demo.ts               ← used by `make demo` to seed sample data

docs/
└── handoffs/                  ← long-form handoff docs (Phase-1 handoff lives here)

.beads/                        ← bd issue tracker state (canonical issues.jsonl)
.claude/                       ← Claude Code settings + handoffs
```

## Files to be careful with

| File | Why it matters |
|------|---------------|
| `src/daemon.ts` | Monolith. Phase-2 target. Routes + validation + repository + media FS + subscription fanout + startup. |
| `src/api/*.ts` | Canonical list of endpoints the daemon owes — phase-2 daemon must serve **exactly** these routes. |
| `src/api.ts`, `src/cli.ts`, `src/mcp.ts` | Compat shims. Do NOT change export surface unless you also update external consumers (`bin/`, README, tests). |
| `src/client.ts` | All adapters share this transport. Touching `requestJson` ripples everywhere. |
| `bin/synchronize`, `bin/synchronize-mcp` | External entrypoints. `bun link` resolves global commands to whichever worktree is currently linked — beware when running multiple worktrees. |
```
