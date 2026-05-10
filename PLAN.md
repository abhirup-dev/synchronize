# synchronize Unified Agent Messaging Platform

## Summary

Build `synchronize` as a Bun/TypeScript local-first messaging platform for Claude and Codex agents.

Core goals:
- WhatsApp-like DMs with near-real-time delivery.
- Durable inbox so offline agents can read later.
- Group chat with two join modes: history access or fresh fork.
- Group MediaStore with searchable filesystem index.
- Full daemon REST API as the source of truth.
- MCP adapter and CLI both use the same REST API and expose feature parity.
- Lean memory profile: daemon owns state; MCP adapters hold only peer identity, cursor, heartbeat, and bounded notification buffer.

## Architecture

```text
                          same REST contract
                              |
          +-------------------+-------------------+
          |                   |                   |
          v                   v                   v
+-----------------+   +-----------------+   +-----------------+
| Claude MCP      |   | Codex MCP       |   | synchronize CLI |
| stdio adapter   |   | stdio adapter   |   | human/operator  |
+--------+--------+   +--------+--------+   +--------+--------+
         |                     |                     |
         | HTTP JSON + token   | HTTP JSON + token   | HTTP JSON + token
         +---------------------+---------------------+
                               v
                    +---------------------+
                    | synchronize daemon   |
                    | Bun HTTP server     |
                    | localhost default   |
                    +----------+----------+
                               |
             +-----------------+-----------------+
             v                 v                 v
    +----------------+ +----------------+ +--------------------+
    | SQLite WAL DB  | | MediaStore FS  | | discovery + lock    |
    | durable state  | | group assets   | | ~/.synchronize/     |
    +----------------+ +----------------+ +--------------------+
```

Daemon startup:

```text
MCP/CLI starts
   |
   v
read ~/.synchronize/daemon.json
   |
   +-- healthy daemon exists --------------> use it
   |
   +-- no healthy daemon
        |
        v
   acquire ~/.synchronize/daemon.lock
        |
        v
   spawn daemon
        |
        v
   wait for /health
        |
        v
   write/use discovery file
```

Networking:
- Bind `127.0.0.1` by default.
- LAN mode requires explicit `PEER_BRIDGE_BIND` or final equivalent env name and `PEER_BRIDGE_TOKEN` or final equivalent token env.
- `/health` may be unauthenticated; every state-changing or state-reading API requires token when configured.

## REST API, MCP, And CLI Parity

REST API is canonical. MCP tools and CLI commands are thin wrappers over it.

```text
+-----------------------+
| REST daemon API       |  source of truth
+-----------+-----------+
            |
    +-------+--------+
    v                v
MCP tools        CLI commands
agent UX         human/operator UX
```

Feature parity rule:
- Every MCP capability must have a CLI equivalent.
- Every CLI coordination capability must have a REST endpoint.
- MCP may add client-specific notification handling, but not hidden state mutations unavailable to CLI.

REST endpoint groups:
- `GET /health`, `GET /status`
- `POST /peers/register`, `PATCH /peers/{peer_id}/heartbeat`, `GET /peers`, `DELETE /peers/{peer_id}`
- `POST /dm`, `GET /peers/{peer_id}/inbox`, `POST /peers/{peer_id}/inbox/ack`
- `POST /groups`, `GET /groups`, `GET /groups/{name}`
- `POST /groups/{name}/join`, `POST /groups/{name}/leave`
- `POST /groups/{name}/messages`, `GET /groups/{name}/history`
- `POST /groups/{name}/media`, `GET /groups/{name}/media`, `GET /media/{media_id}`
- `POST /subscriptions` for MCP adapter event callbacks
- `GET /events/{peer_id}?cursor=&limit=` for debug/manual fallback reads

MCP tools:
- `bridge_register`
- `bridge_whoami`
- `bridge_list_peers`
- `bridge_dm`
- `bridge_inbox`
- `bridge_create_group`
- `bridge_join_group`
- `bridge_leave_group`
- `bridge_send_group`
- `bridge_group_history`
- `bridge_list_groups`
- `bridge_share_media`
- `bridge_list_media`
- `bridge_get_media`

CLI commands mirror these:

```text
synchronize status
synchronize register --name NAME [--purpose TEXT]
synchronize peers [--group NAME]
synchronize dm PEER MESSAGE
synchronize inbox [--ack]
synchronize group create NAME [--ephemeral]
synchronize group join NAME [--alias ALIAS] [--fresh]
synchronize group leave NAME
synchronize group send NAME MESSAGE
synchronize group history NAME
synchronize media share GROUP FILE --description TEXT
synchronize media list GROUP [--query TEXT]
synchronize media get MEDIA_ID
```

## Message And Group Model

Use SQLite at `~/.synchronize/synchronize.db` with WAL, prepared statements, request limits, and indexed append-only event flow.

Core tables:
- `peers`: identity, tool, session name, purpose, machine id, lease, last cursor.
- `groups`: unique name, durable flag, media directory, creator.
- `group_members`: peer membership, alias, join cursor, history cursor, active flag.
- `events`: append-only stream for DMs, group messages, joins, leaves, media shares.
- `inbox`: per-recipient delivery/read/ack state.
- `media_items`: DB metadata for filesystem media.

DM delivery:

```text
Peer A sends DM to Peer B
        |
        v
POST /dm
        |
        v
insert event(type=dm)
        |
        v
insert inbox(recipient=B, event_id)
        |
        +--------------- online B --------------+
        |                                       v
        |                              daemon POSTs B callback
        |                                       |
        |                                       v
        |                              MCP notification emitted
        |
        +--------------- offline B -------------+
                                                v
                                      B later registers/resumes
                                                |
                                                v
                                      GET /peers/B/inbox
```

Group delivery:

```text
Group "backend-review"
   members:
     alice  peer_a
     bob    peer_b
     tests  peer_c

peer_a sends group message
        |
        v
event(type=group_message, group_id)
        |
        v
fanout inbox rows:
   peer_b <- event
   peer_c <- event
```

Group join history:

```text
events in group:
  1  created
  2  msg A
  3  msg B
  4  peer joins

/join-group "name"
  history_from_event_id = group first event
  can read: 1,2,3,4,...

/join-group-fork "name"
  history_from_event_id = join event id
  can read: 4,...
```

Durability:
- Groups are durable by default.
- Ephemeral groups are persisted only for the daemon lifetime and removed during daemon startup recovery.
- Durable groups, membership records, events, inbox, and media metadata survive daemon restart.
- Retention is forever in v0.

Identity:
- A peer must register with `session_name`.
- `purpose` is optional but exposed in peers/group membership.
- Group alias defaults to `session_name`.
- Alias must be unique within the group; collision returns a clear API error.

## Notification Model

Claude MCP adapters register one localhost event callback subscription per peer, not per group. Codex MCP adapters keep one adaptive polling loop per peer for standard MCP notifications.

```text
MCP adapter
   |
   | Claude: POST /subscriptions { peer_id, callback_url }
   | Codex: adaptive GET /events/{peer_id}?cursor=N
   v
daemon returns or POSTs directed events
   |
   +-- Claude client
   |    +-- notifications/claude/channel
   |
   +-- Codex client
        +-- notifications/message
```

Performance constraints:
- No group history cached in adapter memory.
- No per-group polling.
- Claude event callback subscription is per peer; Codex poll cursor is per peer.
- Failed callback delivery leaves durable inbox rows readable.
- Notification failure does not ack inbox rows.
- `bridge_inbox` remains authoritative durable fallback.

## MediaStore

Filesystem-first, DB-indexed media.

```text
~/.synchronize/
  media/
    backend-review/
      index.jsonl
      README.md
      2026-05-10T120501Z_peer-a_api-trace.json
      2026-05-10T120900Z_peer-c_screenshot.png
```

Share flow:

```text
agent shares file
   |
   v
POST /groups/{name}/media
   |
   v
copy file into group MediaStore
   |
   +-- insert media_items row
   +-- append index.jsonl
   +-- update README.md summary
   +-- emit media_shared event to group members
```

Default behavior:
- Copy file into MediaStore for durability.
- Store original path, copied path, size, hash, content type, description, shared-by, timestamp.
- Keep metadata searchable via SQLite and hackable via `rg/find` on `index.jsonl`.
- No periodic backup in v0.

## Performance And Resource Constraints

```text
agent count grows
group count grows
message count grows
        |
        v
must avoid:
  - per-group timers
  - full-history loads
  - unbounded adapter buffers
  - large blobs in notifications
  - scanning inbox without indexes
```

Implementation requirements:
- One daemon process.
- One SQLite DB with WAL.
- Bounded MCP notification buffer, default 100.
- Paginated reads everywhere.
- Message size cap and media metadata size cap.
- Index hot paths:
  - inbox by `(recipient_peer_id, acked_at, event_id)`
  - events by `(group_id, event_id)`
  - group members by `(group_id, alias)`
  - peers by lease expiry
  - media by `(group_id, created_at)` and searchable text columns
- Text messages stay in SQLite for v0.
- Media contents stay on filesystem.

## Test Plan

Daemon REST tests:
- Register, heartbeat, list, expire, deregister peers.
- DM online delivery and offline inbox delivery.
- Inbox at-least-once behavior and explicit ack.
- Create durable and ephemeral groups.
- Restart recovery keeps durable groups and removes ephemeral groups.
- Join with history can read old messages.
- Join fresh cannot read old messages through normal group history.
- Group alias collision fails.
- Group message fans out only to active members except sender.
- Media share copies file, writes DB row, writes `index.jsonl`, emits group event.
- LAN token required for protected routes.

MCP tests:
- Auto-start daemon through discovery/lock.
- Register starts heartbeat plus the mode-specific notification path.
- Claude mode emits `notifications/claude/channel`.
- Codex mode emits `notifications/message`.
- Notification failure leaves inbox rows readable.
- Claude event subscription uses one callback per peer; Codex polling uses one cursor per peer.

CLI parity tests:
- For every MCP tool, run equivalent CLI command against a test daemon.
- CLI and MCP observe the same REST-created state.
- CLI can inspect and coordinate groups without any MCP session running.

End-to-end scenarios:
- Claude DM to offline Codex; Codex later reads inbox.
- Codex group message notifies multiple Claude/Codex peers.
- Agent joins existing group with history and reads prior messages.
- Agent joins with fresh fork and only sees later messages.
- Media shared by one agent is discoverable by another via CLI and MCP.

## Assumptions

- Use Bun/TypeScript for v0.
- REST API is the canonical internal and external interface.
- MCP and CLI must have feature parity over REST.
- Localhost is default; LAN is opt-in and token-protected.
- `/join-group` means history access; `/join-group-fork` means fresh from join point.
- Durable messages and groups are retained forever in v0.
- Media sharing copies files by default.
- No WebSocket/SSE in v0; MCP live notifications use localhost REST callbacks and durable inbox fallback.
- No backup automation, encryption, cloud sync, or remote discovery in v0.
