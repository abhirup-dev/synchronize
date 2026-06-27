import { z } from "zod";
import { listPeers, setPeerWorkState } from "../../api/peers.ts";
import { WORK_PHASES } from "../../constants.ts";
import { getClient } from "../state.ts";
import { invalidArgument, text, wrap } from "../util.ts";
import type { ToolContext } from "./context.ts";

const WORK_SCOPE_KINDS = ["group", "dm", "issue", "file", "repo", "branch", "url", "custom"] as const;

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
        "{ peer_id, alias, active, joined_at, left_at, session_name, tool, online, host_session_id, history_from_event_id, work_state, work_state_status }. " +
        "Returns (no group): { peers: Peer[] } with { peer_id, session_name, tool, purpose, lease_expires_at, online, work_state, work_state_status }. " +
        "Idempotency: pure read.",
      inputSchema: { group: z.string().optional() },
    },
    wrap(async (args) => {
      const client = await getClient(state);
      return text(await listPeers(client, args.group ? { group: args.group } : {}));
    }),
  );

  mcp.registerTool(
    "bridge_set_work_state",
    {
      description:
        "Set, renew, or clear this agent's semantic work state. " +
        "Use this when entering a materially different phase such as research, analysis, planning, implementation, testing, review, coordination, blocked, or other. " +
        "If `peer_id` is omitted, the tool uses this MCP adapter's registered peer. " +
        "For tracked work, put the Beads issue or objective label in `task`; `scope` describes where the work is happening. " +
        "Use `clear: true` to clear the current work state; there is intentionally no separate bridge_clear_work_state tool. " +
        "Returns { peer, work_state, ttl_minutes, expires_at }. Idempotency: repeating the same state renews TTL without adding duplicate history.",
      inputSchema: {
        peer_id: z.string().optional(),
        host_tool: z.string().optional(),
        host_session_id: z.string().optional(),
        clear: z.boolean().optional(),
        phase: z.enum(WORK_PHASES).optional(),
        summary: z.string().min(1).max(500).optional(),
        scope: z.object({
          kind: z.enum(WORK_SCOPE_KINDS),
          value: z.string().min(1).max(500),
          label: z.string().min(1).max(200).optional(),
        }).optional(),
        task: z.string().min(1).max(240).optional(),
        trigger_event_id: z.number().int().positive().optional(),
        ttl_minutes: z.number().int().positive().optional(),
      },
    },
    wrap(async (args) => {
      const client = await getClient(state);
      const identity =
        args.peer_id
          ? { peerId: args.peer_id }
          : args.host_tool && args.host_session_id
          ? { hostTool: args.host_tool, hostSessionId: args.host_session_id }
          : state.peer
          ? { peerId: state.peer.peer_id }
          : null;
      if (!identity) {
        invalidArgument("bridge_set_work_state requires bridge_register first, or peer_id, or host_tool+host_session_id");
      }
      if (args.clear === true) {
        const request = "peerId" in identity
          ? {
              peerId: identity.peerId,
              clear: true as const,
              source: "mcp" as const,
              ...(args.trigger_event_id !== undefined ? { triggerEventId: args.trigger_event_id } : {}),
            }
          : {
              hostTool: identity.hostTool,
              hostSessionId: identity.hostSessionId,
              clear: true as const,
              source: "mcp" as const,
              ...(args.trigger_event_id !== undefined ? { triggerEventId: args.trigger_event_id } : {}),
            };
        return text(await setPeerWorkState(client, request));
      }
      if (args.clear !== undefined) {
        invalidArgument("clear must be true when provided");
      }
      if (!args.phase) invalidArgument("phase is required unless clear is true");
      if (!args.summary) invalidArgument("summary is required unless clear is true");
      const scope = args.scope
        ? { kind: args.scope.kind, value: args.scope.value, ...(args.scope.label ? { label: args.scope.label } : {}) }
        : undefined;
      const request = "peerId" in identity
        ? {
            peerId: identity.peerId,
            phase: args.phase,
            summary: args.summary,
            source: "mcp" as const,
            ...(scope ? { scope } : {}),
            ...(args.task !== undefined ? { task: args.task } : {}),
            ...(args.trigger_event_id !== undefined ? { triggerEventId: args.trigger_event_id } : {}),
            ...(args.ttl_minutes !== undefined ? { ttlMinutes: args.ttl_minutes } : {}),
          }
        : {
            hostTool: identity.hostTool,
            hostSessionId: identity.hostSessionId,
            phase: args.phase,
            summary: args.summary,
            source: "mcp" as const,
            ...(scope ? { scope } : {}),
            ...(args.task !== undefined ? { task: args.task } : {}),
            ...(args.trigger_event_id !== undefined ? { triggerEventId: args.trigger_event_id } : {}),
            ...(args.ttl_minutes !== undefined ? { ttlMinutes: args.ttl_minutes } : {}),
          };
      return text(await setPeerWorkState(client, request));
    }),
  );
}
