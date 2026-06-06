import { HttpError, jsonResponse } from "../../http.ts";
import {
  ackInboxEvents,
  applyReaction,
  emitWebStateChanged,
  ensureActiveMember,
  ensureReactableEvent,
  getEvent,
  getVisibleEvent,
  reactionDmPeerId,
  type DaemonContext,
} from "../server.ts";
import { optionalReactionOp, readBody, requireEmoji, requireString } from "../validation.ts";

export async function tryHandleReactionsRoute(request: Request, ctx: DaemonContext, url: URL): Promise<Response | null> {
  const eventReactions = url.pathname.match(/^\/events\/(\d+)\/reactions$/);
  if (eventReactions) {
    const eventId = Number(eventReactions[1]);
    if (request.method === "GET") {
      const peerId = url.searchParams.get("peer_id");
      if (!peerId) throw new HttpError(400, "invalid_request", "peer_id query parameter is required");
      const event = getVisibleEvent(ctx.db, eventId, peerId);
      return jsonResponse({ event, reactions: event.reactions ?? [] });
    }
    if (request.method === "POST") {
      const body = await readBody(request);
      const peerId = requireString(body, "peer_id");
      const emoji = requireEmoji(requireString(body, "emoji"));
      const op = optionalReactionOp(body);
      const event = getVisibleEvent(ctx.db, eventId, peerId);
      ensureReactableEvent(event);
      if (event.group_id !== null) ensureActiveMember(ctx.db, event.group_id, peerId);
      const result = applyReaction(ctx.db, { eventId, peerId, emoji, op });
      if (result.active) ackInboxEvents(ctx.db, peerId, [eventId]);
      const updated = getEvent(ctx.db, eventId);
      emitWebStateChanged(ctx, {
        domains: ["reactions"],
        eventId,
        groupId: updated.group_id,
        peerId: updated.group_id === null ? reactionDmPeerId(updated, peerId) : peerId,
      });
      return jsonResponse({ ...result, event: updated, reactions: updated.reactions ?? [] });
    }
  }

  return null;
}
