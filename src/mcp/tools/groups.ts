import { z } from "zod";
import { createGroup, getGroupHistory, joinGroup, leaveGroup, listGroups, listMyGroups, renameInGroup, sendGroupMessage } from "../../api/groups.ts";
import { getClient, requirePeer } from "../state.ts";
import { text, wrap } from "../util.ts";
import { formatEventForMcp, formatNullableEventForMcp } from "./event-format.ts";
import type { ToolContext } from "./context.ts";

const selectorsSchema = z
  .object({
    strategy: z.enum(["first", "last", "all"]).optional(),
    k: z.number().int().positive().optional(),
  })
  .optional();

export function registerGroupTools(ctx: ToolContext): void {
  const { mcp, state } = ctx;

  mcp.registerTool(
    "bridge_create_group",
    {
      description:
        "Create a durable group by default, or ephemeral when requested. " +
        "Returns: { group: { group_id, name, durable, description, creator_peer_id, created_at } }. " +
        "Idempotency: name collisions return code=group_name_taken.",
      inputSchema: { name: z.string().min(1), ephemeral: z.boolean().optional() },
    },
    wrap(async (args) => {
      const client = await getClient(state);
      const peer = state.peer;
      return text(
        await createGroup(client, {
          name: args.name,
          ...(args.ephemeral !== undefined ? { ephemeral: args.ephemeral } : {}),
          ...(peer ? { creatorPeerId: peer.peer_id } : {}),
        }),
      );
    }),
  );

  mcp.registerTool(
    "bridge_join_group",
    {
      description:
        "Join a group; alias defaults to this agent's registered session name. " +
        "History is included by default; set fresh=true for join-group-fork behavior. " +
        "Use bridge_rename_in_group later if you need to change your alias inside the group. " +
        "Returns: { member, event, already_member?, reclaimed_from? }. " +
        "Idempotency: re-joining as the same active alias returns { event: null, already_member: true } " +
        "with no phantom group_joined event. When you claim a freed alias previously held by a different peer, " +
        "the response includes reclaimed_from: { previous_peer_id, event_id } pointing at the reclaim audit event.",
      inputSchema: { name: z.string().min(1), alias: z.string().optional(), fresh: z.boolean().optional() },
    },
    wrap(async (args) => {
      const client = await getClient(state);
      const peer = requirePeer(state);
      const response = await joinGroup(client, {
        name: args.name,
        peerId: peer.peer_id,
        ...(args.alias ? { alias: args.alias } : {}),
        ...(args.fresh !== undefined ? { fresh: args.fresh } : {}),
      });
      return text({ ...response, event: formatNullableEventForMcp(response.event) });
    }),
  );

  mcp.registerTool(
    "bridge_leave_group",
    {
      description:
        "Leave a group. " +
        "Returns: { ok, event, already_left? }. " +
        "Idempotency: leaving when not (or no longer) an active member returns { event: null, already_left: true }.",
      inputSchema: { name: z.string().min(1) },
    },
    wrap(async (args) => {
      const client = await getClient(state);
      const peer = requirePeer(state);
      const response = await leaveGroup(client, { name: args.name, peerId: peer.peer_id });
      return text({ ...response, event: formatNullableEventForMcp(response.event) });
    }),
  );

  mcp.registerTool(
    "bridge_rename_in_group",
    {
      description:
        "Rename your own alias within a group. Scoped to your registered peer (from bridge_whoami); v0 does not support renaming other members. " +
        "Returns: { member, event }. " +
        "Idempotency: renaming to your current alias is a no-op error (code=alias_unchanged is NOT thrown — the daemon errors with code=invalid_request); rename to a colliding alias errors code=alias_taken.",
      inputSchema: { name: z.string().min(1), new_alias: z.string().min(1) },
    },
    wrap(async (args) => {
      const client = await getClient(state);
      const peer = requirePeer(state);
      const response = await renameInGroup(client, {
        name: args.name,
        peerId: peer.peer_id,
        newAlias: args.new_alias,
      });
      return text({ ...response, event: formatEventForMcp(response.event) });
    }),
  );

  mcp.registerTool(
    "bridge_send_group",
    {
      description:
        "Deliver a message to a group on the synchronize bus — your words reach the group ONLY through a bridge_* tool; composing them as host-session output does NOT post them. " +
        "Send a durable message to a group by unique group name. Incoming group events carry group_name; pass that value as name. " +
        "Pass in_reply_to=<event_id> to post into a Slack-style thread; " +
        "the daemon normalizes reply-to-reply to the original thread root, so threads stay one level deep. " +
        "Use @alias tokens in the body to mention members; in the main channel only mentioned peers get push " +
        "notifications. In a thread, the root author and prior thread posters are notified along with new " +
        "mentions. Inbox delivery is unchanged — all active members get an inbox row regardless of mention " +
        "status. The event in the response carries mentions: string[] (parsed peer ids, sender excluded). " +
        "Returns: { event, warnings: [{token, reason}], delivery: { pushed_to, inbox_only } }. " +
        "Idempotency: not idempotent — every call produces a new event.",
      inputSchema: { name: z.string().min(1), message: z.string().min(1), in_reply_to: z.number().int().positive().optional() },
    },
    wrap(async (args) => {
      const client = await getClient(state);
      const peer = requirePeer(state);
      const response = await sendGroupMessage(client, {
        name: args.name,
        senderPeerId: peer.peer_id,
        message: args.message,
        ...(args.in_reply_to !== undefined ? { inReplyTo: args.in_reply_to } : {}),
      });
      return text({ ...response, event: formatEventForMcp(response.event) });
    }),
  );

  mcp.registerTool(
    "bridge_group_history",
    {
      description:
        "Read top-level group surfaces visible to this peer. Default view=flat returns main-channel items only; " +
        "thread replies are not expanded inline. Use view=threads for lightweight thread discovery rows, " +
        "or view=events with event_ids to re-read specific top-level events whose ids you already have. " +
        "If an event_id is a thread reply, the daemon returns event_is_thread_reply; use bridge_get_thread(root_event_id). " +
        "Selectors default to {strategy:'last', k:5}. " +
        "Each returned event carries a parsed mentions: string[] (sender excluded). " +
        "Returns: { view, items?/events?/threads?, next_cursor?, truncated? }. " +
        "Idempotency: pure read.",
      inputSchema: {
        name: z.string().min(1),
        view: z.enum(["flat", "threads", "events"]).optional(),
        selectors: selectorsSchema,
        event_ids: z.array(z.number().int().positive()).optional(),
        started_by_peer_id: z.string().optional(),
        started_by_session_name: z.string().optional(),
        participated_by_peer_id: z.string().optional(),
        participated_by_session_name: z.string().optional(),
        active_since: z.string().optional(),
      },
    },
    wrap(async (args) => {
      const client = await getClient(state);
      const peer = requirePeer(state);
      const history = await getGroupHistory(client, {
        name: args.name,
        peerId: peer.peer_id,
        ...(args.view ? { view: args.view } : {}),
        ...(args.selectors ? { selectors: args.selectors } : {}),
        ...(args.event_ids ? { eventIds: args.event_ids } : {}),
        ...(args.started_by_peer_id ? { startedByPeerId: args.started_by_peer_id } : {}),
        ...(args.started_by_session_name ? { startedBySessionName: args.started_by_session_name } : {}),
        ...(args.participated_by_peer_id ? { participatedByPeerId: args.participated_by_peer_id } : {}),
        ...(args.participated_by_session_name ? { participatedBySessionName: args.participated_by_session_name } : {}),
        ...(args.active_since ? { activeSince: args.active_since } : {}),
      });
      return text({
        ...history,
        ...(history.items ? { items: history.items.map(formatEventForMcp) } : {}),
        ...(history.events ? { events: history.events.map(formatEventForMcp) } : {}),
      });
    }),
  );

  mcp.registerTool(
    "bridge_list_groups",
    {
      description:
        "List groups. Default: every group visible on this daemon ({ groups: Group[] }). " +
        "With mine=true: only groups THIS agent is an active member of, each with your " +
        "alias and joined_at ({ groups: (Group & { alias, joined_at })[] }) — use this on " +
        "startup to discover which group(s) you were launched into. " +
        "Idempotency: pure read.",
      inputSchema: { mine: z.boolean().optional() },
    },
    wrap(async (args) => {
      const client = await getClient(state);
      if (args.mine) {
        const peer = requirePeer(state);
        return text(await listMyGroups(client, peer.peer_id));
      }
      return text(await listGroups(client));
    }),
  );
}
