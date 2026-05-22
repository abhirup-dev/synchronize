import { z } from "zod";
import { createGroup, getGroupHistory, joinGroup, leaveGroup, listGroups, renameInGroup, sendGroupMessage } from "../../api/groups.ts";
import { getClient, requirePeer } from "../state.ts";
import { text } from "../util.ts";
import type { ToolContext } from "./context.ts";

export function registerGroupTools(ctx: ToolContext): void {
  const { mcp, state } = ctx;

  mcp.registerTool(
    "bridge_create_group",
    {
      description: "Create a durable group by default, or ephemeral when requested.",
      inputSchema: { name: z.string().min(1), ephemeral: z.boolean().optional() },
    },
    async (args) => {
      const client = await getClient(state);
      const peer = state.peer;
      return text(
        await createGroup(client, {
          name: args.name,
          ...(args.ephemeral !== undefined ? { ephemeral: args.ephemeral } : {}),
          ...(peer ? { creatorPeerId: peer.peer_id } : {}),
        }),
      );
    },
  );

  mcp.registerTool(
    "bridge_join_group",
    {
      description:
        "Join a group; alias defaults to this agent's registered session name. " +
        "History is included by default; set fresh=true for join-group-fork behavior. " +
        "Use bridge_rename_in_group later if you need to change your alias inside the group. " +
        "When a freed alias is claimed by a different peer (e.g. respawn), the daemon emits a group_member_alias_reclaimed event so observers can distinguish respawn from impersonation.",
      inputSchema: { name: z.string().min(1), alias: z.string().optional(), fresh: z.boolean().optional() },
    },
    async (args) => {
      const client = await getClient(state);
      const peer = requirePeer(state);
      return text(
        await joinGroup(client, {
          name: args.name,
          peerId: peer.peer_id,
          ...(args.alias ? { alias: args.alias } : {}),
          ...(args.fresh !== undefined ? { fresh: args.fresh } : {}),
        }),
      );
    },
  );

  mcp.registerTool(
    "bridge_leave_group",
    { description: "Leave a group.", inputSchema: { name: z.string().min(1) } },
    async (args) => {
      const client = await getClient(state);
      const peer = requirePeer(state);
      return text(await leaveGroup(client, { name: args.name, peerId: peer.peer_id }));
    },
  );

  mcp.registerTool(
    "bridge_rename_in_group",
    {
      description:
        "Rename your own alias within a group. Scoped to your registered peer (from bridge_whoami); v0 does not support renaming other members.",
      inputSchema: { name: z.string().min(1), new_alias: z.string().min(1) },
    },
    async (args) => {
      const client = await getClient(state);
      const peer = requirePeer(state);
      return text(
        await renameInGroup(client, {
          name: args.name,
          peerId: peer.peer_id,
          newAlias: args.new_alias,
        }),
      );
    },
  );

  mcp.registerTool(
    "bridge_send_group",
    {
      description: "Send a durable message to a group.",
      inputSchema: { name: z.string().min(1), message: z.string().min(1) },
    },
    async (args) => {
      const client = await getClient(state);
      const peer = requirePeer(state);
      return text(
        await sendGroupMessage(client, {
          name: args.name,
          senderPeerId: peer.peer_id,
          message: args.message,
        }),
      );
    },
  );

  mcp.registerTool(
    "bridge_group_history",
    { description: "Read group history visible to this peer.", inputSchema: { name: z.string().min(1) } },
    async (args) => {
      const client = await getClient(state);
      const peer = requirePeer(state);
      return text(await getGroupHistory(client, { name: args.name, peerId: peer.peer_id }));
    },
  );

  mcp.registerTool("bridge_list_groups", { description: "List groups." }, async () => {
    const client = await getClient(state);
    return text(await listGroups(client));
  });
}
