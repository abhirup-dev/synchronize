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
│                                NOTIFIER_ACTIVE_MS, NOTIFIER_IDLE_MS, ENV_PEER_ID,
│                                ENV_HOME/BIND/PORT/TOKEN/STARTED_BY_CLIENT, path/file names
├── db.ts                      ← SQLite open + migrations
├── fs.ts                      ← readJson/writeJson helpers
├── http.ts                    ← request helpers (daemon-side)
└── paths.ts                   ← runtime path layout under ~/.synchronize

tests/
├── api.test.ts                ← REST facade unit-ish tests
├── messaging.test.ts          ← CLI spawn end-to-end (~16 KB, the big one)
├── mcp.test.ts                ← MCP adapter tests
├── mcp-e2e.test.ts            ← full stdio MCP end-to-end
├── health.test.ts             ← daemon lifecycle + discovery
└── peer-id-env.test.ts        ← resolveMcpRegisterPeerId honors SYNCHRONIZE_PEER_ID

bin/
├── synchronize                ← calls main(process.argv.slice(2)) from src/cli/
└── synchronize-mcp            ← stdio MCP entrypoint (used by Claude, Codex, and Pi installs)

extensions/                    ← out-of-tree adapters that live next to the daemon
└── pi-synchronize/            ← @synchronize/pi-extension (peer dep: @earendil-works/pi-coding-agent)
    ├── package.json
    ├── README.md
    ├── src/
    │   ├── index.ts           ← default export synchronizeExtension(pi) — session_start hook
    │   ├── client.ts          ← REST client + discoverDaemon (mirrors src/client.ts shape)
    │   ├── subscription.ts    ← PiEventSubscription (Claude-channel-style callback server)
    │   ├── delivery.ts        ← formatExternalEvent + mapEventToDelivery (steer/followUp)
    │   ├── identity.ts        ← resolveSessionName from PiExtensionContext
    │   └── log.ts             ← always-on file logging under ~/.synchronize/pi-extension.log
    └── tests/subscription.test.ts

skills/                        ← per-host skill packs (installed via Makefile)
├── synchronize-claude/SKILL.md
├── synchronize-codex/SKILL.md
└── synchronize-pi/SKILL.md    ← Pi-specific guidance: events arrive as user messages

scripts/
├── seed-demo.ts               ← used by `make demo` to seed sample data
└── pi-mcp-config.ts           ← idempotent merger that writes a synchronize entry into Pi's mcp.json
                                  (used by `make install-pi`)

docs/
└── handoffs/                  ← long-form handoff docs (Phase-1 handoff lives here)

.beads/                        ← bd issue tracker state (canonical issues.jsonl)
.claude/                       ← Claude Code settings + handoffs
.serena/                       ← Serena project config + memories (this folder)
```

## Files to be careful with

| File | Why it matters |
|------|---------------|
| `src/daemon.ts` | Monolith. Phase-2 target. Routes + validation + repository + media FS + subscription fanout + startup. |
| `src/api/*.ts` | Canonical list of endpoints the daemon owes — phase-2 daemon must serve **exactly** these routes. |
| `src/api.ts`, `src/cli.ts`, `src/mcp.ts` | Compat shims. Do NOT change export surface unless you also update external consumers (`bin/`, README, tests). |
| `src/client.ts` | All adapters share this transport. Touching `requestJson` ripples everywhere — Pi extension ships its own copy, so changes to the daemon REST contract require updating `extensions/pi-synchronize/src/client.ts` too. |
| `src/mcp/lifecycle.ts` | Hosts `resolveMcpRegisterPeerId` — honors `SYNCHRONIZE_PEER_ID` env so Pi/Claude/Codex sessions can share a stable peer id across restarts. |
| `bin/synchronize`, `bin/synchronize-mcp` | External entrypoints. `bun link` resolves global commands to whichever worktree is currently linked — beware when running multiple worktrees. |
| `extensions/pi-synchronize/` | Out-of-tree but co-versioned. Mirrors Claude channel subscription but emits via `pi.sendUserMessage`. No build step; Pi loads `src/index.ts` directly. |
| `scripts/pi-mcp-config.ts` | Idempotent JSON merger for Pi's `mcp.json`. Re-runs are safe. |
| `Makefile` | Owns the install matrix (`install-claude`, `install-codex`, `install-pi`, `install-all`) plus daemon/demo lifecycle. README delegates to it. |
```
