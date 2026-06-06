import { HttpError, jsonResponse } from "../../http.ts";
import {
  attachReactions,
  derivePresence,
  ensurePeer,
  eventForRecipient,
  type ActivityRow,
  type DaemonContext,
  type PeerRow,
} from "../server.ts";
import { parseLimit } from "../validation.ts";

export function tryHandleActivityRoute(request: Request, ctx: DaemonContext, url: URL): Response | null {
  const activityMatch = url.pathname.match(/^\/activity\/([^/]+)$/);
  if (request.method === "GET" && activityMatch) {
    const peerId = decodeURIComponent(activityMatch[1] ?? "");
    ensurePeer(ctx.db, peerId);
    const limit = parseLimit(url.searchParams.get("limit"));
    const beforeRaw = url.searchParams.get("before");
    const before = beforeRaw === null || beforeRaw === "" ? Number.MAX_SAFE_INTEGER : Number(beforeRaw);
    if (!Number.isFinite(before)) throw new HttpError(400, "invalid_cursor", "before must be a number");
    const awaitingOnly = url.searchParams.get("filter") === "awaiting";
    const awaitingClause = awaitingOnly ? "AND i.event_id IS NOT NULL AND i.acked_at IS NULL" : "";
    const rows = ctx.db
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
      .all(peerId, before, peerId, peerId, peerId, limit);
    const awaitingCount =
      ctx.db
        .query<{ n: number }, [string]>(
          "SELECT COUNT(*) AS n FROM inbox WHERE recipient_peer_id = ? AND acked_at IS NULL",
        )
        .get(peerId)?.n ?? 0;
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
      : ctx.db
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
    return jsonResponse({
      events: attachReactions(ctx.db, rows.map((row) => eventForRecipient(row, peerId))),
      peers,
      next_cursor: rows.at(-1)?.event_id ?? null,
      awaiting_count: awaitingCount,
    });
  }

  return null;
}
