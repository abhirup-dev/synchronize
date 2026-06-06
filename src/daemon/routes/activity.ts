import { HttpError, jsonResponse } from "../../http.ts";
import { listActivityPage } from "../repo/activity.ts";
import { attachReactions, eventForRecipient } from "../repo/events.ts";
import { ensurePeer } from "../repo/peers.ts";
import type { DaemonContext } from "../server.ts";
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
    const activity = listActivityPage(ctx.db, {
      peerId,
      before,
      limit,
      awaitingOnly: url.searchParams.get("filter") === "awaiting",
    });
    return jsonResponse({
      events: attachReactions(ctx.db, activity.rows.map((row) => eventForRecipient(row, peerId))),
      peers: activity.peers,
      next_cursor: activity.rows.at(-1)?.event_id ?? null,
      awaiting_count: activity.awaitingCount,
    });
  }

  return null;
}
