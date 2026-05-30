import { z } from "zod";
import { getThread, getThreadStatus, listThreads } from "../../api/threads.ts";
import { getClient } from "../state.ts";
import { text, wrap } from "../util.ts";
import { formatEventForMcp } from "./event-format.ts";
import type { ToolContext } from "./context.ts";

export function registerThreadTools(ctx: ToolContext): void {
  const { mcp, state } = ctx;

  mcp.registerTool(
    "bridge_list_threads",
    {
      description:
        "Discover deeper group conversations. A discoverable thread is a root group message with at least one reply; " +
        "standalone root messages are ordinary events and can be inspected with bridge_query_events. " +
        "Returns lightweight thread rows ordered by latest activity. Idempotency: pure read.",
      inputSchema: {
        group: z.string().optional(),
        started_by_peer_id: z.string().optional(),
        started_by_session_name: z.string().optional(),
        participated_by_peer_id: z.string().optional(),
        participated_by_session_name: z.string().optional(),
        active_since: z.string().optional(),
        limit: z.number().int().positive().optional(),
      },
    },
    wrap(async (args) => {
      const client = await getClient(state);
      return text(
        await listThreads(client, {
          ...(args.group ? { group: args.group } : {}),
          ...(args.started_by_peer_id ? { startedByPeerId: args.started_by_peer_id } : {}),
          ...(args.started_by_session_name ? { startedBySessionName: args.started_by_session_name } : {}),
          ...(args.participated_by_peer_id ? { participatedByPeerId: args.participated_by_peer_id } : {}),
          ...(args.participated_by_session_name ? { participatedBySessionName: args.participated_by_session_name } : {}),
          ...(args.active_since ? { activeSince: args.active_since } : {}),
          ...(args.limit !== undefined ? { limit: args.limit } : {}),
        }),
      );
    }),
  );

  mcp.registerTool(
    "bridge_get_thread_status",
    {
      description:
        "Return derived activity/statistics for a thread root: last activity, reply/event counts, and participant activity. " +
        "This is not a workflow state such as open/resolved/blocked. Idempotency: pure read.",
      inputSchema: { root_event_id: z.number().int().positive() },
    },
    wrap(async (args) => {
      const client = await getClient(state);
      return text(await getThreadStatus(client, args.root_event_id));
    }),
  );

  mcp.registerTool(
    "bridge_get_thread",
    {
      description:
        "Read a full thread by root event id. Use format=transcript to quickly understand the conversation; " +
        "use format=json for structured events and status. Idempotency: pure read.",
      inputSchema: { root_event_id: z.number().int().positive(), format: z.enum(["json", "transcript"]).optional() },
    },
    wrap(async (args) => {
      const client = await getClient(state);
      const response = await getThread(client, { rootEventId: args.root_event_id, ...(args.format ? { format: args.format } : {}) });
      return text({
        ...response,
        events: response.events.map(formatEventForMcp),
      });
    }),
  );
}
