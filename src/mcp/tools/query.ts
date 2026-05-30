import { z } from "zod";
import { queryEvents } from "../../api/query.ts";
import { getClient } from "../state.ts";
import { text, wrap } from "../util.ts";
import type { ToolContext } from "./context.ts";

export function registerQueryTools(ctx: ToolContext): void {
  const { mcp, state } = ctx;

  mcp.registerTool(
    "bridge_query_events",
    {
      description:
        "Run guarded read-only SQL against daemon event state. " +
        "Use for deep ad hoc inspection; prefer dedicated thread tools for common thread workflows. " +
        "Allowed SQL: SELECT and WITH queries only. Useful views: event_log, thread_events, discoverable_threads. " +
        "Returns: { columns, rows, row_count, truncated, elapsed_ms }. Idempotency: pure read.",
      inputSchema: {
        sql: z.string().min(1),
        params: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
        limit: z.number().int().positive().optional(),
      },
    },
    wrap(async (args) => {
      const client = await getClient(state);
      return text(
        await queryEvents(client, {
          sql: args.sql,
          ...(args.params ? { params: args.params } : {}),
          ...(args.limit !== undefined ? { limit: args.limit } : {}),
        }),
      );
    }),
  );
}
