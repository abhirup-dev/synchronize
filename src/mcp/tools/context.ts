import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Event } from "../../api/types.ts";
import type { LifecycleHooks } from "../lifecycle.ts";
import type { AdapterState, NotifyMode } from "../state.ts";

export interface ToolContext {
  mcp: McpServer;
  state: AdapterState;
  emit: (mode: NotifyMode, event: Event) => Promise<void>;
  lifecycle: LifecycleHooks;
}

export type RegisterTools = (ctx: ToolContext) => void;
