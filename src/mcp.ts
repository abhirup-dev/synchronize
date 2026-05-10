#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  DEFAULT_NOTIFICATION_BUFFER,
  NOTIFIER_ACTIVE_MS,
  NOTIFIER_IDLE_MS,
} from "./constants.ts";
import { ensureDaemon, type ClientConfig } from "./client.ts";
import {
  ackInbox,
  createGroup,
  findReusablePeer,
  getGroupHistory,
  getMedia,
  joinGroup,
  leaveGroup,
  listGroups,
  listMedia,
  listPeers,
  readEvents,
  readInbox,
  registerPeer,
  sendDm,
  sendGroupMessage,
  shareMedia,
  type Event,
  type Peer,
} from "./api.ts";

interface AdapterState {
  client: ClientConfig | null;
  peer: Peer | null;
  notifier: NotificationBridge | null;
}

type NotifyMode = "codex" | "claude";
type NotificationSink = {
  notification: (notification: unknown) => Promise<void>;
  sendLoggingMessage: (params: { level: "notice"; logger: string; data: Event }) => Promise<void>;
};

export interface NotificationBridgeOptions {
  peerId: string;
  mode: NotifyMode;
  client: ClientConfig;
  emit: (mode: NotifyMode, event: Event) => Promise<void>;
  limit?: number;
  activeMs?: number;
  idleMs?: number;
}

export class NotificationBridge {
  private cursor = 0;
  private stopped = false;
  private running = false;
  readonly buffer: Event[] = [];

  constructor(private readonly options: NotificationBridgeOptions) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  stop(): void {
    this.stopped = true;
  }

  private async loop(): Promise<void> {
    const activeMs = this.options.activeMs ?? NOTIFIER_ACTIVE_MS;
    const idleMs = this.options.idleMs ?? NOTIFIER_IDLE_MS;
    const limit = this.options.limit ?? DEFAULT_NOTIFICATION_BUFFER;

    while (!this.stopped) {
      let sleepMs = idleMs;
      try {
        const result = await readEvents(this.options.client, this.options.peerId, { cursor: this.cursor, limit });
        if (result.events.length > 0) {
          sleepMs = activeMs;
          for (const event of result.events) {
            this.cursor = Math.max(this.cursor, event.event_id);
            this.buffer.push(event);
            if (this.buffer.length > limit) this.buffer.splice(0, this.buffer.length - limit);
            await this.options.emit(this.options.mode, event);
          }
        }
      } catch {
        sleepMs = idleMs;
      }
      await Bun.sleep(sleepMs);
    }
    this.running = false;
  }
}

export async function emitMcpNotification(sink: NotificationSink, mode: NotifyMode, event: Event): Promise<void> {
  if (mode === "claude") {
    await sink.notification({
      method: "notifications/claude/channel",
      params: { channel: "synchronize", event },
    });
    return;
  }
  await sink.sendLoggingMessage({
    level: "notice",
    logger: "synchronize",
    data: event,
  });
}

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function getMode(): NotifyMode {
  return process.env.SYNCHRONIZE_MCP_MODE === "claude" ? "claude" : "codex";
}

async function getClient(state: AdapterState): Promise<ClientConfig> {
  state.client = await ensureDaemon();
  return state.client;
}

function requirePeer(state: AdapterState): Peer {
  if (!state.peer) {
    throw new Error("Register first with bridge_register; session_name is mandatory.");
  }
  return state.peer;
}

export function createMcpServer(): McpServer {
  const mcp = new McpServer(
    { name: "synchronize", version: "0.1.0" },
    { capabilities: { logging: {} } },
  );
  const state: AdapterState = { client: null, peer: null, notifier: null };

  async function emit(mode: NotifyMode, event: Event): Promise<void> {
    await emitMcpNotification(mcp.server as unknown as NotificationSink, mode, event);
  }

  mcp.registerTool(
    "bridge_register",
    {
      description: "Register this MCP agent with a mandatory session identity and start one peer-level notifier loop.",
      inputSchema: {
        session_name: z.string().min(1),
        purpose: z.string().optional(),
        tool: z.string().optional(),
      },
    },
    async (args) => {
      const client = await getClient(state);
      const tool = args.tool ?? getMode();
      const peerId = await resolveMcpRegisterPeerId(client, state, args.session_name, tool);
      const response = await registerPeer(client, {
        sessionName: args.session_name,
        tool,
        ...(peerId ? { peerId } : {}),
        ...(args.purpose ? { purpose: args.purpose } : {}),
      });
      state.peer = response.peer;
      state.notifier?.stop();
      state.notifier = new NotificationBridge({
        peerId: response.peer.peer_id,
        mode: getMode(),
        client,
        emit,
      });
      state.notifier.start();
      return text(response);
    },
  );

  mcp.registerTool("bridge_whoami", { description: "Show this adapter peer identity." }, async () => {
    return text({ peer: state.peer, registered: Boolean(state.peer) });
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

  return mcp;
}

async function resolveMcpRegisterPeerId(
  client: ClientConfig,
  state: AdapterState,
  sessionName: string,
  tool: string,
): Promise<string | undefined> {
  if (state.peer?.session_name === sessionName && state.peer.tool === tool) return state.peer.peer_id;
  return findReusablePeer(client, { sessionName, tool });
}

if (import.meta.main) {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
