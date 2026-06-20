# glossary.md

Fast lookup index from symptom language to current code/docs. This file is a
router, not an architecture narrative. Prefer canonical docs/source for detail.

## Docs First

| Need | Go to |
|---|---|
| Install/setup/CLI basics | `README.md` |
| Runtime config, env vars, remote profiles, env files, test harnesses | `docs/configuration/README.md` |
| Raw SQL recipes for daemon state | `docs/debugging/sql-queries.md` |
| Group alias/membership semantics | `docs/group-sync-integrity.md` |
| Storybook/UI debugging + MCP catalog | `docs/debugging/storybook.md` |
| Building UI / authoring stories | `docs/agents/storybook-ui.md` |
| Historical plans and handoffs | `reference-v0-plans.md` |
| High-level agent orientation | `.serena/memories/*.md` |

## Source Map

| Concept | Primary files |
|---|---|
| Daemon startup/context/shared helpers | `src/daemon/server.ts` |
| HTTP route dispatch | `src/daemon/routing.ts` |
| HTTP route handlers | `src/daemon/routes/*` |
| Daemon repository/query helpers | `src/daemon/repo/*` |
| Peer register/heartbeat/delete/activity routes | `src/daemon/routes/peers.ts`, `src/daemon/repo/peers.ts` |
| Group send/join/history and alias behavior | `src/daemon/routes/groups.ts`, `src/daemon/repo/groups.ts` |
| DM send path | `src/daemon/routes/messaging.ts` |
| Thread list/get/status | `src/daemon/routes/threads.ts`, `src/daemon/repo/threads.ts` |
| Query surface | `src/daemon/routes/query.ts`, `src/api/query.ts`, `src/mcp/tools/query.ts` |
| Push subscriptions | `src/daemon/routes/subscriptions.ts`, `src/daemon/services/subscriptions.ts` |
| Inbox reads/acks | `src/daemon/routes/inbox.ts`, `src/api/inbox.ts` |
| Media storage | `src/daemon/routes/media.ts`, `src/daemon/repo/media.ts`, `src/media-store.ts` |
| Archive/resume | `src/daemon/routes/archive.ts`, `src/daemon/repo/archive.ts`, `src/daemon/services/archive.ts`, `src/api/{archive,resume}.ts` |
| Launch lifecycle | `src/launch/*`, `src/daemon/repo/launch.ts`, `src/mcp/tools/launch.ts` |
| Web UI state/events | `src/daemon/routes/web.ts`, `src/daemon/services/web-events.ts`, `web/src/data/daemon.ts` |
| Storybook config + addons | `web/.storybook/{main.ts,preview.tsx,preview-head.html}` |
| Storybook providers (fresh MockDataSource) | `web/src/storybook/StorybookProviders.tsx` |
| Story data contract (mock = daemon contract) | `web/src/data/{seed.ts,mock.ts,types.ts}` |
| Component stories + glossary MDX | `web/src/components/*.stories.tsx`, `web/src/storybook/*.mdx` |
| Cross-component flows (real Shell) | `web/src/flows/SynchronizeFlows.stories.tsx`, exported `Shell` in `web/src/App.tsx` |
| Storybook test runner | `web/vitest.config.ts`, `web/package.json` (`test:storybook*`) |
| Event constants and schema coupling | `src/constants.ts`, `src/db.ts` |
| Runtime and remote config | `src/config.ts`, `docs/configuration/` |
| Remote profile doctor/status rendering | `src/cli/commands/remote.ts`, `src/remote/status.ts` |
| Client discovery/autostart | `src/client.ts` |
| CLI commands | `src/cli.ts`, `src/cli/commands/*` |
| MCP lifecycle/tools | `src/mcp/lifecycle.ts`, `src/mcp/tools/*` |
| Pi extension lifecycle | `extensions/pi-synchronize/src/index.ts` |
| Diagnostics | `Makefile`, `scripts/doctor.sh` |

## Term Index

| Term | Short meaning |
|---|---|
| peer | Agent identity row in `peers`; has `peer_id`, `tool`, `session_name`, lease, lifecycle state. |
| agent_session | Binding from host tool/session id to a peer, used for session-aware routing and UI. |
| group_member | Group membership row with per-group `alias`; mentions resolve against alias, not `session_name`. |
| channel / push | Real-time callback delivery through the daemon subscriber map. Ephemeral; not persisted. |
| inbox | Durable recipient/event fallback rows. Use this when push delivery is unclear. |
| lease | `lease_expires_at`; online/offline is derived from lease, with web peers special-cased. |
| soft-delete | `deleted_at` set; row remains for audit and membership history. |
| archived peer | Peer lifecycle state reserved for archive/resume; retention sweeps should not delete it. |
| thread root | Root group message. Replies normalize `parent_event_id` to this root. |
| direct reply target | Exact event answered by `reply_to_event_id`; can differ from thread root. |
| local web peer | Daemon-owned `web:local-human` identity for browser UI sessions. |

## Where Would I Find X?

| Question | First place |
|---|---|
| Where is mention parsing? | `src/daemon/server.ts` (`MENTION_TOKEN_RE`) and send helpers used by `routes/groups.ts` / `routes/messaging.ts` |
| Where is thread normalization? | `src/daemon/server.ts` helper logic plus `src/daemon/routes/{groups,messaging,threads}.ts` |
| Where is `pushed_to` decided? | `src/daemon/routes/groups.ts`, `src/daemon/routes/messaging.ts`, `src/daemon/services/subscriptions.ts` |
| Where are inbox rows written? | Send helpers in `src/daemon/server.ts`, called by messaging/group routes |
| Where does `daemon.json` get written/read? | `src/client.ts` |
| Where is the heartbeat cadence? | `src/constants.ts` (`MCP_HEARTBEAT_MS`), with config caveats in `docs/configuration/runtime.md` |
| Where are lease/retention values resolved? | `src/config.ts` and `ctx.config.daemon.*` consumers |
| Where does web fetch daemon state? | `web/src/data/daemon.ts` |
| Where do stories get their data? | `MockDataSource` (`web/src/data/mock.ts`) seeded from `seed.ts`, via the global decorator in `web/.storybook/preview.tsx` |
| How to debug a UI/component render bug? | `ui-forensics.md` → `docs/debugging/storybook.md` |
| How to test a cross-component UI flow? | `web/src/flows/SynchronizeFlows.stories.tsx` (mounts the real `Shell`) |
| What can the Storybook MCP do? | `docs/debugging/storybook.md` (capability catalog) |
| Which Make targets inspect runtime? | `Makefile` + `scripts/doctor.sh` |
