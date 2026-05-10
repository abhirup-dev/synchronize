import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ackInbox, readInbox, sendDm } from "../api/inbox.ts";
import { createGroup, getGroupHistory, joinGroup, leaveGroup, listGroups, sendGroupMessage } from "../api/groups.ts";
import { getMedia, listMedia, shareMedia } from "../api/media.ts";
import { listPeers, registerPeer } from "../api/peers.ts";
import type { Event } from "../api/types.ts";
import { EventSubscription } from "./claude-subscription.ts";
import { NotificationBridge } from "./codex-notifier.ts";
import { createLifecycleHooks, MCP_INSTRUCTIONS, resolveMcpRegisterPeerId } from "./lifecycle.ts";
import { emitMcpNotification } from "./notifications.ts";
import {
  createAdapterState,
  getClient,
  getMode,
  type NotificationSink,
  type NotifyMode,
  requirePeer,
  type SynchronizeMcpServer,
} from "./state.ts";
import { log, text } from "./util.ts";

export function createMcpServer(): SynchronizeMcpServer {
  const mcp = new McpServer(
    { name: "synchronize", version: "0.1.0" },
    {
      capabilities: { tools: {}, logging: {}, experimental: { "claude/channel": {} } },
      instructions: MCP_INSTRUCTIONS,
    },
  );
  const state = createAdapterState();
  const lifecycle = createLifecycleHooks(state);

  async function emit(mode: NotifyMode, event: Event): Promise<void> {
    await emitMcpNotification(mcp.server as unknown as NotificationSink, mode, event);
  }

  mcp.registerTool(
    "bridge_register",
    {
      description: "Register this MCP agent with a mandatory session identity and start the client notification path.",
      inputSchema: {
        session_name: z.string().min(1),
        purpose: z.string().optional(),
        tool: z.string().optional(),
      },
    },
    async (args) => {
      const client = await getClient(state);
      const mode = getMode();
      const tool = args.tool ?? mode;
      log(`bridge_register requested session_name=${args.session_name} requested_tool=${args.tool ?? "(default)"} notify_mode=${mode}`);
      const peerId = await resolveMcpRegisterPeerId(client, state, args.session_name, tool);
      const response = await registerPeer(client, {
        sessionName: args.session_name,
        tool,
        ...(peerId ? { peerId } : {}),
        ...(args.purpose ? { purpose: args.purpose } : {}),
      });
      state.peer = response.peer;
      log(`bridge_register completed peer_id=${response.peer.peer_id} stored_tool=${response.peer.tool} notify_mode=${mode}`);
      state.notifier?.stop();
      state.notifier = null;
      state.subscription?.stop();
      state.subscription = null;
      if (mode === "claude") {
        state.subscription = new EventSubscription({
          peerId: response.peer.peer_id,
          mode,
          client,
          emit,
        });
        await state.subscription.start();
        log(`Claude channel subscription active peer_id=${response.peer.peer_id}`);
      } else {
        state.notifier = new NotificationBridge({
          peerId: response.peer.peer_id,
          mode,
          client,
          emit,
        });
        state.notifier.start();
        log(`Codex polling notifier active peer_id=${response.peer.peer_id}`);
      }
      lifecycle.startHeartbeat();
      return text(response);
    },
  );

  mcp.registerTool("bridge_whoami", { description: "Show this adapter peer identity." }, async () => {
    return text({
      peer: state.peer,
      registered: Boolean(state.peer),
      notify_mode: getMode(),
      claude_channel_subscription_active: state.subscription?.isActive() ?? false,
      codex_notifier_active: Boolean(state.notifier),
      heartbeat_active: Boolean(state.heartbeat),
    });
  });

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

  mcp.registerTool(
    "bridge_dm",
    {
      description: "Send a durable direct message to a peer.",
      inputSchema: { recipient_peer_id: z.string().min(1), message: z.string().min(1) },
    },
    async (args) => {
      const client = await getClient(state);
      const peer = requirePeer(state);
      return text(
        await sendDm(client, {
          senderPeerId: peer.peer_id,
          recipientPeerId: args.recipient_peer_id,
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
      description: "Join a group; alias defaults to this agent's registered session name, history is included by default, set fresh for join-group-fork behavior.",
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

  return Object.assign(mcp, { cleanup: lifecycle.cleanup });
}
