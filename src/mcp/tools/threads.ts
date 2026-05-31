import { z } from "zod";
import { getThread } from "../../api/threads.ts";
import { getClient } from "../state.ts";
import { text, wrap } from "../util.ts";
import { formatEventForMcp } from "./event-format.ts";
import type { ToolContext } from "./context.ts";

const selectorsSchema = z
  .object({
    strategy: z.enum(["first", "last", "all"]).optional(),
    k: z.number().int().positive().optional(),
  })
  .optional();

export function registerThreadTools(ctx: ToolContext): void {
  const { mcp, state } = ctx;

  mcp.registerTool(
    "bridge_get_thread",
    {
      description:
        "Read one thread by root event id. Default format=summary is cache-first and context-light. " +
        "Use format=status for counts/participants, format=events for structured selected events, or " +
        "format=transcript for a selected conversation transcript. Selectors default to {strategy:'last', k:5}; " +
        "use {strategy:'first', k:n} for opening context or {strategy:'all'} for the whole bounded thread. " +
        "Idempotency: pure read.",
      inputSchema: {
        root_event_id: z.number().int().positive(),
        format: z.enum(["summary", "status", "events", "transcript"]).optional(),
        selectors: selectorsSchema,
      },
    },
    wrap(async (args) => {
      const client = await getClient(state);
      const response = await getThread(client, {
        rootEventId: args.root_event_id,
        ...(args.format ? { format: args.format } : {}),
        ...(args.selectors ? { selectors: args.selectors } : {}),
      });
      return text({
        ...response,
        ...(response.events ? { events: response.events.map(formatEventForMcp) } : {}),
      });
    }),
  );
}
