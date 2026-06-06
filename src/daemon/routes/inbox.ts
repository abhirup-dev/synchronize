import { jsonResponse } from "../../http.ts";
import { attachReactions, eventForRecipient } from "../repo/events.ts";
import { ensurePeer } from "../repo/peers.ts";
import { emitWebStateChanged } from "../services/web-events.ts";
import type { DaemonContext, InboxRow } from "../server.ts";
import { optionalIntegerArray, parseCursor, parseLimit, readBody } from "../validation.ts";

export async function tryHandleInboxRoute(request: Request, ctx: DaemonContext, url: URL): Promise<Response | null> {
  const inboxMatch = url.pathname.match(/^\/peers\/([^/]+)\/inbox$/);
  if (request.method === "GET" && inboxMatch) {
    const peerId = decodeURIComponent(inboxMatch[1] ?? "");
    ensurePeer(ctx.db, peerId);
    const limit = parseLimit(url.searchParams.get("limit"));
    const after = parseCursor(url.searchParams.get("cursor"));
    const includeAcked = url.searchParams.get("include_acked") === "true";
    const ackClause = includeAcked ? "" : "AND i.acked_at IS NULL";
    const rows = ctx.db
      .query<InboxRow, [string, number, number]>(
        `SELECT e.*, g.name AS group_name, i.delivered_at, i.read_at, i.acked_at
         FROM inbox i
         JOIN events e ON e.event_id = i.event_id
         LEFT JOIN groups g ON g.group_id = e.group_id
         WHERE i.recipient_peer_id = ? AND e.event_id > ? ${ackClause}
         ORDER BY e.event_id ASC
         LIMIT ?`,
      )
      .all(peerId, after, limit);
    if (rows.length > 0) {
      const now = new Date().toISOString();
      ctx.db
        .query(
          `UPDATE inbox
           SET read_at = COALESCE(read_at, ?)
           WHERE recipient_peer_id = ? AND event_id IN (${rows.map(() => "?").join(",")})`,
        )
        .run(now, peerId, ...rows.map((row) => row.event_id));
      emitWebStateChanged(ctx, { domains: ["inbox"], eventId: rows[rows.length - 1]!.event_id, peerId });
    }
    return jsonResponse({
      events: attachReactions(ctx.db, rows.map((row) => eventForRecipient(row, peerId))),
      next_cursor: rows.at(-1)?.event_id ?? after,
    });
  }

  const inboxAck = url.pathname.match(/^\/peers\/([^/]+)\/inbox\/ack$/);
  if (request.method === "POST" && inboxAck) {
    const peerId = decodeURIComponent(inboxAck[1] ?? "");
    ensurePeer(ctx.db, peerId);
    const body = await readBody(request);
    const ids = optionalIntegerArray(body, "event_ids");
    const now = new Date().toISOString();
    let changed = 0;
    if (ids && ids.length > 0) {
      changed = ctx.db
        .query(
          `UPDATE inbox
           SET acked_at = COALESCE(acked_at, ?)
           WHERE recipient_peer_id = ? AND event_id IN (${ids.map(() => "?").join(",")})`,
        )
        .run(now, peerId, ...ids).changes;
    } else {
      changed = ctx.db
        .query(
          `UPDATE inbox
           SET acked_at = COALESCE(acked_at, ?)
           WHERE recipient_peer_id = ? AND acked_at IS NULL`,
        )
        .run(now, peerId).changes;
    }
    if (changed > 0) emitWebStateChanged(ctx, { domains: ["inbox"], peerId });
    return jsonResponse({ ok: true, acked: changed });
  }

  return null;
}
