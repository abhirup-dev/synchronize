import { z } from "zod";
import { listAgentSessions, renameAgentSession } from "../../api/agent-sessions.ts";
import { registerPeer } from "../../api/peers.ts";
import type { Peer } from "../../api/types.ts";
import { EventSubscription } from "../claude-subscription.ts";
import { NotificationBridge } from "../codex-notifier.ts";
import { resolveMcpRegisterPeerId } from "../lifecycle.ts";
import { findEnvBoundPeer, getClient, getMode } from "../state.ts";
import { invalidArgument, log, text, wrap } from "../util.ts";
import type { ToolContext } from "./context.ts";

export function registerRegisterTools(ctx: ToolContext): void {
  const { mcp, state, emit, lifecycle } = ctx;

  mcp.registerTool(
    "bridge_register",
    {
      description:
        "Register this MCP agent with a mandatory session identity and start the client notification path. " +
        "Returns: { peer: { peer_id, session_name, tool, purpose, lease_expires_at } }. " +
        "Idempotency: re-registering with the same session_name and an existing peer_id (via env or host binding) " +
        "preserves peer_id; otherwise a new peer row is created. Call once per MCP process at startup.",
      inputSchema: {
        session_name: z.string().min(1),
        purpose: z.string().optional(),
        tool: z.string().optional(),
        host_tool: z.string().optional(),
        host_session_id: z.string().optional(),
      },
    },
    wrap(async (args) => {
      const client = await getClient(state);
      const mode = getMode();
      const requestedTool = args.tool ?? mode;
      const boundPeerId =
        args.host_tool && args.host_session_id
          ? (await renameAgentSession(client, {
              hostTool: args.host_tool,
              hostSessionId: args.host_session_id,
              sessionName: args.session_name,
            })).binding.peer_id
          : undefined;
      const envBoundPeer = await findEnvBoundPeer(client);
      const peerId = boundPeerId ?? envBoundPeer?.peer_id ?? (await resolveMcpRegisterPeerId(client, state, args.session_name, requestedTool));
      const existingBindings = peerId ? (await listAgentSessions(client, { peerId })).bindings : [];
      const inferredTool = existingBindings.find((binding) => binding.host_tool === "pi")?.host_tool;
      const tool = args.tool ?? inferredTool ?? mode;
      log(`bridge_register requested session_name=${args.session_name} requested_tool=${args.tool ?? "(default)"} stored_tool=${tool} notify_mode=${mode}`);
      const response = await registerPeer(client, {
        sessionName: args.session_name,
        tool,
        ...(peerId ? { peerId } : {}),
        ...(args.purpose ? { purpose: args.purpose } : {}),
      });
      state.peer = response.peer;
      log(`bridge_register completed peer_id=${response.peer.peer_id} stored_tool=${response.peer.tool} notify_mode=${mode}`);
      await activatePeer(response.peer, client);
      lifecycle.startHeartbeat();
      return text(response);
    }),
  );

  mcp.registerTool(
    "bridge_whoami",
    {
      description:
        "Show this adapter peer identity. " +
        "Returns: { peer, registered, agent_sessions, notify_mode, claude_channel_subscription_active, codex_notifier_active, heartbeat_active }. " +
        "Idempotency: pure read.",
    },
    wrap(async () => {
    const client = state.peer ? await getClient(state) : await getClient(state).catch(() => null);
    if (client && !state.peer) {
      const envBoundPeer = await findEnvBoundPeer(client);
      if (envBoundPeer) {
        await activatePeer(envBoundPeer, client);
        lifecycle.startHeartbeat();
      }
    }
    const agentSessions = client && state.peer ? (await listAgentSessions(client, { peerId: state.peer.peer_id })).bindings : [];
    return text({
      peer: state.peer,
      registered: Boolean(state.peer),
      agent_sessions: agentSessions,
      notify_mode: getMode(),
      claude_channel_subscription_active: state.subscription?.isActive() ?? false,
      codex_notifier_active: Boolean(state.notifier),
      heartbeat_active: Boolean(state.heartbeat),
    });
  }),
  );

  async function activatePeer(peer: Peer, client: Awaited<ReturnType<typeof getClient>>): Promise<void> {
    state.peer = peer;
    const mode = getMode();
    state.notifier?.stop();
    state.notifier = null;
    state.subscription?.stop();
    state.subscription = null;
    if (mode === "claude") {
      state.subscription = new EventSubscription({
        peerId: peer.peer_id,
        mode,
        client,
        emit,
      });
      await state.subscription.start();
      log(`Claude channel subscription active peer_id=${peer.peer_id}`);
    } else {
      state.notifier = new NotificationBridge({
        peerId: peer.peer_id,
        mode,
        client,
        emit,
      });
      state.notifier.start();
      log(`Codex polling notifier active peer_id=${peer.peer_id}`);
    }
  }

  mcp.registerTool(
    "bridge_rename_session",
    {
      description:
        "Rename this synchronize peer's session_name while preserving peer_id and native host session binding. " +
        "Returns: { binding: AgentSessionBinding } (binding.peer carries the renamed peer). " +
        "Idempotency: renaming to the current session_name is a successful no-op.",
      inputSchema: {
        session_name: z.string().min(1),
        peer_id: z.string().optional(),
        host_tool: z.string().optional(),
        host_session_id: z.string().optional(),
      },
    },
    wrap(async (args) => {
      const client = await getClient(state);
      const response = args.peer_id
        ? await renameAgentSession(client, { peerId: args.peer_id, sessionName: args.session_name })
        : args.host_tool && args.host_session_id
          ? await renameAgentSession(client, {
              hostTool: args.host_tool,
              hostSessionId: args.host_session_id,
              sessionName: args.session_name,
            })
          : state.peer
            ? await renameAgentSession(client, { peerId: state.peer.peer_id, sessionName: args.session_name })
            : null;
      if (!response) invalidArgument("bridge_rename_session requires a registered peer, peer_id, or host session id");
      if (state.peer?.peer_id === response.binding.peer_id) state.peer = response.binding.peer;
      return text(response);
    }),
  );
}
