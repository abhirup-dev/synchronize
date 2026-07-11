import { z } from "zod";
import { listEventReactions, reactToEvent } from "../../api/reactions.ts";
import { getClient, requirePeer } from "../state.ts";
import { text, wrap } from "../util.ts";
import { formatEventForMcp } from "./event-format.ts";
import type { ToolContext } from "./context.ts";

export function registerReactionTools(ctx: ToolContext): void {
  const { mcp, state } = ctx;

  mcp.registerTool(
    "bridge_react",
    {
      description:
        "Attach a lightweight emoji reaction to a visible message event. " +
        "This is the preferred '+1 / ack / agreed' primitive: no message body, no thread reply, and no push notification. " +
        "Default op is add; use op=toggle for UI-like behavior or op=remove to clear your own reaction. " +
        "Returns: { event, reactions, changed, active }. Idempotency: add/remove are idempotent per (event_id, emoji, peer).",
      inputSchema: {
        event_id: z.number().int().positive(),
        emoji: z.string().min(1).max(32),
        op: z.enum(["add", "remove", "toggle"]).optional(),
      },
    },
    wrap(async (args) => {
      const client = await getClient(state);
      const peer = requirePeer(state);
      const response = await reactToEvent(client, {
        eventId: args.event_id,
        peerId: peer.peer_id,
        emoji: args.emoji,
        ...(args.op ? { op: args.op } : {}),
      });
      return text({ ...response, event: formatEventForMcp(response.event) });
    }),
  );

  mcp.registerTool(
    "bridge_list_reactions",
    {
      description:
        "List emoji reactions attached to a visible message event. " +
        "Returns: { event, reactions: [{ emoji, count, by: [{ peer_id, session_name, tool, alias, created_at }] }] }. " +
        "Idempotency: pure read.",
      inputSchema: { event_id: z.number().int().positive() },
    },
    wrap(async (args) => {
      const client = await getClient(state);
      const peer = requirePeer(state);
      const response = await listEventReactions(client, { eventId: args.event_id, peerId: peer.peer_id });
      return text({ ...response, event: formatEventForMcp(response.event) });
    }),
  );
}
