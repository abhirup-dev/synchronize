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
    const body = {
      events: attachReactions(ctx.db, activity.rows.map((row) => eventForRecipient(row, peerId))),
      peers: activity.peers,
      next_cursor: activity.rows.at(-1)?.event_id ?? null,
      awaiting_count: activity.awaitingCount,
    };
    // A scoped ETag: computed over what THIS surface renders, so a launch state
    // transition or a roster change elsewhere does not invalidate it. /web/state
    // cannot do this — one ETag over the whole workspace invalidates on any
    // change anywhere, which is why an addressable surface gets its own endpoint.
    const signature = [
      body.awaiting_count,
      body.next_cursor,
      ...body.events.map(
        (event) =>
          `${event.event_id}:${(event.reactions ?? [])
            .map((reaction) => `${reaction.emoji}:${reaction.count}`)
            .sort()
            .join(";")}`,
      ),
      ...body.peers.map((peer) => `${peer.peer_id}:${peer.session_name}`),
    ].join("|");
    const etag = `W/"${Bun.hash(signature).toString(36)}"`;
    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers: { etag } });
    }
    return jsonResponse(body, { headers: { etag, "cache-control": "no-cache" } });
  }

  return null;
}
