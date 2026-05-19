import { z } from "zod";
import { listPeers } from "../../api/peers.ts";
import { getClient } from "../state.ts";
import { text } from "../util.ts";
import type { ToolContext } from "./context.ts";

export function registerPeerTools(ctx: ToolContext): void {
  const { mcp, state } = ctx;

  mcp.registerTool(
    "bridge_list_peers",
    {
      description: "List peers, optionally scoped to a group.",
      inputSchema: { group: z.string().optional() },
    },
    async (args) => {
      const client = await getClient(state);
      return text(await listPeers(client, args.group ? { group: args.group } : {}));
    },
  );
}
