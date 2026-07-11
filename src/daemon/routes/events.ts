import { HttpError, jsonResponse } from "../../http.ts";
import { attachReactions, eventForRecipient, getVisibleEvent } from "../repo/events.ts";
import { ensurePeer } from "../repo/peers.ts";
import { emitWebStateChanged } from "../services/web-events.ts";
import type { DaemonContext, InboxRow } from "../server.ts";
import { parseCursor, parseLimit } from "../validation.ts";

export function tryHandleEventLookupRoute(request: Request, ctx: DaemonContext, url: URL): Response | null {
  // GET /events/:event_id — single-event lookup with visibility enforcement.
  // Asked for by bob and alice in the 2026-05-23 customer review: when a
  // channel notification carries `event_id=22`, agents have no way to re-read
  // that row to verify parent/mention/body fields without scrolling history.
  const eventGet = url.pathname.match(/^\/events\/(\d+)$/);
  if (request.method === "GET" && eventGet) {
    const eventId = Number(eventGet[1]);
    const peerId = url.searchParams.get("peer_id");
    if (!peerId) throw new HttpError(400, "invalid_request", "peer_id query parameter is required");
    const event = getVisibleEvent(ctx.db, eventId, peerId);
    return jsonResponse({ event });
  }

  return null;
}

export function tryHandleEventPullRoute(request: Request, ctx: DaemonContext, url: URL): Response | null {
  const eventsMatch = url.pathname.match(/^\/events\/([^/]+)$/);
  if (request.method === "GET" && eventsMatch) {
    const peerId = decodeURIComponent(eventsMatch[1] ?? "");
    ensurePeer(ctx.db, peerId);
    const limit = parseLimit(url.searchParams.get("limit"));
    const cursor = parseCursor(url.searchParams.get("cursor"));
    const rows = ctx.db
      .query<InboxRow, [string, number, number]>(
        `SELECT e.*, g.name AS group_name, i.delivered_at, i.read_at, i.acked_at
         FROM inbox i
         JOIN events e ON e.event_id = i.event_id
         LEFT JOIN groups g ON g.group_id = e.group_id
         WHERE i.recipient_peer_id = ? AND e.event_id > ?
         ORDER BY e.event_id ASC
         LIMIT ?`,
      )
      .all(peerId, cursor, limit);
    if (rows.length > 0) {
      const now = new Date().toISOString();
      ctx.db
        .query(
          `UPDATE inbox
           SET delivered_at = COALESCE(delivered_at, ?)
           WHERE recipient_peer_id = ? AND event_id IN (${rows.map(() => "?").join(",")})`,
        )
        .run(now, peerId, ...rows.map((row) => row.event_id));
      ctx.db.query("UPDATE peers SET last_cursor = ? WHERE peer_id = ?").run(rows.at(-1)!.event_id, peerId);
      emitWebStateChanged(ctx, { domains: ["inbox", "peers"], eventId: rows[rows.length - 1]!.event_id, peerId });
    }
    return jsonResponse({
      events: attachReactions(ctx.db, rows.map((row) => eventForRecipient(row, peerId))),
      next_cursor: rows.at(-1)?.event_id ?? cursor,
    });
  }

  return null;
}
