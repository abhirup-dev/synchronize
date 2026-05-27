import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listAgentSessions } from "../api/agent-sessions.ts";
import type { Event, Peer } from "../api/types.ts";
import { ensureDaemon, type ClientConfig } from "../client.ts";
import { ENV_LAUNCH_ID, ENV_PEER_ID } from "../constants.ts";
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

export async function findEnvBoundPeer(client: ClientConfig): Promise<Peer | null> {
  // `SYNCHRONIZE_LAUNCH_ID` is a short-lived process correlation key, not an
  // identity. The launcher, host hooks, and MCP process inherit the same value;
  // the hook stores it on the daemon binding so any MCP tool can attach to the
  // peer that was registered before this adapter had in-memory state.
  const launchId = process.env[ENV_LAUNCH_ID];
  if (launchId) {
    const binding = (await listAgentSessions(client, { launchId })).bindings.at(0);
    if (binding) return binding.peer;
  }
  const peerId = process.env[ENV_PEER_ID];
  if (peerId) {
    const binding = (await listAgentSessions(client, { peerId })).bindings.at(0);
    if (binding) return binding.peer;
  }
  return null;
}

export async function ensurePeer(state: AdapterState, client?: ClientConfig): Promise<Peer> {
  if (state.peer) return state.peer;
  const resolvedClient = client ?? (await getClient(state));
  const envBoundPeer = await findEnvBoundPeer(resolvedClient);
  if (envBoundPeer) {
    state.peer = envBoundPeer;
    return envBoundPeer;
  }
  return requirePeer(state);
}
