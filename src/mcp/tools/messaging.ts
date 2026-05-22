import { z } from "zod";
import { ackInbox, readInbox, sendDm } from "../../api/inbox.ts";
import { getClient, requirePeer } from "../state.ts";
import { text } from "../util.ts";
import type { ToolContext } from "./context.ts";

export function registerMessagingTools(ctx: ToolContext): void {
  const { mcp, state } = ctx;

  mcp.registerTool(
    "bridge_dm",
    {
      description: "Send a durable direct message to a peer. Use recipient_peer_id for the destination peer; peer_id is accepted as an alias.",
      inputSchema: { recipient_peer_id: z.string().min(1).optional(), peer_id: z.string().min(1).optional(), message: z.string().min(1) },
    },
    async (args) => {
      const recipientPeerId = args.recipient_peer_id ?? args.peer_id;
      if (!recipientPeerId) throw new Error("bridge_dm requires recipient_peer_id");
      const client = await getClient(state);
      const peer = requirePeer(state);
      return text(
        await sendDm(client, {
          senderPeerId: peer.peer_id,
          recipientPeerId,
          message: args.message,
        }),
      );
    },
  );

  mcp.registerTool(
    "bridge_inbox",
    {
      description: "Read durable inbox; optionally acknowledge returned rows.",
      inputSchema: { ack: z.boolean().optional() },
    },
    async (args) => {
      const client = await getClient(state);
      const peer = requirePeer(state);
      const inbox = await readInbox(client, peer.peer_id);
      if (args.ack && inbox.events.length > 0) {
        await ackInbox(client, peer.peer_id, inbox.events.map((event) => event.event_id));
      }
      return text(inbox);
    },
  );
}
