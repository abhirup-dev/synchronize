import { Database } from "bun:sqlite";

import { derivePresence, type PeerRow } from "./peers.ts";
import type { EventRow } from "./events.ts";

// Row for the read-only web Activity feed: the standard event columns plus a
// thread reply count and an explicit `awaiting` flag. Awaiting is a thread
// interaction signal: agent-authored group messages after the observer's last
// reply/reaction/handled marker in that thread. It is intentionally decoupled
// from durable inbox read state, which remains the notification fallback.
export interface ActivityRow extends EventRow {
  group_name: string | null;
  reply_count: number;
  acked_at: string | null;
  awaiting: number;
}

export function listActivityPage(
  db: Database,
  input: { peerId: string; before: number; limit: number; awaitingOnly: boolean },
): {
  rows: ActivityRow[];
  peers: Array<PeerRow & { online: boolean; presence: ReturnType<typeof derivePresence> }>;
  awaitingCount: number;
} {
  const visibleActivityCte = `
    WITH visible AS (
      SELECT e.*, g.name AS group_name, i.acked_at AS acked_at,
             COALESCE(e.parent_event_id, e.event_id) AS activity_thread_root,
             CASE
               WHEN e.group_id IS NOT NULL THEN 'group:' || e.group_id
               WHEN e.type = 'dm' THEN 'dm:' ||
                 CASE
                   WHEN e.sender_peer_id < e.recipient_peer_id THEN e.sender_peer_id || ':' || e.recipient_peer_id
                   ELSE e.recipient_peer_id || ':' || e.sender_peer_id
                 END
               ELSE 'event:' || e.event_id
             END AS activity_room_scope,
             sender.tool AS sender_tool,
             pti.last_interaction_event_id AS last_interaction_event_id
      FROM events e
      LEFT JOIN peers sender ON sender.peer_id = e.sender_peer_id
      LEFT JOIN groups g ON g.group_id = e.group_id
      LEFT JOIN inbox i ON i.event_id = e.event_id AND i.recipient_peer_id = ?
      LEFT JOIN peer_thread_interactions pti
        ON pti.peer_id = ?
       AND pti.group_id = e.group_id
       AND pti.thread_root_event_id = COALESCE(e.parent_event_id, e.event_id)
      WHERE e.type IN ('group_message', 'dm')
        AND e.sender_peer_id IS NOT NULL
        AND e.sender_peer_id != ?
        AND (e.group_id IS NOT NULL
             OR (e.type = 'dm' AND (e.sender_peer_id = ? OR e.recipient_peer_id = ?)))
    ),
    ranked AS (
      SELECT visible.*,
             (visible.type = 'group_message'
              AND visible.group_id IS NOT NULL
              AND visible.sender_tool != 'web'
              AND visible.event_id > COALESCE(visible.last_interaction_event_id, 0)) AS awaiting,
             ROW_NUMBER() OVER (
               PARTITION BY visible.activity_room_scope, visible.activity_thread_root, visible.sender_peer_id
               ORDER BY visible.event_id DESC
             ) AS activity_rank,
             (SELECT COUNT(*) FROM events r WHERE r.parent_event_id = visible.event_id) AS reply_count
      FROM visible
    )`;
  const awaitingClause = input.awaitingOnly ? "AND awaiting" : "";
  const rows = db
    .query<ActivityRow, Array<string | number>>(
      `${visibleActivityCte}
       SELECT event_id, type, sender_peer_id, recipient_peer_id, group_id, group_name,
              body, media_id, parent_event_id, reply_to_event_id, mentions_json,
              skill_directives_json, created_at, acked_at, awaiting, reply_count
       FROM ranked
       WHERE activity_rank = 1
         AND event_id < ?
         ${awaitingClause}
       ORDER BY event_id DESC
       LIMIT ?`,
    )
    .all(
      input.peerId,
      input.peerId,
      input.peerId,
      input.peerId,
      input.peerId,
      input.before,
      input.limit,
    );
  const awaitingCount =
    db
      .query<{ n: number }, [string, string, string, string, string]>(
        `${visibleActivityCte}
         SELECT COUNT(*) AS n
         FROM ranked
         WHERE activity_rank = 1
           AND awaiting`,
      )
      .get(input.peerId, input.peerId, input.peerId, input.peerId, input.peerId)?.n ?? 0;
  const peerIds = new Set<string>();
  for (const row of rows) {
    if (row.sender_peer_id) peerIds.add(row.sender_peer_id);
    if (row.recipient_peer_id) peerIds.add(row.recipient_peer_id);
  }
  const now = new Date().toISOString();
  const ids = [...peerIds];
  // Activity can page into durable history after the live roster has dropped a
  // lease-expired peer. Return just the authors referenced by this bounded
  // Activity page so the client can render old rows without widening the main
  // /web/state roster query or doing per-row identity lookups.
  const peers = ids.length === 0
    ? []
    : db
      .query<PeerRow & { online: number }, [string, ...string[]]>(
        `SELECT peer_id, tool, session_name, purpose, machine_id, lease_expires_at,
                activity_state, last_activity_at, last_cursor, created_at, updated_at,
                lease_expires_at > ? AS online
         FROM peers
         WHERE peer_id IN (${ids.map(() => "?").join(",")})`,
      )
      .all(now, ...ids)
      .map((peer) => ({
        ...peer,
        online: Boolean(peer.online),
        presence: derivePresence(Boolean(peer.online), peer.activity_state),
      }));
  return { rows, peers, awaitingCount };
}
