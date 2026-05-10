import { z } from "zod";
import { getMedia, listMedia, shareMedia } from "../../api/media.ts";
import { getClient, requirePeer } from "../state.ts";
import { text } from "../util.ts";
import type { ToolContext } from "./context.ts";

export function registerMediaTools(ctx: ToolContext): void {
  const { mcp, state } = ctx;

  mcp.registerTool(
    "bridge_share_media",
    {
      description: "Copy a file into a group MediaStore and notify group members.",
      inputSchema: {
        group: z.string().min(1),
        path: z.string().min(1),
        description: z.string().optional(),
      },
    },
    async (args) => {
      const client = await getClient(state);
      const peer = requirePeer(state);
      return text(
        await shareMedia(client, {
          group: args.group,
          sharedByPeerId: peer.peer_id,
          path: args.path,
          ...(args.description ? { description: args.description } : {}),
        }),
      );
    },
  );

  mcp.registerTool(
    "bridge_list_media",
    {
      description: "List group MediaStore entries, optionally filtered by metadata query.",
      inputSchema: { group: z.string().min(1), query: z.string().optional() },
    },
    async (args) => {
      const client = await getClient(state);
      return text(await listMedia(client, { group: args.group, ...(args.query ? { query: args.query } : {}) }));
    },
  );

  mcp.registerTool(
    "bridge_get_media",
    {
      description: "Get MediaStore metadata by media id, including copied filesystem path.",
      inputSchema: { media_id: z.string().min(1) },
    },
    async (args) => {
      const client = await getClient(state);
      return text(await getMedia(client, args.media_id));
    },
  );
}
