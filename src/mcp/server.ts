import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Event } from "../api/types.ts";
import { createLifecycleHooks, MCP_INSTRUCTIONS } from "./lifecycle.ts";
import { emitMcpNotification } from "./notifications.ts";
import {
  createAdapterState,
  type NotificationSink,
  type NotifyMode,
  type SynchronizeMcpServer,
} from "./state.ts";
import type { ToolContext } from "./tools/context.ts";
import { registerGroupTools } from "./tools/groups.ts";
import { registerLaunchTools } from "./tools/launch.ts";
import { registerMediaTools } from "./tools/media.ts";
import { registerMessagingTools } from "./tools/messaging.ts";
import { registerPeerTools } from "./tools/peers.ts";
import { registerQueryTools } from "./tools/query.ts";
import { registerRegisterTools } from "./tools/register.ts";
import { registerThreadTools } from "./tools/threads.ts";

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
    // Delivering an inbound channel event means this agent is now acting on it
    // → working. For Claude this is the only "working" signal for channel-driven
    // turns (UserPromptSubmit fires only for human prompts). Fire-and-forget so
    // it never delays delivery; markWorking swallows its own errors.
    if (mode === "claude") void lifecycle.markWorking();
    await emitMcpNotification(mcp.server as unknown as NotificationSink, mode, event);
  }

  const ctx: ToolContext = { mcp, state, emit, lifecycle };
  const { bootstrapEnvBoundPeer } = registerRegisterTools(ctx);
  registerPeerTools(ctx);
  registerMessagingTools(ctx);
  registerGroupTools(ctx);
  registerLaunchTools(ctx);
  registerMediaTools(ctx);
  registerQueryTools(ctx);
  registerThreadTools(ctx);

  // Once the client finishes initializing, proactively activate the live
  // channel subscription for launch-bound sessions (gated on launch env), so a
  // spawned idle agent receives pushed messages without a first tool call.
  // Preserves any existing handler the SDK installed.
  const priorOnInitialized = mcp.server.oninitialized;
  mcp.server.oninitialized = () => {
    priorOnInitialized?.();
    void bootstrapEnvBoundPeer();
  };

  return Object.assign(mcp, { cleanup: lifecycle.cleanup });
}
