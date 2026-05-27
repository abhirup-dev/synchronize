import { z } from "zod";
import { ackInbox, readInbox, sendDm } from "../../api/inbox.ts";
import { ensurePeer, getClient } from "../state.ts";
import { invalidArgument, text, wrap } from "../util.ts";
import { formatEventForMcp } from "./event-format.ts";
import type { ToolContext } from "./context.ts";

export function registerMessagingTools(ctx: ToolContext): void {
  const { mcp, state } = ctx;

  mcp.registerTool(
    "bridge_dm",
    {
      description:
        "Send a durable direct message to a peer. Use recipient_peer_id for the destination peer; peer_id is accepted as an alias. " +
        "Returns: { event } (event carries parsed mentions: string[] even for DMs — usually empty). " +
        "Idempotency: not idempotent — every call produces a new event.",
      inputSchema: { recipient_peer_id: z.string().min(1).optional(), peer_id: z.string().min(1).optional(), message: z.string().min(1) },
    },
    wrap(async (args) => {
      const recipientPeerId = args.recipient_peer_id ?? args.peer_id;
      if (!recipientPeerId) invalidArgument("bridge_dm requires recipient_peer_id");
      const client = await getClient(state);
      const peer = await ensurePeer(state, client);
      const response = await sendDm(client, {
        senderPeerId: peer.peer_id,
        recipientPeerId,
        message: args.message,
      });
      return text({ ...response, event: formatEventForMcp(response.event) });
    }),
  );

  mcp.registerTool(
    "bridge_inbox",
    {
      description:
        "Read durable inbox; optionally acknowledge returned rows. " +
        "Returns: { events: Event[] } where each event carries parsed mentions: string[]. " +
        "Idempotency: pure read when ack=false; ack=true marks rows acked (subsequent reads omit them).",
      inputSchema: { ack: z.boolean().optional() },
    },
    wrap(async (args) => {
      const client = await getClient(state);
      const peer = await ensurePeer(state, client);
      const inbox = await readInbox(client, peer.peer_id);
      if (args.ack && inbox.events.length > 0) {
        await ackInbox(client, peer.peer_id, inbox.events.map((event) => event.event_id));
      }
      return text({ ...inbox, events: inbox.events.map(formatEventForMcp) });
    }),
  );
}
