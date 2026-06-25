# SQL Query Reference

Read-only SQL recipes for inspecting a synchronize daemon. The canonical schema
is `src/db.ts`; this file only captures common forensic questions.

Prefer the guarded API/MCP query surface when available:

```text
bridge_query_events({ sql: "...", params: [...] })
synchronize query events --sql "..."
```

For local daemon files, `sqlite3` is also acceptable for reads:

```bash
sqlite3 -header -column ~/.synchronize/synchronize.db "<query>"
SYNCHRONIZE_HOME=$(pwd)/.dev-synchronize sqlite3 -header -column "$(pwd)/.dev-synchronize/synchronize.db" "<query>"
```

Do not run writes against the daemon-owned DB during live debugging.

## Health Counts

```sql
SELECT 'peers_alive', COUNT(*) FROM peers WHERE deleted_at IS NULL
UNION ALL SELECT 'peers_deleted', COUNT(*) FROM peers WHERE deleted_at IS NOT NULL
UNION ALL SELECT 'groups', COUNT(*) FROM groups
UNION ALL SELECT 'events', COUNT(*) FROM events
UNION ALL SELECT 'inbox_unacked', COUNT(*) FROM inbox WHERE acked_at IS NULL;
```

## Peers

Live roster:

```sql
SELECT substr(peer_id, 1, 8) AS peer, tool, session_name,
       lifecycle_state, activity_state,
       datetime(updated_at) AS last_hb,
       datetime(lease_expires_at) AS lease_exp
FROM peers
WHERE deleted_at IS NULL
  AND lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
ORDER BY updated_at DESC;
```

Soft-deleted peers:

```sql
SELECT substr(peer_id, 1, 8) AS peer, tool, session_name,
       datetime(created_at) AS created,
       datetime(deleted_at) AS deleted
FROM peers
WHERE deleted_at IS NOT NULL
ORDER BY deleted_at DESC;
```

Stale agent-session bindings:

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

## Groups And Mentions

Group overview:

```sql
SELECT g.group_id, g.name,
       CASE g.durable WHEN 1 THEN 'durable' ELSE 'ephemeral' END AS kind,
       COUNT(CASE WHEN gm.active = 1 THEN 1 END) AS active_members,
       COUNT(gm.peer_id) AS total_members,
       COALESCE((SELECT datetime(MAX(created_at))
                 FROM events e
                 WHERE e.group_id = g.group_id), '-') AS last_activity
FROM groups g
LEFT JOIN group_members gm ON g.group_id = gm.group_id
GROUP BY g.group_id
ORDER BY g.group_id;
```

Active members with lease state:

```sql
SELECT gm.group_id, g.name AS group_name, gm.alias,
       substr(gm.peer_id, 1, 8) AS peer,
       p.session_name, p.tool,
       CASE WHEN p.deleted_at IS NOT NULL THEN 'DELETED'
            WHEN p.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now') THEN 'online'
            ELSE 'offline' END AS state
FROM group_members gm
JOIN groups g ON g.group_id = gm.group_id
LEFT JOIN peers p ON p.peer_id = gm.peer_id
WHERE gm.active = 1
ORDER BY gm.group_id, gm.alias;
```

Mention alias sanity check:

```sql
SELECT alias, substr(peer_id, 1, 8) AS peer, active
FROM group_members
WHERE group_id = ? AND alias = ?;
```

## Events And Threads

Recent events:

```sql
SELECT e.event_id, e.type,
       COALESCE(gm.alias, substr(e.sender_peer_id, 1, 8), '-') AS sender,
       COALESCE(e.group_id, '-') AS gid,
       COALESCE(e.parent_event_id, '-') AS parent,
       substr(REPLACE(COALESCE(e.body, ''), char(10), ' '), 1, 80) AS preview,
       datetime(e.created_at) AS at
FROM events e
LEFT JOIN group_members gm
  ON gm.peer_id = e.sender_peer_id
 AND gm.group_id = e.group_id
 AND gm.active = 1
ORDER BY e.event_id DESC
LIMIT 50;
```

Walk a thread using the friendly view:

```sql
SELECT event_id, sender_session_name, body,
       parent_event_id, reply_to_event_id,
       direct_sender_session_name, direct_body,
       thread_root_event_id, thread_root_body,
       datetime(created_at) AS at
FROM thread_events
WHERE thread_root_event_id = ?
ORDER BY event_id;
```

Find the exact event a reply answered:

```sql
SELECT event_id, body,
       reply_to_event_id, direct_sender_session_name, direct_body,
       thread_root_event_id, thread_root_sender_session_name, thread_root_body
FROM thread_events
WHERE event_id = ?;
```

Discover active threads:

```sql
SELECT root_event_id, group_name, root_sender_session_name,
       reply_count, participant_count,
       datetime(last_activity_at) AS last_activity,
       preview
FROM discoverable_threads
ORDER BY last_activity_at DESC, root_event_id DESC
LIMIT 25;
```

## Inbox

Inbox depth by peer:

```sql
SELECT i.recipient_peer_id, p.session_name, COUNT(*) AS unacked
FROM inbox i
JOIN peers p ON i.recipient_peer_id = p.peer_id
WHERE i.acked_at IS NULL
GROUP BY i.recipient_peer_id
ORDER BY unacked DESC;
```

Unread/unacked rows for one peer:

```sql
SELECT i.event_id, e.type,
       substr(e.sender_peer_id, 1, 8) AS sender,
       substr(e.body, 1, 80) AS preview,
       datetime(i.created_at) AS landed,
       datetime(i.delivered_at) AS delivered,
       datetime(i.acked_at) AS acked
FROM inbox i
JOIN events e ON i.event_id = e.event_id
WHERE i.recipient_peer_id = ? AND i.acked_at IS NULL
ORDER BY i.event_id;
```

## Archive And Launch

Archived peers:

```sql
SELECT substr(peer_id, 1, 8) AS peer, session_name,
       lifecycle_state, archive_source,
       datetime(archived_at) AS archived_at,
       archived_reason
FROM peers
WHERE lifecycle_state = 'archived'
ORDER BY archived_at DESC;
```

Recent launch intents:

```sql
SELECT launch_id, state, peer_id, command,
       datetime(created_at) AS created,
       datetime(updated_at) AS updated
FROM launch_intents
ORDER BY updated_at DESC
LIMIT 25;
```

## Media

Recent media shares:

```sql
SELECT media_id, group_id, original_path, content_type, size_bytes,
       substr(shared_by_peer_id, 1, 8) AS shared_by,
       datetime(created_at) AS shared
FROM media_items
ORDER BY created_at DESC
LIMIT 25;
```
