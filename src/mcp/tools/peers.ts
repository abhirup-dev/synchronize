import { z } from "zod";
import { listPeers } from "../../api/peers.ts";
import { getClient } from "../state.ts";
import { text, wrap } from "../util.ts";
import type { ToolContext } from "./context.ts";

export function registerPeerTools(ctx: ToolContext): void {
  const { mcp, state } = ctx;

  mcp.registerTool(
    "bridge_list_peers",
    {
      description:
        "List peers; with `group` set, returns that group's member roster. " +
        "Group-scoped responses are the right call for: figuring out who is in a room before sending, " +
        "checking who's online, mapping aliases to peer_ids for DM, or auditing who joined when. " +
        "Without `group`, returns the daemon-wide peer roster (every registered session, online or not). " +
        "Returns (group set): { peers: GroupMember[] } where each entry includes " +
        "{ peer_id, alias, active, joined_at, left_at, session_name, tool, online, host_session_id, history_from_event_id }. " +
        "Returns (no group): { peers: Peer[] } with { peer_id, session_name, tool, purpose, lease_expires_at, online }. " +
        "Idempotency: pure read.",
      inputSchema: { group: z.string().optional() },
    },
    wrap(async (args) => {
      const client = await getClient(state);
      return text(await listPeers(client, args.group ? { group: args.group } : {}));
    }),
  );
}
