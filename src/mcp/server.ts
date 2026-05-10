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
import { registerMediaTools } from "./tools/media.ts";
import { registerMessagingTools } from "./tools/messaging.ts";
import { registerPeerTools } from "./tools/peers.ts";
import { registerRegisterTools } from "./tools/register.ts";

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

  const ctx: ToolContext = { mcp, state, emit, lifecycle };
  registerRegisterTools(ctx);
  registerPeerTools(ctx);
  registerMessagingTools(ctx);
  registerGroupTools(ctx);
  registerMediaTools(ctx);

  return Object.assign(mcp, { cleanup: lifecycle.cleanup });
}
