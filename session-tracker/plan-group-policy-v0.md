# Group Policy v0 Plan

Date: 2026-05-22

## Context

Goal: make `synchronize` groups behave coherently for multi-agent
coordination — identity-bound joining, Slack-style threads, mention-gated
notifications, and admin-side access control. Lock the architectural shape now
so the v0 schema can absorb v1 features (in-band admin, group lifecycle,
visibility levels) without a migration churn.

Constraint: v0 has no production data. Schema breaks are free.

Relevant existing behavior at start of plan:

- Hook-based registration shipped in `813b5e3` (sync-0ql/buz/wyx/9e0/gt8/fl6).
  Every legitimate joiner now has a daemon-known `agent_sessions` binding with
  `host_tool` + `host_session_id`, alongside their `peers` row.
- `bridge_whoami` (`src/mcp/tools/register.ts:60`) returns peer + bound
  agent_sessions — the canonical identity surface.
- Group join takes a free-form `alias`. Partial unique index
  `idx_group_members_alias ... WHERE active = 1` lets a different peer claim a
  freed alias after the prior holder leaves. This is the rejoin/identity-theft
  scenario.
- `group_message` fan-outs notifications to every active member; `group_joined`
  / `group_left` are stored but never broadcast.
- No threads, no mentions, no per-group access control.

External references:

- Slack thread model: `events.parent_event_id` style, one level deep
  (replies-to-replies collapse to the root).
- Existing hook plan (`session-tracker/plan-advanced-synchronize-registering-hooks.md`)
  is the format template for this document.

## Decisions

### Identity & alias

- **CLI-fallback peers allowed, second-class.** No hook binding required to
  join. Display gets a `#<peer_id[0:4]>` suffix so the roster visibly marks
  them as terminal-only.
- **Client proposes alias, daemon validates uniqueness among active members.**
  Same `WHERE active = 1` partial uniqueness as today. Default alias =
  `peer.session_name`.
- **Leaving frees the alias slot.** Respawn (fresh `peer_id`, fresh
  `host_session_id`, same logical role) can reclaim the alias. This is the
  intended use case, not a bug.
- **Daemon emits `group_member_alias_reclaimed` when alias passes to a
  different `peer_id` than its last holder.** Auditable in `events`.
- **Roster + history always render `alias #<peer_id[0:4]>` (or
  `#<host_session_id[0:6]>` if a binding exists).** Eliminates duplicate
  session-name confusion and makes respawn vs. impersonation visible at a
  glance.
- **Self-rename via `bridge_rename_in_group({ name, new_alias })`.** Daemon
  scopes the rename to the requesting peer's row, validates new alias is unique
  among active members.
- **No in-band admin in v0.** Admin rename, kick, archive, role management all
  deferred to v1.

### Threads

- **`events.parent_event_id INTEGER NULL`** (FK on `events(event_id)`).
- **One level deep, daemon normalizes.** If a reply targets another reply,
  daemon resolves to the thread root and stores that.
- **API surface additions:**
  - `bridge_send_group({ name, message, in_reply_to? })`
  - `bridge_group_history({ name, thread_of? })` — when `thread_of` is set,
    returns root + all replies in chronological order.
- **Index** `(group_id, parent_event_id, event_id)` for thread navigation.

### Mentions & notification routing

- **`events.mentions_json TEXT NULL`** — JSON array of resolved peer_ids at
  send time. Body keeps the literal `@alias` text.
- **Daemon resolves `@token` to `peer_id` via active group_members.alias at
  send time.** Unresolved tokens do not block the send; response includes
  `warnings: [{ token, reason: "alias_not_in_group" }]`.
- **Notification rules (per channel and thread context):**

| context             | push fanout                                        | inbox fanout |
|---------------------|----------------------------------------------------|--------------|
| main channel msg    | mentioned peers only                               | all members  |
| thread reply        | root_author ∪ thread_posters ∪ this-msg-mentions   | all members  |
| group_joined/left/  | none                                               | all members  |
| alias_reclaimed     |                                                    |              |

- **Thread participant set is computed per-message:** `SELECT DISTINCT
  sender_peer_id FROM events WHERE event_id = $root OR parent_event_id =
  $root`. No `thread_followers` table in v0.

### Access control

- **All groups public by default.** No `groups.visibility` column.
- **Per-peer / per-session blocks via `group_acl`:**

  ```sql
  CREATE TABLE group_acl (
    group_id     INTEGER NOT NULL REFERENCES groups(group_id) ON DELETE CASCADE,
    key_type     TEXT NOT NULL,   -- 'peer_id' | 'host_session_id'
    key_value    TEXT NOT NULL,
    status       TEXT NOT NULL,   -- 'blocked' (v0); 'allowed' reserved for v1
    granted_by   TEXT,
    granted_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (group_id, key_type, key_value)
  );
  ```

- **Block effect:** group remains visible in `listGroups`; `join`, `send`,
  `share_media`, `history`, `rename_in_group` return `403 group_forbidden`.
- **All ACL writes via privileged CLI** (`synchronize group block`,
  `synchronize group allow`, `synchronize group acl`). No MCP tools touch ACL
  in v0. MCP/REST callers cannot self-block or self-unblock.

### Group metadata

- **`groups.description TEXT NULL`**, set at create, mutated via privileged
  CLI. Surfaces in `listGroups` and the web UI.

### Deferred to v1

- `group_members.role` (owner/admin/member) + in-band admin tools
- `groups.visibility` (private / restricted)
- `groups.archived_at` + `synchronize group archive` / delete
- `bridge_rename_group`
- Per-thread ACL
- ACL status `allowed` (private-group invite list)
- Mention-search FTS

## Architecture diagrams

### Identity flow at join time

```text
hook (claude-session / pi-session)
  |
  | registers agent_sessions row
  v
peers + agent_sessions
  |
  v
bridge_whoami returns canonical identity
  | { peer.peer_id, peer.session_name, peer.tool,
  |   agent_sessions[{ host_tool, host_session_id, ... }] }
  v
bridge_join_group({ name, alias? })
  |
  | daemon
  |   resolve joining peer by peer_id
  |   default alias = peer.session_name if not supplied
  |   check unique among active members of this group
  |     -> 409 alias_collision if taken
  |   detect reclaim:
  |     if (group_id, alias) had a different peer_id (active=0 row exists)
  |       insert 'group_member_alias_reclaimed' event
  |   insert group_joined event
  v
group_members row with alias bound to (group_id, peer_id)
```

### Message routing in main channel

```text
bridge_send_group({ name, message: "hi @alice and @bob" })
  |
  | tokenize @-mentions
  | resolve each token via
  |   SELECT peer_id FROM group_members
  |   WHERE group_id = ? AND active = 1 AND alias = ?
  | collect warnings for unresolved tokens
  v
event row
  | body            = "hi @alice and @bob"
  | mentions_json   = ["peer-a", "peer-b"]   (only resolved)
  | parent_event_id = NULL
  v
fanout
  | inbox: every active member (durable visibility)
  | push : peers in mentions_json (notifySubscribers)
  v
response
  | { event, warnings: [{ token:"@bob", reason:"alias_not_in_group" }] }
```

### Message routing in a thread

```text
bridge_send_group({ name, message, in_reply_to: <event_id> })
  |
  | daemon normalizes parent
  |   target = events[in_reply_to]
  |   parent_event_id = target.parent_event_id ?? target.event_id
  | resolve mentions same as main channel
  v
event row (parent_event_id = root)
  |
  v
participants = root.sender_peer_id
              ∪ DISTINCT sender_peer_id where parent_event_id = root
              ∪ mentions_json of this message
  |
  v
fanout
  | inbox: every active member
  | push : participants
```

### ACL enforcement chokepoint

```text
                       bridge_join_group / bridge_send_group / ...
                              |
                              v
                  daemon: ensureNotBlocked(group_id, peer_id)
                              |
                              v
              +---------------+-----------------+
              | SELECT 1 FROM group_acl         |
              | WHERE group_id = ?              |
              |   AND status = 'blocked'        |
              |   AND ( (key_type='peer_id'     |
              |          AND key_value = ?)     |
              |     OR (key_type='host_session_ |
              |         id' AND key_value       |
              |         IN agent_sessions.host_ |
              |         session_id for peer_id) |
              +---------------+-----------------+
                              |
                       row exists?
                       /            \
                      yes            no
                      |              |
                  403 group_       proceed
                  forbidden
```

## Schema changes

```sql
ALTER TABLE groups ADD COLUMN description TEXT;

ALTER TABLE events ADD COLUMN parent_event_id INTEGER REFERENCES events(event_id);
ALTER TABLE events ADD COLUMN mentions_json  TEXT;

CREATE INDEX idx_events_group_parent_event
  ON events (group_id, parent_event_id, event_id);

CREATE TABLE group_acl (
  group_id   INTEGER NOT NULL REFERENCES groups(group_id) ON DELETE CASCADE,
  key_type   TEXT NOT NULL,
  key_value  TEXT NOT NULL,
  status     TEXT NOT NULL,
  granted_by TEXT,
  granted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (group_id, key_type, key_value)
);

CREATE INDEX idx_group_acl_key
  ON group_acl (key_type, key_value);
```

No back-compat shims required (no production data).

## API surface

Additions / changes (all wired through `src/api/groups.ts` + new
`src/api/group-acl.ts`):

- `POST /groups` — accept optional `description`.
- `POST /groups/:name/join` — alias remains optional; daemon enforces unique
  among active members; emits reclaim event when a different peer_id claims a
  formerly-held alias.
- `POST /groups/:name/messages` — accept optional `in_reply_to`. Response shape
  becomes `{ event, warnings? }`.
- `GET /groups/:name/history` — accept optional `thread_of` query param.
- `POST /groups/:name/rename` — body `{ peer_id, new_alias }`. Daemon scopes
  rename to that peer's membership row.
- `PATCH /groups/:name` — body `{ description? }`. CLI-only consumer.
- `GET /groups/:name/acl` — list ACL entries.
- `POST /groups/:name/acl` — body `{ key_type, key_value, status }`. CLI-only.
- `DELETE /groups/:name/acl/:key_type/:key_value` — CLI-only.

MCP tools:

- `bridge_send_group` gains `in_reply_to?` and returns `warnings`.
- `bridge_group_history` gains `thread_of?`.
- New `bridge_rename_in_group({ name, new_alias })`.
- No MCP tools for ACL.

## CLI surface

Privileged commands (daemon host only):

```text
synchronize group block <group> <peer_id|host_session_id>
synchronize group allow <group> <peer_id|host_session_id>   # removes block in v0
synchronize group acl <group>                                # list entries
synchronize group describe <group> <text>                    # set description
```

These should refuse if `SYNCHRONIZE_BIND != 127.0.0.1` without explicit
admin-token plumbing (out of scope for v0; flag with a TODO).

## Phase plan

```text
  Phase 1   Identity & join hardening
    - daemon-side alias defaulting + collision warnings
    - reclaim event emission
    - roster/history suffix rendering (TUI + web)
    - bridge_rename_in_group (self-scoped)
    - bridge_join_group description / skill doc updates

  Phase 2   Bug cluster
    - case-collision in media_dir path (lowercase or reject collision)
    - ephemeral media_dir teardown on daemon startup
    - sync-rwy: CLI re-register reuses existing cli-peer.json
    - sync-0oc: top/status duplicate display polish
      (largely solved by Phase 1 suffix, this is cleanup)

  Phase 3   Conversation layer (split as worktrees)
    3a. Threads
        - events.parent_event_id + index
        - in_reply_to on send; thread_of on history
        - daemon-side parent normalization
    3b. Mentions + notification routing
        - events.mentions_json
        - @-token resolution + warnings
        - rewrite notifySubscribers fanout for main / thread / roster rules
        - broadcast policy for group_joined/left/reclaimed (inbox-only)
        (bundles with 3a — shares fanout code; split worktrees, share branch base)
    3c. ACL / blocks
        - group_acl table + indices
        - daemon enforcement chokepoint (ensureNotBlocked)
        - CLI commands (group block/allow/acl)
    3d. Group description
        - groups.description column + create/update path
        - listGroups response field
        - web UI render
```

## Verification plan

Per phase, add or extend:

- Phase 1: test that two peers cannot hold the same active alias; that leave
  frees the slot; that a different peer joining with the freed alias emits a
  reclaim event; that the roster shows the suffix for duplicate session names;
  that `bridge_rename_in_group` is scoped to the calling peer only.
- Phase 2: regression tests for each fixed bug; the case-collision test must
  cover both macOS-style (case-insensitive FS) and Linux behaviors via the
  daemon validation layer rather than relying on FS semantics.
- Phase 3a: thread normalization (reply-to-reply collapses to root); history
  filtering by `thread_of`; non-thread messages excluded.
- Phase 3b: mention resolution honors active-only membership; unresolved
  tokens produce warnings without blocking the send; notify fanout matches the
  table above; roster events appear in inbox but not push.
- Phase 3c: blocked peer cannot join/send/history; group remains visible in
  list; CLI commands round-trip correctly; ACL lookup honors both peer_id and
  host_session_id keys.
- Phase 3d: description round-trips through create + listGroups; PATCH
  description CLI command updates correctly.

Manual smoke at end of each phase:

- Two Claude sessions + one Codex session + one CLI fallback peer all join the
  same group, exchange messages with @mentions and one threaded conversation,
  verify notification routing matches expectations.
- Block one of the peers via CLI; verify they see the group in listings but
  get 403 on next message.
- Respawn one session (close + restart with new host_session_id); verify they
  can reclaim their alias and the `group_member_alias_reclaimed` event fires.

## Open questions for v1 (do not block v0)

- Should ACL key types support globs (`tool=claude`, `session_name~=review-*`)?
- Should respawn be a first-class event with a `previous_peer_id` reference
  rather than relying on alias-reclaim heuristics?
- Where do owner/admin roles live: `group_members.role` column, or a separate
  `group_roles` table to keep `group_members` lean?
- Does the privileged CLI need its own auth model when `SYNCHRONIZE_BIND` is
  non-localhost, or is the bearer-token gate enough?
