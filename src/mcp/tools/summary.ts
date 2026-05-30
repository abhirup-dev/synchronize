import { z } from "zod";
import { getThreadSummary, postThreadSummary } from "../../api/threads.ts";
import { getClient } from "../state.ts";
import { text, wrap } from "../util.ts";
import type { ToolContext } from "./context.ts";

export function registerSummaryTools(ctx: ToolContext): void {
  const { mcp, state } = ctx;

  mcp.registerTool(
    "bridge_get_thread_summary",
    {
      description:
        "Read a cached LLM-generated summary of a thread, or force regen when force=true. " +
        "Summaries are computed for cold threads (no activity in ~30 min) by the daemon worker; " +
        "use force=true to bypass the cold-gate and recompute now. " +
        'Response includes a status field: "ready" (summary present), "pending" (enabled but not yet computed), ' +
        '"disabled" (no LLM provider configured). The stale flag indicates whether new events have landed since the cache was written.',
      inputSchema: {
        root_event_id: z.number().int().positive(),
        force: z.boolean().optional(),
        strategy: z.enum(["all", "first_k", "last_k", "first_last"]).optional(),
        k: z.number().int().positive().optional(),
        first_k: z.number().int().positive().optional(),
        last_k: z.number().int().positive().optional(),
      },
    },
    wrap(async (args) => {
      const client = await getClient(state);
      if (args.force) {
        return text(
          await postThreadSummary(client, {
            rootEventId: args.root_event_id,
            ...(args.strategy ? { strategy: args.strategy } : {}),
            ...(args.k !== undefined ? { k: args.k } : {}),
            ...(args.first_k !== undefined ? { first_k: args.first_k } : {}),
            ...(args.last_k !== undefined ? { last_k: args.last_k } : {}),
          }),
        );
      }
      return text(await getThreadSummary(client, args.root_event_id));
    }),
  );
}
