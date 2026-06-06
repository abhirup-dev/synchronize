import { Database } from "bun:sqlite";

import { derivePresence, type PeerRow } from "./peers.ts";
import type { EventRow } from "./events.ts";

// Row for the read-only web Activity feed: the standard event columns plus a
// thread reply count and an explicit `awaiting` flag (1 when the event is in the
// observer's inbox and un-acked). The endpoint never mutates delivery/read state.
// `awaiting` is computed in SQL — under the LEFT JOIN, a null acked_at is
// ambiguous (no inbox row vs. unacked row), so we never derive awaiting from
// acked_at on the client.
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
  const awaitingClause = input.awaitingOnly ? "AND i.event_id IS NOT NULL AND i.acked_at IS NULL" : "";
  const rows = db
    .query<ActivityRow, [string, number, string, string, string, number]>(
      `SELECT e.*, g.name AS group_name, i.acked_at AS acked_at,
              (i.event_id IS NOT NULL AND i.acked_at IS NULL) AS awaiting,
              (SELECT COUNT(*) FROM events r WHERE r.parent_event_id = e.event_id) AS reply_count
       FROM events e
       LEFT JOIN groups g ON g.group_id = e.group_id
       LEFT JOIN inbox i ON i.event_id = e.event_id AND i.recipient_peer_id = ?
       WHERE e.event_id < ?
         AND e.type IN ('group_message', 'dm')
         AND e.sender_peer_id != ?
         AND (e.group_id IS NOT NULL
              OR (e.type = 'dm' AND (e.sender_peer_id = ? OR e.recipient_peer_id = ?)))
         ${awaitingClause}
       ORDER BY e.event_id DESC
       LIMIT ?`,
    )
    .all(input.peerId, input.before, input.peerId, input.peerId, input.peerId, input.limit);
  const awaitingCount =
    db
      .query<{ n: number }, [string]>(
        "SELECT COUNT(*) AS n FROM inbox WHERE recipient_peer_id = ? AND acked_at IS NULL",
      )
      .get(input.peerId)?.n ?? 0;
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
