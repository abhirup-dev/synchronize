#!/usr/bin/env bun
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./mcp/server.ts";
import { getMode } from "./mcp/state.ts";
import { log } from "./mcp/util.ts";

export { createMcpServer } from "./mcp/server.ts";
export { NotificationBridge } from "./mcp/codex-notifier.ts";
export { EventSubscription } from "./mcp/claude-subscription.ts";
export { emitMcpNotification } from "./mcp/notifications.ts";

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
