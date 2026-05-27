import { z } from "zod";
import { createGroup, getGroupHistory, joinGroup, leaveGroup, listGroups, renameInGroup, sendGroupMessage } from "../../api/groups.ts";
import { getEvent } from "../../api/events.ts";
import { ApiError } from "../../client.ts";
import { ensurePeer, getClient } from "../state.ts";
import { invalidArgument, text, wrap } from "../util.ts";
import { formatEventForMcp, formatNullableEventForMcp } from "./event-format.ts";
import type { ToolContext } from "./context.ts";

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
      const peer = await ensurePeer(state, client);
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
      const peer = await ensurePeer(state, client);
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
      const peer = await ensurePeer(state, client);
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
        "Send a durable message to a group. Pass in_reply_to=<event_id> to post into a Slack-style thread; " +
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
      const peer = await ensurePeer(state, client);
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
        "Read group history visible to this peer. Three mutually exclusive modes:\n" +
        "  (1) DEFAULT (no thread_of, no event_ids): main channel only; thread replies are HIDDEN.\n" +
        "  (2) thread_of=<root_event_id>: ONE thread; returns the root event + every reply in posting order. Main-channel siblings are HIDDEN.\n" +
        "  (3) event_ids=[<id>,...]: fetch SPECIFIC events by id, regardless of whether they live on the main channel or inside a thread. Skips the main-channel/thread split entirely. Use this to re-read events whose ids you already have (e.g., from a channel notification or an earlier history page).\n" +
        "Passing both thread_of and event_ids returns invalid_argument. " +
        "Each returned event carries a parsed mentions: string[] (sender excluded). " +
        "Returns: { events: Event[], next_cursor? }. " +
        "Idempotency: pure read.",
      inputSchema: {
        name: z.string().min(1),
        thread_of: z.number().int().positive().optional(),
        event_ids: z.array(z.number().int().positive()).optional(),
      },
    },
    wrap(async (args) => {
      const client = await getClient(state);
      const peer = await ensurePeer(state, client);
      if (args.event_ids && args.event_ids.length > 0) {
        if (args.thread_of !== undefined) {
          invalidArgument("bridge_group_history: pass either thread_of or event_ids, not both");
        }
        const events = await Promise.all(
          args.event_ids.map(async (eventId) => {
            const { event } = await getEvent(client, { eventId, peerId: peer.peer_id });
            if (event.group_id === null) {
              throw new ApiError(404, "event_not_in_group", `Event ${eventId} is not a group event`);
            }
            return formatEventForMcp(event);
          }),
        );
        return text({ events });
      }
      const history = await getGroupHistory(client, {
        name: args.name,
        peerId: peer.peer_id,
        ...(args.thread_of !== undefined ? { threadOf: args.thread_of } : {}),
      });
      return text({ ...history, events: history.events.map(formatEventForMcp) });
    }),
  );

  mcp.registerTool(
    "bridge_list_groups",
    {
      description:
        "List groups visible on this daemon. " +
        "Returns: { groups: Group[] }. " +
        "Idempotency: pure read.",
    },
    wrap(async () => {
      const client = await getClient(state);
      return text(await listGroups(client));
    }),
  );
}
