# delivery-forensics.md

Delivery in synchronize is a multi-surface problem with two delivery paths.
Diagnosing "message X didn't arrive" requires knowing which surface the
message lives on and which path it should have travelled.

## Two delivery paths (the foundational mental model)

| Path | When it fires | How to confirm it ran |
|---|---|---|
| **Push (channel)** | Peer has a live subscriber callback registered with the daemon | `pushed_to` array on the send response |
| **Inbox (durable)** | Always written for every targeted recipient, regardless of push success | `inbox: true` on the send response; row visible in `inbox` table |

A peer that's "online" by lease can still receive zero pushes if its
subscriber callback isn't registered (see "alive but unreachable" in
`peer-lifecycle.md`). The inbox is the safety net.

**First diagnostic for any "didn't arrive" report**: look at the send
response's `delivery` field. `pushed_to: []` + `inbox: true` means the
message landed in the durable inbox but the channel notification didn't
go out — recipient is alive-but-unreachable, not actually missing the
message. They'll see it on next `bridge_inbox` poll.

## Delivery surfaces

### Direct messages (DMs)

Single recipient. Push targets `recipient_peer_id` if subscribed; inbox row
always written.

```sql
-- Did peer X receive event Y? Is it acked?
SELECT event_id, datetime(delivered_at), datetime(read_at), datetime(acked_at)
FROM inbox
WHERE recipient_peer_id = ? AND event_id = ?;
```

### Group main channel

Push targets are scoped — NOT every active member gets a push:
- Mentioned peers (`@alias` in body, resolved against `group_members.alias`)
- Active thread participants (anyone who replied to the same thread root)

Inbox rows are written for ALL active members of the group. So even
non-mentioned non-thread-participants get the message durably; they just
don't get a real-time channel push.

```sql
-- Who got pushed for event Y vs who got an inbox row?
-- (No "pushed_to" persistence — only the send-response shows that.
-- Inbox rows are the durable record.)
SELECT i.recipient_peer_id, datetime(i.delivered_at), datetime(i.acked_at)
FROM inbox i
WHERE i.event_id = ?;
```

### Threads

Threads are one level deep. The daemon's normalizer collapses replies-to-
replies onto the thread root via `parent_event_id`. So if A replies to root
R, and B replies to A, both A and B have `parent_event_id = R`. There is no
"reply to A's reply" — the daemon will silently rewrite it.

```sql
-- Walk a thread (root + all replies, ordered)
WITH root AS (SELECT 60 AS root_id)
SELECT event_id, type, sender_peer_id, parent_event_id,
       substr(body, 1, 60) AS preview
FROM events, root
WHERE event_id = root.root_id OR parent_event_id = root.root_id
ORDER BY event_id;
```

Push fan-out for thread replies includes all active participants of that
thread (anyone with a prior reply or the root sender).

### @mentions — the alias trap

Mentions are matched by **`group_members.alias` exactly, case-sensitive**,
NOT by `session_name`. The regex is `MENTION_TOKEN_RE = /@([a-zA-Z0-9][a-zA-Z0-9._-]*)/g`
in `src/daemon.ts`.

So if a member's `session_name` is `Cialice` but their `alias` in the
group is `alice`, then `@cialice` will NOT resolve. The daemon emits a
warning with `reason: "alias_not_in_group"` and the message goes through
without that mention attached.

Sanity check:

```sql
-- Does alias 'cialice' exist in group 1?
SELECT alias, substr(peer_id, 1, 8) AS peer, active
FROM group_members
WHERE group_id = 1 AND alias = 'cialice';
```

Fix paths:
- Rename in group: `bridge_rename_in_group` with the right alias
- Tell the sender to use the actual group alias

This trap is silent for the sender (no error, no warning surfaced to the
agent) — only visible by inspecting the send response's warnings array or
by noticing the recipient didn't get a push.

### Media

Media is group-scoped. The original file is copied into `$SYNCHRONIZE_HOME/
media/<group-id>/<media-id>` and tracked in the `media_items` table.

```sql
-- Recent media shares in group 1
SELECT media_id, original_path, content_type, size_bytes,
       substr(shared_by_peer_id, 1, 8) AS shared_by,
       datetime(created_at) AS shared
FROM media_items
WHERE group_id = 1
ORDER BY created_at DESC
LIMIT 10;
```

A `media_shared` event accompanies the row; delivery follows group-main-
channel rules (push to mentioned + thread participants, inbox to all).

### agent_sessions

Not a delivery surface but binds host-session → peer for routing. Used by
the operator UI and Pi/Claude session integration to display which agent
backs which session.

```sql
-- Stale agent_sessions (peer no longer alive)
SELECT s.binding_id, s.host_tool, s.host_session_id, s.cwd,
       p.session_name,
       CASE WHEN p.deleted_at IS NOT NULL THEN 'DELETED'
            WHEN p.lease_expires_at < strftime('%Y-%m-%dT%H:%M:%fZ','now') THEN 'offline'
            ELSE 'online' END AS peer_state
FROM agent_sessions s
JOIN peers p ON s.peer_id = p.peer_id
ORDER BY s.last_seen_at DESC;
```

`agent_sessions` rows are not auto-cleaned. They accumulate as host_session_ids
rotate. Use the query above to identify ones tied to dead peers if the
roster surfaces stale entries.

## Event types reference

From `src/constants.ts` `EVENT_TYPES`:

| Type | Fires when | Push fan-out |
|---|---|---|
| `dm` | bridge_dm sent | recipient only (if subscribed) |
| `group_message` | bridge_send_group | mentioned + thread participants |
| `group_created` | bridge_create_group | (no fan-out; informational) |
| `group_joined` | bridge_join_group | active group members (presence update) |
| `group_left` | bridge_leave_group | active group members |
| `media_shared` | bridge_share_media | same as group_message |
| `media_changed` | media metadata update | same as group_message |
| `group_member_alias_reclaimed` | alias reused after departure | active group members |
| `group_member_renamed` | bridge_rename_in_group | active group members |

Adding a new event type requires updating both `EVENT_TYPES` in
`src/constants.ts` AND the CHECK constraint in `src/db.ts`. If you grep for
an event type and find it in one but not the other, the schema is out of
sync.

## Diagnosis decision tree

```
"X sent something to Y but Y didn't see it"
│
├─ DM or group message?
│  │
│  ├─ DM → check inbox for recipient + event_id
│  │       │
│  │       ├─ row exists → recipient just hasn't pulled inbox yet
│  │       └─ no row    → message never sent (check sender's send response)
│  │
│  └─ Group → check inbox for all members + the event_id
│         │
│         ├─ inbox rows present for active members → delivered durably; pushes may have missed
│         │   (check sender's send response delivery.pushed_to to confirm)
│         │
│         └─ no inbox rows → message sent but events row missing? check events table directly
│
├─ Was it a thread reply?
│  └─ Check parent_event_id resolution; reply-to-reply collapses to root
│
└─ Did the sender use @-mention?
   └─ Run alias sanity check (above); silent miss likely
```

## Forensic recipes

**Last 10 DMs to peer X:**
```sql
SELECT event_id, datetime(created_at), substr(sender_peer_id,1,8), substr(body,1,60)
FROM events
WHERE type='dm' AND recipient_peer_id=?
ORDER BY event_id DESC LIMIT 10;
```

**All inbox rows that haven't been acked, by peer:**
```sql
SELECT i.recipient_peer_id, p.session_name, COUNT(*) AS backlog
FROM inbox i JOIN peers p ON i.recipient_peer_id = p.peer_id
WHERE i.acked_at IS NULL
GROUP BY i.recipient_peer_id
ORDER BY backlog DESC;
```

**Did event X get pushed at all? (No persisted record — check sender's
recent log line or replay):**
There is no `pushed_to` history table. Push outcomes are only visible at
send time. If you missed the send response, you cannot retroactively
determine push fan-out. Tail `pi-extension.log` or daemon stderr for hints.

## See also

- `peer-lifecycle.md` — "alive but unreachable" is the most common
  channel-push failure
- `db-queries.md` — canonical SQL for all the above
- `glossary.md` — where `MENTION_TOKEN_RE`, `EVENT_TYPES`, and the subscriber
  map live in code
