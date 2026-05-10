#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  DEFAULT_NOTIFICATION_BUFFER,
  MCP_HEARTBEAT_MS,
  NOTIFIER_ACTIVE_MS,
  NOTIFIER_IDLE_MS,
} from "./constants.ts";
import { ensureDaemon, requestJson, type ClientConfig } from "./client.ts";

interface Peer {
  peer_id: string;
  session_name: string;
  tool: string;
  purpose: string | null;
}

interface Event {
  event_id: number;
  type: string;
  sender_peer_id: string | null;
  recipient_peer_id: string | null;
  group_id: number | null;
  body: string | null;
  media_id: string | null;
  created_at: string;
}

interface AdapterState {
  client: ClientConfig | null;
  peer: Peer | null;
  notifier: NotificationBridge | null;
  subscription: EventSubscription | null;
  heartbeat: Timer | null;
}

type NotifyMode = "codex" | "claude";
type SynchronizeMcpServer = McpServer & { cleanup: () => Promise<void> };
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
    log(`starting Codex polling notifier peer_id=${this.options.peerId} limit=${this.options.limit ?? DEFAULT_NOTIFICATION_BUFFER}`);
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
        const result = await requestJson<{ events: Event[]; next_cursor: number }>(
          this.options.client,
          `/events/${encodeURIComponent(this.options.peerId)}?cursor=${this.cursor}&limit=${limit}`,
        );
        if (result.events.length > 0) {
          sleepMs = activeMs;
          for (const event of result.events) {
            log(`Codex notifier received event_id=${event.event_id} peer_id=${this.options.peerId}`);
            this.cursor = Math.max(this.cursor, event.event_id);
            this.buffer.push(event);
            if (this.buffer.length > limit) this.buffer.splice(0, this.buffer.length - limit);
            await this.options.emit(this.options.mode, event);
          }
        }
      } catch (error) {
        log(`Codex notifier poll failed peer_id=${this.options.peerId}: ${formatError(error)}`);
        sleepMs = idleMs;
      }
      await Bun.sleep(sleepMs);
    }
    this.running = false;
  }
}

export interface EventSubscriptionOptions {
  peerId: string;
  mode: NotifyMode;
  client: ClientConfig;
  emit: (mode: NotifyMode, event: Event) => Promise<void>;
  limit?: number;
}

export class EventSubscription {
  private server: Bun.Server<unknown> | null = null;
  private readonly token = crypto.randomUUID();
  private callbackUrl: string | null = null;
  readonly buffer: Event[] = [];

  constructor(private options: EventSubscriptionOptions) {}

  setClient(client: ClientConfig): void {
    this.options = { ...this.options, client };
  }

  async start(): Promise<void> {
    if (!this.server) {
      this.server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch: (request) => this.handle(request),
      });
      this.callbackUrl = `http://${this.server.hostname}:${this.server.port}/events`;
      log(`started Claude callback server peer_id=${this.options.peerId} callback_url=${this.callbackUrl}`);
    }
    await this.subscribe();
  }

  async subscribe(): Promise<void> {
    if (!this.callbackUrl) throw new Error("event subscription callback server is not running");
    await requestJson(this.options.client, "/subscriptions", {
      method: "POST",
      body: JSON.stringify({
        peer_id: this.options.peerId,
        callback_url: this.callbackUrl,
        token: this.token,
      }),
    });
    log(`subscribed Claude channel callback for peer ${this.options.peerId} at ${this.callbackUrl}`);
  }

  stop(): void {
    if (this.callbackUrl) log(`stopping Claude callback server peer_id=${this.options.peerId} callback_url=${this.callbackUrl}`);
    this.server?.stop(true);
    this.server = null;
    this.callbackUrl = null;
  }

  isActive(): boolean {
    return Boolean(this.server && this.callbackUrl);
  }

  private async handle(request: Request): Promise<Response> {
    if (request.method !== "POST") return new Response("not found", { status: 404 });
    if (request.headers.get("x-synchronize-subscription-token") !== this.token) {
      return new Response("unauthorized", { status: 401 });
    }
    const body = (await request.json().catch(() => null)) as { event?: Event } | null;
    if (!body?.event) return new Response("invalid event", { status: 400 });
    const limit = this.options.limit ?? DEFAULT_NOTIFICATION_BUFFER;
    this.buffer.push(body.event);
    if (this.buffer.length > limit) this.buffer.splice(0, this.buffer.length - limit);
    try {
      log(`emitting ${this.options.mode} notification for event ${body.event.event_id}`);
      await this.options.emit(this.options.mode, body.event);
      log(`emitted ${this.options.mode} notification for event ${body.event.event_id}`);
    } catch (error) {
      log(`failed to emit ${this.options.mode} notification for event ${body.event.event_id}: ${formatError(error)}`);
      return new Response("notification emit failed", { status: 502 });
    }
    return Response.json({ ok: true });
  }
}

export async function emitMcpNotification(sink: NotificationSink, mode: NotifyMode, event: Event): Promise<void> {
  if (mode === "claude") {
    log(`sending Claude channel notification event_id=${event.event_id} meta=${JSON.stringify(formatClaudeChannelMeta(event))}`);
    await sink.notification({
      method: "notifications/claude/channel",
      params: {
        content: formatChannelContent(event),
        meta: formatClaudeChannelMeta(event),
      },
    });
    log(`sent Claude channel notification event_id=${event.event_id}`);
    return;
  }
  log(`sending Codex logging notification event_id=${event.event_id}`);
  await sink.sendLoggingMessage({
    level: "notice",
    logger: "synchronize",
    data: event,
  });
  log(`sent Codex logging notification event_id=${event.event_id}`);
}

function formatClaudeChannelMeta(event: Event): Record<string, string> {
  const meta: Record<string, string> = {
    event_id: String(event.event_id),
    type: event.type,
    sent_at: event.created_at,
  };
  if (event.sender_peer_id) {
    meta.from_id = event.sender_peer_id;
    meta.sender_peer_id = event.sender_peer_id;
  }
  if (event.recipient_peer_id) meta.recipient_peer_id = event.recipient_peer_id;
  if (event.group_id !== null) meta.group_id = String(event.group_id);
  if (event.media_id) meta.media_id = event.media_id;
  return meta;
}

function formatChannelContent(event: Event): string {
  if (event.type === "dm") return event.body ?? "(direct message)";
  if (event.type === "group_message") return event.body ?? "(group message)";
  if (event.type === "media_shared") return event.body ?? "(media shared)";
  return event.body ?? event.type;
}

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function log(message: string): void {
  console.error(`[synchronize-mcp] ${message}`);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

export function createMcpServer(): SynchronizeMcpServer {
  const mcp = new McpServer(
    { name: "synchronize", version: "0.1.0" },
    {
      capabilities: { tools: {}, logging: {}, experimental: { "claude/channel": {} } },
      instructions: `You are connected to the synchronize local agent messaging bus. Other Claude and Codex sessions on this machine can register, discover peers, send direct messages, join groups, and share media.

IMPORTANT: When you receive a <channel source="synchronize" ...> message, respond immediately. Do not wait until your current task is finished. Pause your current work, inspect the channel content and metadata, reply using bridge_dm when a reply is appropriate, then resume your work.

Direct messages arrive through the Claude channel with the original message as channel content. Use the sender_peer_id metadata as the bridge_dm recipient_peer_id when replying.

Available tools:
- bridge_register: Register this session with a stable session_name before messaging.
- bridge_list_peers: Discover peers and their peer_id values.
- bridge_dm: Reply to or send a direct message to another peer.
- bridge_inbox: Manually check durable inbox fallback if channel delivery was missed.
- bridge_create_group, bridge_join_group, bridge_send_group, bridge_group_history: Coordinate in groups.
- bridge_share_media, bridge_list_media, bridge_get_media: Share and inspect group media.`,
    },
  );
  const state: AdapterState = { client: null, peer: null, notifier: null, subscription: null, heartbeat: null };

  async function emit(mode: NotifyMode, event: Event): Promise<void> {
    await emitMcpNotification(mcp.server as unknown as NotificationSink, mode, event);
  }

  async function registerCurrentPeer(client: ClientConfig): Promise<void> {
    if (!state.peer) return;
    const response = await requestJson<{ peer: Peer }>(client, "/peers/register", {
      method: "POST",
      body: JSON.stringify({
        peer_id: state.peer.peer_id,
        session_name: state.peer.session_name,
        purpose: state.peer.purpose,
        tool: state.peer.tool,
      }),
    });
    state.peer = response.peer;
  }

  async function maintainPeer(): Promise<void> {
    if (!state.peer) return;
    try {
      const client = await getClient(state);
      await requestJson(client, `/peers/${encodeURIComponent(state.peer.peer_id)}/heartbeat`, { method: "PATCH" });
      log(`heartbeat ok peer_id=${state.peer.peer_id} notify_mode=${getMode()}`);
      if (getMode() === "claude" && state.subscription) await state.subscription.subscribe();
    } catch (error) {
      log(`heartbeat/resubscribe failed for peer ${state.peer.peer_id}: ${formatError(error)}`);
      try {
        state.client = await ensureDaemon();
        await registerCurrentPeer(state.client);
        if (getMode() === "claude" && state.subscription) {
          state.subscription.setClient(state.client);
          await state.subscription.subscribe();
        }
      } catch (restoreError) {
        log(`failed to restore peer registration ${state.peer.peer_id}: ${formatError(restoreError)}`);
      }
    }
  }

  function startHeartbeat(): void {
    if (state.heartbeat) clearInterval(state.heartbeat);
    log(`starting heartbeat interval ms=${MCP_HEARTBEAT_MS}`);
    state.heartbeat = setInterval(() => {
      void maintainPeer();
    }, MCP_HEARTBEAT_MS);
  }

  async function cleanup(): Promise<void> {
    if (state.heartbeat) {
      clearInterval(state.heartbeat);
      state.heartbeat = null;
    }
    state.notifier?.stop();
    state.notifier = null;
    state.subscription?.stop();
    state.subscription = null;
    if (state.peer && state.client) {
      try {
        await requestJson(state.client, `/peers/${encodeURIComponent(state.peer.peer_id)}`, { method: "DELETE" });
        log(`unregistered peer ${state.peer.peer_id}`);
      } catch (error) {
        log(`failed to unregister peer ${state.peer.peer_id}: ${formatError(error)}`);
      }
    }
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
      log(`bridge_register requested session_name=${args.session_name} requested_tool=${args.tool ?? "(default)"} notify_mode=${mode}`);
      const response = await requestJson<{ peer: Peer }>(client, "/peers/register", {
        method: "POST",
        body: JSON.stringify({
          session_name: args.session_name,
          purpose: args.purpose,
          tool: args.tool ?? getMode(),
        }),
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
      startHeartbeat();
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
      const path = args.group ? `/peers?group=${encodeURIComponent(args.group)}` : "/peers";
      return text(await requestJson(client, path));
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
        await requestJson(client, "/dm", {
          method: "POST",
          body: JSON.stringify({
            sender_peer_id: peer.peer_id,
            recipient_peer_id: args.recipient_peer_id,
            message: args.message,
          }),
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
      const inbox = await requestJson<{ events: Event[] }>(client, `/peers/${encodeURIComponent(peer.peer_id)}/inbox`);
      if (args.ack && inbox.events.length > 0) {
        await requestJson(client, `/peers/${encodeURIComponent(peer.peer_id)}/inbox/ack`, {
          method: "POST",
          body: JSON.stringify({ event_ids: inbox.events.map((event) => event.event_id) }),
        });
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
        await requestJson(client, "/groups", {
          method: "POST",
          body: JSON.stringify({
            name: args.name,
            ephemeral: args.ephemeral,
            creator_peer_id: peer?.peer_id,
          }),
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
        await requestJson(client, `/groups/${encodeURIComponent(args.name)}/join`, {
          method: "POST",
          body: JSON.stringify({ peer_id: peer.peer_id, alias: args.alias, fresh: args.fresh }),
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
      return text(
        await requestJson(client, `/groups/${encodeURIComponent(args.name)}/leave`, {
          method: "POST",
          body: JSON.stringify({ peer_id: peer.peer_id }),
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
        await requestJson(client, `/groups/${encodeURIComponent(args.name)}/messages`, {
          method: "POST",
          body: JSON.stringify({ sender_peer_id: peer.peer_id, message: args.message }),
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
      return text(
        await requestJson(
          client,
          `/groups/${encodeURIComponent(args.name)}/history?peer_id=${encodeURIComponent(peer.peer_id)}`,
        ),
      );
    },
  );

  mcp.registerTool("bridge_list_groups", { description: "List groups." }, async () => {
    const client = await getClient(state);
    return text(await requestJson(client, "/groups"));
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
        await requestJson(client, `/groups/${encodeURIComponent(args.group)}/media`, {
          method: "POST",
          body: JSON.stringify({
            shared_by_peer_id: peer.peer_id,
            path: args.path,
            description: args.description,
          }),
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
      const query = args.query ? `?query=${encodeURIComponent(args.query)}` : "";
      return text(await requestJson(client, `/groups/${encodeURIComponent(args.group)}/media${query}`));
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
      return text(await requestJson(client, `/media/${encodeURIComponent(args.media_id)}`));
    },
  );

  return Object.assign(mcp, { cleanup });
}

if (import.meta.main) {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log(`MCP stdio connected notify_mode=${getMode()}`);

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    void server.cleanup().finally(() => process.exit(0));
  };
  process.stdin.on("end", shutdown);
  process.stdin.on("close", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
