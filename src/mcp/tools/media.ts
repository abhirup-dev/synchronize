import { z } from "zod";
import { getMedia, listMedia, shareMedia } from "../../api/media.ts";
import { getClient, requirePeer } from "../state.ts";
import { text, wrap } from "../util.ts";
import type { ToolContext } from "./context.ts";

export function registerMediaTools(ctx: ToolContext): void {
  const { mcp, state } = ctx;

  mcp.registerTool(
    "bridge_share_media",
    {
      description:
        "Copy a file into a group MediaStore and notify group members. " +
        "Returns: { media: MediaItem, event } with media.copied_path pointing at the daemon-managed copy. " +
        "Idempotency: not idempotent — every call copies + emits a fresh media_shared event.",
      inputSchema: {
        group: z.string().min(1),
        path: z.string().min(1),
        description: z.string().optional(),
      },
    },
    wrap(async (args) => {
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
    }),
  );

  mcp.registerTool(
    "bridge_list_media",
    {
      description:
        "List group MediaStore entries, optionally filtered by metadata query. " +
        "Returns: { media: MediaItem[] }. " +
        "Idempotency: pure read.",
      inputSchema: { group: z.string().min(1), query: z.string().optional() },
    },
    wrap(async (args) => {
      const client = await getClient(state);
      return text(await listMedia(client, { group: args.group, ...(args.query ? { query: args.query } : {}) }));
    }),
  );

  mcp.registerTool(
    "bridge_get_media",
    {
      description:
        "Get MediaStore metadata by media id, including copied filesystem path. " +
        "Returns: { media: MediaItem }. " +
        "Idempotency: pure read.",
      inputSchema: { media_id: z.string().min(1) },
    },
    wrap(async (args) => {
      const client = await getClient(state);
      return text(await getMedia(client, args.media_id));
    }),
  );
}
