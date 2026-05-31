import { heartbeatPeer, registerPeer, setPeerActivity } from "../api/peers.ts";
import { findReusablePeer } from "../api/status.ts";
import { ensureDaemon, type ClientConfig } from "../client.ts";
import { ENV_PEER_ID, MCP_HEARTBEAT_MS } from "../constants.ts";
import { type AdapterState, getClient, getMode } from "./state.ts";
import { formatError, log } from "./util.ts";

export const MCP_INSTRUCTIONS = `You are connected to the synchronize local agent messaging bus. Other Claude, Codex, and Pi sessions on this machine can register, discover peers, exchange direct messages, join groups, react, and share media.

IMPORTANT — attend immediately, then respond by the lightest sufficient means. When a <channel source="synchronize" ...> event arrives, read it right away rather than batching it to the end of your task; immediacy is about attention, not about emitting a message. Then choose how to respond:
- If you are directly mentioned, or the message needs something your current task can provide, collaborate: reply with bridge_reply (visible group/thread/DM events) or bridge_dm (direct). Be proactive when collaboration serves the task you have been set.
- If the event merely interrupts you or is irrelevant to your current task, feel free to ignore it or acknowledge with a single bridge_react reaction. A reaction is a complete response — no message required.
- Prioritize efficiency: never send a message where a reaction or silence carries the same information, and do not post redundant "I'm here" presence replies.

For a detailed understanding of how to work within the synchronize workspace — identity and peer_id rules, threading, group/DM/inbox semantics, reactions, and missed-delivery recovery — read the synchronize skill (invoke /synchronize, or open the skill named "synchronize"). Consult it before any non-trivial coordination.

Direct-message replies: use the sender_peer_id metadata as the bridge_dm recipient_peer_id. Visible events: reply by event_id with bridge_reply.

Available tools:
- bridge_register / bridge_rename_session: register or rename this session (preserves peer_id).
- bridge_whoami: confirm identity, runtime context, and host binding.
- bridge_list_peers: discover peers and their peer_id values.
- bridge_dm: send or reply to a direct message to another peer.
- bridge_reply: reply to a visible group/thread/DM event by event_id.
- bridge_react: attach an emoji reaction — the preferred ack / +1 / "seen", with no message body and no notification.
- bridge_inbox: manually check the durable inbox fallback if channel delivery was missed.
- bridge_create_group, bridge_join_group, bridge_send_group, bridge_group_history, bridge_get_thread: coordinate in groups and threads.
- bridge_share_media, bridge_list_media, bridge_get_media: share and inspect group media.`;

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
  markWorking: () => Promise<void>;
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
    // Heartbeat-only lifecycle: on shutdown we stop heartbeating and tear down
    // transports, but we do NOT delete the peer. Death is detected by lease
    // lapse — within SYNCHRONIZE_LEASE_MS the daemon drops the peer offline on
    // its own. Tying deletion to stdin-close/process-exit was the footgun (it
    // deleted peers out from under live processes during session rotation,
    // borrowed-peer reuse, resume/compact). DELETE /peers/:id is now an
    // operator-only tool. See plan-agent-ttl-presence-v0.md.
    if (state.heartbeat) {
      clearInterval(state.heartbeat);
      state.heartbeat = null;
    }
    state.notifier?.stop();
    state.notifier = null;
    state.subscription?.stop();
    state.subscription = null;
  }

  // Push "working" when an inbound channel event is delivered to this peer.
  // The MCP adapter is the only in-process component that sees channel delivery
  // for Claude — UserPromptSubmit fires only for human prompts, so without this
  // a synchronize-driven turn would never show as working. Best-effort: a
  // failed push must never disrupt delivery.
  async function markWorking(): Promise<void> {
    if (!state.peer) return;
    try {
      const client = await getClient(state);
      await setPeerActivity(client, { peerId: state.peer.peer_id, state: "working" });
    } catch (error) {
      log(`activity push (working) failed for peer ${state.peer.peer_id}: ${formatError(error)}`);
    }
  }

  return { registerCurrentPeer, maintainPeer, startHeartbeat, cleanup, markWorking };
}
