import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Event, Peer } from "../api/types.ts";
import { ensureDaemon, type ClientConfig } from "../client.ts";
import type { NotificationBridge } from "./codex-notifier.ts";
import type { EventSubscription } from "./claude-subscription.ts";

export type NotifyMode = "codex" | "claude";

export type SynchronizeMcpServer = McpServer & { cleanup: () => Promise<void> };

export interface NotificationSink {
  notification: (notification: unknown) => Promise<void>;
  sendLoggingMessage: (params: { level: "notice"; logger: string; data: Event }) => Promise<void>;
}

export interface AdapterState {
  client: ClientConfig | null;
  peer: Peer | null;
  notifier: NotificationBridge | null;
  subscription: EventSubscription | null;
  heartbeat: Timer | null;
}

export function createAdapterState(): AdapterState {
  return { client: null, peer: null, notifier: null, subscription: null, heartbeat: null };
}

export function getMode(): NotifyMode {
  return process.env.SYNCHRONIZE_MCP_MODE === "claude" ? "claude" : "codex";
}

export async function getClient(state: AdapterState): Promise<ClientConfig> {
  state.client = await ensureDaemon();
  return state.client;
}

export function requirePeer(state: AdapterState): Peer {
  if (!state.peer) {
    throw new Error("Register first with bridge_register; session_name is mandatory.");
  }
  return state.peer;
}
