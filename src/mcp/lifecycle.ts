import { deletePeer, heartbeatPeer, registerPeer } from "../api/peers.ts";
import { findReusablePeer } from "../api/status.ts";
import { ensureDaemon, type ClientConfig } from "../client.ts";
import { ENV_PEER_ID, MCP_HEARTBEAT_MS } from "../constants.ts";
import { type AdapterState, getClient, getMode } from "./state.ts";
import { formatError, log } from "./util.ts";

export const MCP_INSTRUCTIONS = `You are connected to the synchronize local agent messaging bus. Other Claude and Codex sessions on this machine can register, discover peers, send direct messages, join groups, and share media.

IMPORTANT: When you receive a <channel source="synchronize" ...> message, respond immediately. Do not wait until your current task is finished. Pause your current work, inspect the channel content and metadata, reply using bridge_dm when a reply is appropriate, then resume your work.

Direct messages arrive through the Claude channel with the original message as channel content. Use the sender_peer_id metadata as the bridge_dm recipient_peer_id when replying.

Available tools:
- bridge_register: Register this session with a stable session_name before messaging.
- bridge_rename_session: Rename this session's visible alias while preserving its peer_id.
- bridge_list_peers: Discover peers and their peer_id values.
- bridge_dm: Reply to or send a direct message to another peer.
- bridge_inbox: Manually check durable inbox fallback if channel delivery was missed.
- bridge_create_group, bridge_join_group, bridge_send_group, bridge_group_history: Coordinate in groups.
- bridge_share_media, bridge_list_media, bridge_get_media: Share and inspect group media.`;

export async function resolveMcpRegisterPeerId(
  client: ClientConfig,
  state: AdapterState,
  sessionName: string,
  tool: string,
): Promise<string | undefined> {
  const envPeerId = process.env[ENV_PEER_ID];
  if (envPeerId) return envPeerId;
  if (state.peer?.session_name === sessionName && state.peer.tool === tool) return state.peer.peer_id;
  if (tool === "claude" || tool === "pi") return undefined;
  return findReusablePeer(client, { sessionName, tool });
}

export interface LifecycleHooks {
  registerCurrentPeer: (client: ClientConfig) => Promise<void>;
  maintainPeer: () => Promise<void>;
  startHeartbeat: () => void;
  cleanup: () => Promise<void>;
}

export function createLifecycleHooks(state: AdapterState): LifecycleHooks {
  async function registerCurrentPeer(client: ClientConfig): Promise<void> {
    if (!state.peer) return;
    const response = await registerPeer(client, {
      peerId: state.peer.peer_id,
      sessionName: state.peer.session_name,
      tool: state.peer.tool,
      ...(state.peer.purpose ? { purpose: state.peer.purpose } : {}),
    });
    state.peer = response.peer;
  }

  async function maintainPeer(): Promise<void> {
    if (!state.peer) return;
    try {
      const client = await getClient(state);
      await heartbeatPeer(client, state.peer.peer_id);
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
        await deletePeer(state.client, state.peer.peer_id);
        log(`unregistered peer ${state.peer.peer_id}`);
      } catch (error) {
        log(`failed to unregister peer ${state.peer.peer_id}: ${formatError(error)}`);
      }
    }
  }

  return { registerCurrentPeer, maintainPeer, startHeartbeat, cleanup };
}
