# Plan: synchronize unified agent messaging platform

## Solution Overview

Build `synchronize` by following the repository root `PLAN.md` completely. The goal package exists to turn that plan into a reviewed `/goal` execution package with acceptance evidence, automated milestone summaries, and verification discipline.

At a high level, `synchronize` is a local daemon plus two thin clients: an MCP stdio adapter for agents and a CLI for humans. The daemon owns state, exposes a full REST API, persists messages and group state in SQLite, stores media on disk, and emits pollable events. MCP adapters register a peer, heartbeat, poll a single per-peer event stream, and translate new events into Claude or Codex notifications.

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

## Why This Approach

This keeps the Bun projects' small footprint, adds the GitLab project's stronger event-plus-inbox durability, keeps Claude's channel delivery, and uses standard MCP notifications for Codex. REST-first design prevents MCP and CLI from drifting and gives the user a direct coordination API. SQLite and filesystem media keep operations local, inspectable, and cheap.

## How It Will Work

Daemon startup uses a discovery file and launch lock:

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

REST is the source of truth:

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
        |                              B notifier polls events
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

MediaStore:

```text
~/.synchronize/
  media/
    backend-review/
      index.jsonl
      README.md
      2026-05-10T120501Z_peer-a_api-trace.json
```

## Implementation Slices

| Slice | Purpose | Main systems | Done when | Risks |
| --- | --- | --- | --- | --- |
| 1 | Project skeleton and shared contracts | Bun package, TS config, REST schema/types | Daemon, MCP, CLI packages can compile/run basic help | Early contract churn |
| 2 | Daemon lifecycle and SQLite | Discovery file, launch lock, DB schema, migrations | Daemon auto-starts, writes state under `~/.synchronize`, exposes health/status | Locking and stale daemon handling |
| 3 | Peer identity and REST API | peers, heartbeat, auth, LAN token | Register/list/heartbeat/deregister work through REST and CLI | Token handling and lease semantics |
| 4 | Durable event/inbox messaging | events, inbox, DM endpoints, ack/read state | Offline DM survives and is readable later | At-least-once semantics must be precise |
| 5 | Groups and history modes | groups, members, aliases, group messages/history | Join-with-history and join-fresh behavior pass tests | History cursor mistakes can leak prior messages |
| 6 | MCP adapter and notifications | MCP tools, heartbeat, adaptive notifier | Claude/Codex notification paths work and inbox fallback remains durable | Client notification support varies |
| 7 | CLI parity | CLI commands over REST | CLI covers every MCP capability | Parity drift |
| 8 | MediaStore | file copy, metadata, `index.jsonl`, media events | Shared media is copied, indexed, listed, and fetchable | Large files and path safety |
| 9 | Skills/docs and end-to-end tests | Claude/Codex skill docs, integration tests | Slash-command behavior is documented and tools are verified | Skill wording ambiguity |

## Public Interface Requirements

REST endpoint groups:
- `GET /health`, `GET /status`
- `POST /peers/register`, `PATCH /peers/{peer_id}/heartbeat`, `GET /peers`, `DELETE /peers/{peer_id}`
- `POST /dm`, `GET /peers/{peer_id}/inbox`, `POST /peers/{peer_id}/inbox/ack`
- `POST /groups`, `GET /groups`, `GET /groups/{name}`
- `POST /groups/{name}/join`, `POST /groups/{name}/leave`
- `POST /groups/{name}/messages`, `GET /groups/{name}/history`
- `POST /groups/{name}/media`, `GET /groups/{name}/media`, `GET /media/{media_id}`
- `GET /events/{peer_id}?cursor=&limit=` for notifier/debug polling

MCP tools:
- `bridge_register`, `bridge_whoami`, `bridge_list_peers`, `bridge_dm`, `bridge_inbox`
- `bridge_create_group`, `bridge_join_group`, `bridge_leave_group`, `bridge_send_group`, `bridge_group_history`, `bridge_list_groups`
- `bridge_share_media`, `bridge_list_media`, `bridge_get_media`

CLI commands must mirror MCP capabilities:
- `synchronize status`
- `synchronize register --name NAME [--purpose TEXT]`
- `synchronize peers [--group NAME]`
- `synchronize dm PEER MESSAGE`
- `synchronize inbox [--ack]`
- `synchronize group create NAME [--ephemeral]`
- `synchronize group join NAME [--alias ALIAS] [--fresh]`
- `synchronize group leave NAME`
- `synchronize group send NAME MESSAGE`
- `synchronize group history NAME`
- `synchronize media share GROUP FILE --description TEXT`
- `synchronize media list GROUP [--query TEXT]`
- `synchronize media get MEDIA_ID`

## Performance Requirements

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

Required implementation choices:
- One daemon process.
- One SQLite DB with WAL and `busy_timeout`.
- Bounded MCP notification buffer, default 100.
- Paginated reads everywhere.
- One adaptive polling loop per MCP peer, not per group.
- Text messages in SQLite; media contents on filesystem.
- Index hot paths for inbox, events by group, group alias uniqueness, lease expiry, and media lookup.

## Acceptance Criteria

- [ ] REST API implements all required peer, DM, inbox, group, history, event, and media endpoints with token protection for LAN mode.
- [ ] CLI exposes feature parity with MCP tools and uses REST only.
- [ ] MCP adapter exposes feature parity with CLI and uses REST only.
- [ ] Offline DMs and group messages remain readable through durable inbox/history.
- [ ] `/join-group` and `/join-group-fork` semantics are implemented and tested.
- [ ] Group aliases are unique within a group and collision errors are clear.
- [ ] Claude and Codex notification paths are implemented with durable inbox fallback.
- [ ] Media sharing copies files into a group MediaStore and writes both DB metadata and filesystem index.
- [ ] Durable groups survive daemon restart; ephemeral groups are removed during startup recovery.
- [ ] Tests prove performance-sensitive constraints: no per-group polling and paginated reads for unbounded collections.
- [ ] Codex records automated verification summaries after each major milestone and continues without manual confirmation unless a blocker is hit.

## Required Evidence

| Requirement | Evidence to inspect | Where evidence is recorded |
| --- | --- | --- |
| REST/MCP/CLI parity | Endpoint/tool/command matrix and tests | `progress.jsonl` and test output |
| Durable delivery | Offline DM/group integration test | `progress.jsonl` |
| Group history modes | Join history/fork tests | `progress.jsonl` |
| Notification paths | MCP notification tests or manual trace | `progress.jsonl` |
| MediaStore | Copied file, `index.jsonl`, DB metadata test | `progress.jsonl` |
| Performance constraints | Code inspection and tests proving one notifier loop per peer | `progress.jsonl` |
| Milestone verification summaries | Progress entries recording command evidence and automated test summaries | `progress.jsonl` |

## Milestone Summaries

Codex must record automated verification summaries after these milestones:
- Daemon lifecycle and REST health/status are working.
- Peer registration plus DM/inbox delivery works from CLI.
- Group create/join/send/history works from CLI.
- MCP adapter can register and emit at least one test notification path.
- Codex skill integration works end-to-end from the user's Codex environment.
- Claude skill integration works end-to-end from the user's Claude environment.
- MediaStore share/list/get works.

At each milestone, Codex must append command/test evidence to `progress.jsonl` and include a concise automated test summary in its next user-facing update. Codex should continue implementation without stopping for manual confirmation unless `blockers.md` requires asking.

## Phase Boundaries

This goal ends when v0 is implemented and verified locally. Do not stretch this goal to include WebSocket/SSE, cloud sync, encryption, GUI, retention policies, backup automation, or remote service deployment; those should become separate goals.

## Completion Audit

Before marking complete, Codex must map every acceptance item to concrete files, test output, command output, or manual evidence. If any item is uncertain or unverified, the goal is not complete.
