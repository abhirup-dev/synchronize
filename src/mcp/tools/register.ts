import { z } from "zod";
import { registerPeer } from "../../api/peers.ts";
import { EventSubscription } from "../claude-subscription.ts";
import { NotificationBridge } from "../codex-notifier.ts";
import { resolveMcpRegisterPeerId } from "../lifecycle.ts";
import { getClient, getMode } from "../state.ts";
import { log, text } from "../util.ts";
import type { ToolContext } from "./context.ts";

export function registerRegisterTools(ctx: ToolContext): void {
  const { mcp, state, emit, lifecycle } = ctx;

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
}
