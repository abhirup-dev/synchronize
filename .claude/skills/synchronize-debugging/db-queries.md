# db-queries.md

Forensic SQL recipes for the synchronize SQLite database. This file is a
reference — copy-paste the query that matches your question.

For the schema itself, read `src/db.ts` directly (canonical, ~170 lines).
Brief table summary at the bottom of this file.

## Opening the DB

```bash
# Default runtime
sqlite3 ~/.synchronize/synchronize.db

# Dev runtime
sqlite3 $(pwd)/.dev-synchronize/synchronize.db
```

Useful one-time pragmas inside the shell:
```sql
.headers on
.mode column
.timer on
```

The daemon uses WAL mode (`PRAGMA journal_mode = WAL`) so reads are safe
while the daemon is running. Do NOT run writes; the daemon owns the DB and
won't notice your changes until restart anyway.

A bash-friendly one-liner with formatting:
```bash
sqlite3 -header -column ~/.synchronize/synchronize.db "<query>"
```

## Peers

### Live roster (alive + online)
```sql
SELECT substr(peer_id, 1, 8) AS peer, tool, session_name,
       datetime(updated_at) AS last_hb,
       datetime(lease_expires_at) AS lease_exp
FROM peers
WHERE deleted_at IS NULL
  AND lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
ORDER BY updated_at DESC;
```

### Alive but offline (lease expired, not yet soft-deleted)
```sql
SELECT substr(peer_id, 1, 8) AS peer, tool, session_name,
       datetime(updated_at) AS last_hb
FROM peers
WHERE deleted_at IS NULL
  AND lease_expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
ORDER BY updated_at DESC;
```

### Soft-deleted peers (deceased agents, audit-preserved)
```sql
SELECT substr(peer_id, 1, 8) AS peer, tool, session_name,
       datetime(created_at) AS created,
       datetime(deleted_at) AS died,
       round((julianday(deleted_at) - julianday(created_at)) * 24, 1) AS hours_lived
FROM peers
WHERE deleted_at IS NOT NULL
ORDER BY deleted_at DESC;
```

### Death-correlation — peers that died at the same instant
```sql
-- If two peers died within the same second, you may have a cascade
SELECT substr(deleted_at, 1, 19) AS death_second, COUNT(*) AS dead,
       group_concat(session_name) AS who
FROM peers
WHERE deleted_at IS NOT NULL
GROUP BY substr(deleted_at, 1, 19)
HAVING dead > 1;
```

### Full lifecycle for one peer
```sql
SELECT peer_id, tool, session_name, purpose,
       datetime(created_at) AS created,
       datetime(updated_at) AS last_hb,
       datetime(lease_expires_at) AS lease,
       datetime(deleted_at) AS deleted,
       CASE WHEN updated_at = deleted_at THEN 'died on heartbeat (deleted by self)' END AS hint
FROM peers
WHERE session_name = 'bob';
```

## Groups & members

### Group overview with member counts and recent activity
```sql
SELECT g.group_id, g.name,
       CASE g.durable WHEN 1 THEN 'durable' ELSE 'ephemeral' END AS kind,
       COUNT(CASE WHEN gm.active = 1 THEN 1 END) AS active_members,
       COUNT(gm.peer_id) AS total_members,
       (SELECT datetime(MAX(created_at)) FROM events e WHERE e.group_id = g.group_id) AS last_event
FROM groups g
LEFT JOIN group_members gm ON g.group_id = gm.group_id
GROUP BY g.group_id;
```

### Active members of a group with online status
```sql
SELECT gm.alias,
       substr(gm.peer_id, 1, 8) AS peer,
       p.session_name, p.tool,
       CASE WHEN p.deleted_at IS NOT NULL THEN 'DELETED'
            WHEN p.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now') THEN 'online'
            ELSE 'offline' END AS state,
       datetime(gm.joined_at) AS joined
FROM group_members gm
JOIN peers p ON gm.peer_id = p.peer_id
WHERE gm.group_id = ? AND gm.active = 1
ORDER BY gm.alias;
```

### Departed members of a group (with audit trail intact)
```sql
SELECT gm.alias, substr(gm.peer_id, 1, 8) AS peer, p.session_name,
       datetime(gm.joined_at) AS joined,
       datetime(gm.left_at) AS left
FROM group_members gm
JOIN peers p ON gm.peer_id = p.peer_id
WHERE gm.group_id = ? AND gm.active = 0
ORDER BY gm.left_at DESC;
```

### Mention sanity check — does this alias exist?
```sql
SELECT alias, substr(peer_id, 1, 8) AS peer, active
FROM group_members
WHERE group_id = ? AND alias = 'cialice';
-- Empty result → mention will silently miss (alias_not_in_group warning)
```

## Events

### Last N events with sender alias resolved
```sql
SELECT e.event_id, e.type,
       COALESCE(gm.alias, substr(e.sender_peer_id, 1, 8), '-') AS sender,
       COALESCE(e.group_id, '-') AS gid,
       COALESCE(e.parent_event_id, '-') AS parent,
       substr(REPLACE(COALESCE(e.body, ''), char(10), ' '), 1, 60) AS preview
FROM events e
LEFT JOIN group_members gm
  ON gm.peer_id = e.sender_peer_id
 AND gm.group_id = e.group_id
 AND gm.active = 1
ORDER BY e.event_id DESC
LIMIT 20;
```

### Walk a thread (root + all replies)
```sql
WITH thread AS (SELECT 60 AS root_id)
SELECT event_id, type,
       substr(sender_peer_id, 1, 8) AS sender,
       parent_event_id,
       substr(body, 1, 80) AS preview,
       datetime(created_at) AS at
FROM events, thread
WHERE event_id = thread.root_id OR parent_event_id = thread.root_id
ORDER BY event_id;
```

### Events by type histogram
```sql
SELECT type, COUNT(*) AS n
FROM events
GROUP BY type
ORDER BY n DESC;
```

### Events from a specific sender
```sql
SELECT event_id, type, datetime(created_at) AS at,
       substr(body, 1, 80) AS preview
FROM events
WHERE sender_peer_id = ?
ORDER BY event_id DESC LIMIT 50;
```

## Inbox

### Inbox depth per peer (unread/unacked)
```sql
SELECT i.recipient_peer_id, p.session_name,
       COUNT(*) AS unacked
FROM inbox i
JOIN peers p ON i.recipient_peer_id = p.peer_id
WHERE i.acked_at IS NULL
GROUP BY i.recipient_peer_id
ORDER BY unacked DESC;
```

### What's in peer X's unread inbox
```sql
SELECT i.event_id, e.type,
       substr(e.sender_peer_id, 1, 8) AS sender,
       substr(e.body, 1, 60) AS preview,
       datetime(i.created_at) AS landed,
       datetime(i.delivered_at) AS delivered,
       datetime(i.acked_at) AS acked
FROM inbox i
JOIN events e ON i.event_id = e.event_id
WHERE i.recipient_peer_id = ? AND i.acked_at IS NULL
ORDER BY i.event_id;
```

## Agent sessions

### Current bindings with peer state
```sql
SELECT substr(s.peer_id, 1, 8) AS peer,
       p.session_name,
       s.host_tool,
       substr(s.host_session_id, 1, 12) AS host_sid,
       s.cwd,
       datetime(s.last_seen_at) AS last_seen,
       CASE WHEN p.deleted_at IS NOT NULL THEN 'DELETED'
            WHEN p.lease_expires_at < strftime('%Y-%m-%dT%H:%M:%fZ','now') THEN 'offline'
            ELSE 'online' END AS peer_state
FROM agent_sessions s
LEFT JOIN peers p ON s.peer_id = p.peer_id
ORDER BY s.last_seen_at DESC;
```

### Stale bindings — peer is dead but binding lingers
```sql
SELECT s.binding_id, s.host_tool, s.host_session_id,
       p.session_name,
       datetime(p.deleted_at) AS peer_died,
       datetime(s.last_seen_at) AS binding_last_seen
FROM agent_sessions s
JOIN peers p ON s.peer_id = p.peer_id
WHERE p.deleted_at IS NOT NULL;
```

## Media

### Recent media shares in a group
```sql
SELECT media_id, original_path, content_type, size_bytes,
       substr(shared_by_peer_id, 1, 8) AS shared_by,
       datetime(created_at) AS shared
FROM media_items
WHERE group_id = ?
ORDER BY created_at DESC LIMIT 10;
```

## Schema summary

For the canonical DDL, read `src/db.ts`. Briefly:

| Table | Purpose |
|---|---|
| `peers` | Identity: peer_id, tool, session_name, lease_expires_at, deleted_at |
| `agent_sessions` | Binds peer ↔ host session (Pi/Claude/Codex) by host_session_id |
| `groups` | group_id, name, durable flag, media_dir |
| `group_members` | Junction: group_id × peer_id with alias, active flag, joined_at/left_at |
| `events` | Single events table for dm, group_message, group_*, media_*, member_* — type CHECK from EVENT_TYPES |
| `inbox` | Durable delivery fallback per (recipient_peer_id, event_id) with delivered_at/read_at/acked_at |
| `media_items` | Per-group media: original_path, copied_path, sha256, content_type |
| `schema_migrations` | Version tracking; migration v2 added `peers.deleted_at` (soft-delete) |

## Bash helpers

```bash
# Quick "is everything healthy?" — counts only
sqlite3 ~/.synchronize/synchronize.db <<'SQL'
SELECT 'peers',          COUNT(*) FROM peers WHERE deleted_at IS NULL
UNION ALL SELECT 'peers_deleted',  COUNT(*) FROM peers WHERE deleted_at IS NOT NULL
UNION ALL SELECT 'groups',         COUNT(*) FROM groups
UNION ALL SELECT 'events',         COUNT(*) FROM events
UNION ALL SELECT 'inbox_unacked',  COUNT(*) FROM inbox WHERE acked_at IS NULL;
SQL
```

## See also

- `peer-lifecycle.md` — narrative interpretation of the peer queries here
- `delivery-forensics.md` — narrative interpretation of event/inbox queries
- `glossary.md` — code-side mapping of each table to the modules that read/write it
