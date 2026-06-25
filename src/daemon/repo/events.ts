import { Database } from "bun:sqlite";

import type { ReactionSummary } from "../../api/types.ts";
import { HttpError } from "../../http.ts";
import { type ReactionOp } from "../validation.ts";
import { ensurePeer } from "./peers.ts";

export interface EventRow {
  event_id: number;
  type: string;
  sender_peer_id: string | null;
  recipient_peer_id: string | null;
  group_id: number | null;
  group_name: string | null;
  body: string | null;
  media_id: string | null;
  parent_event_id: number | null;
  reply_to_event_id: number | null;
  mentions_json: string | null;
  skill_directives_json: string | null;
  created_at: string;
  reactions?: ReactionSummary[];
}

interface ReactionRow {
  event_id: number;
  emoji: string;
  peer_id: string;
  session_name: string;
  tool: string;
  alias: string | null;
  created_at: string;
}

export function getEvent(db: Database, eventId: number): EventRow {
  const event = db
    .query<EventRow, [number]>(
      `SELECT e.*, g.name AS group_name
       FROM events e
       LEFT JOIN groups g ON g.group_id = e.group_id
       WHERE e.event_id = ?`,
    )
    .get(eventId);
  if (!event) throw new HttpError(404, "event_not_found", `Event not found: ${eventId}`);
  return attachReactions(db, [event])[0]!;
}

export function getVisibleEvent(db: Database, eventId: number, peerId: string): EventRow {
  ensurePeer(db, peerId);
  const event = getEvent(db, eventId);
  if (event.group_id !== null) {
    // Group event: caller must be (or have been) a member of that group.
    // Match the history endpoint's visibility model: history_from_event_id
    // cuts off events the joiner shouldn't see.
    const member = db
      .query<{ history_from_event_id: number | null }, [number, string]>(
        "SELECT history_from_event_id FROM group_members WHERE group_id = ? AND peer_id = ?",
      )
      .get(event.group_id, peerId);
    if (!member) throw new HttpError(404, "event_not_found", `Event ${eventId} is not visible to peer ${peerId}`);
    if (event.event_id < (member.history_from_event_id ?? 0)) {
      throw new HttpError(404, "event_not_found", `Event ${eventId} is before peer's history_from boundary`);
    }
  } else if (event.recipient_peer_id !== null) {
    // DM: caller must be sender or recipient.
    if (event.sender_peer_id !== peerId && event.recipient_peer_id !== peerId) {
      throw new HttpError(404, "event_not_found", `Event ${eventId} is not visible to peer ${peerId}`);
    }
  }
  return event;
}

export type WebDeepLinkSurface = "dm" | "group-main" | "group-thread";

export interface WebDeepLinkTarget {
  event_id: number;
  room_id: string; // group:<group_id> or dm:<other_peer_id>
  surface: WebDeepLinkSurface;
  group_id: number | null;
  parent_event_id: number | null;
  focus_event_id: number;
}

// Resolve a single event id into the web surface that should open to show it.
// Visibility is enforced through getVisibleEvent (group membership / DM
// participation), so the web peer can only resolve links it is allowed to see.
// For a thread reply we also return the thread root so the pane can render its
// parent even when the root falls outside the hydration window — but only if the
// peer can see the root too (a reply after a joiner's history boundary may have a
// root before it).
export function resolveWebDeepLink(
  db: Database,
  eventId: number,
  peerId: string,
): { target: WebDeepLinkTarget; event: EventRow; root_event: EventRow | null } {
  const event = getVisibleEvent(db, eventId, peerId);
  if (event.group_id !== null) {
    const isReply = event.parent_event_id !== null;
    const target: WebDeepLinkTarget = {
      event_id: event.event_id,
      room_id: `group:${event.group_id}`,
      surface: isReply ? "group-thread" : "group-main",
      group_id: event.group_id,
      parent_event_id: event.parent_event_id,
      focus_event_id: event.event_id,
    };
    let root_event: EventRow | null = null;
    if (isReply && event.parent_event_id !== null) {
      try {
        root_event = getVisibleEvent(db, event.parent_event_id, peerId);
      } catch {
        root_event = null; // root outside this peer's visibility; reply still resolves
      }
    }
    return { target, event, root_event };
  }
  if (event.recipient_peer_id === null) {
    throw new HttpError(400, "deeplink_unsupported", `Event ${eventId} is not a room or DM message`);
  }
  const otherPeerId = event.sender_peer_id === peerId ? event.recipient_peer_id : event.sender_peer_id;
  return {
    target: {
      event_id: event.event_id,
      room_id: `dm:${otherPeerId}`,
      surface: "dm",
      group_id: null,
      parent_event_id: null,
      focus_event_id: event.event_id,
    },
    event,
    root_event: null,
  };
}

export function eventForRecipient<T extends EventRow>(event: T, recipientPeerId: string): T {
  const skillDirectives = parseJsonStringArray(event.skill_directives_json);
  if (event.type !== "group_message" || skillDirectives.length === 0) return event;
  const mentionedPeerIds = parseJsonStringArray(event.mentions_json);
  if (!mentionedPeerIds.includes(recipientPeerId)) return event;
  const prefix = `You must use the following skills for this message: ${skillDirectives.join(", ")}.`;
  return {
    ...event,
    body: event.body ? `${prefix}\n\n${event.body}` : prefix,
  };
}

function parseJsonStringArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function ensureReactableEvent(event: EventRow): void {
  if (event.type !== "group_message" && event.type !== "dm") {
    throw new HttpError(400, "reaction_target_not_message", `Cannot react to event ${event.event_id}: type is '${event.type}'`);
  }
}

export function applyReaction(
  db: Database,
  input: { eventId: number; peerId: string; emoji: string; op: ReactionOp },
): { changed: boolean; active: boolean } {
  const existing = db
    .query<{ peer_id: string }, [number, string, string]>(
      "SELECT peer_id FROM message_reactions WHERE event_id = ? AND emoji = ? AND peer_id = ?",
    )
    .get(input.eventId, input.emoji, input.peerId);
  if (input.op === "add" || (input.op === "toggle" && !existing)) {
    db
      .query("INSERT OR IGNORE INTO message_reactions (event_id, emoji, peer_id) VALUES (?, ?, ?)")
      .run(input.eventId, input.emoji, input.peerId);
    return { changed: !existing, active: true };
  }
  if (input.op === "remove" || (input.op === "toggle" && existing)) {
    const result = db
      .query("DELETE FROM message_reactions WHERE event_id = ? AND emoji = ? AND peer_id = ?")
      .run(input.eventId, input.emoji, input.peerId);
    return { changed: result.changes > 0, active: false };
  }
  return { changed: false, active: Boolean(existing) };
}

export function reactionDmPeerId(event: EventRow, actorPeerId: string): string | null {
  if (event.recipient_peer_id === null) return actorPeerId;
  return event.sender_peer_id === actorPeerId ? event.recipient_peer_id : event.sender_peer_id;
}

// Engaging with an event — reacting to it, or replying in its thread — clears it
// from the actor's "awaiting you" set (the web Activity view's awaiting signal is
// inbox.acked_at IS NULL). Acking here, server-side, keeps the signal correct no
// matter which surface the engagement came from (Activity, chat, thread pane).
export function ackInboxEvents(db: Database, peerId: string, eventIds: number[]): number {
  const ids = [...new Set(eventIds.filter((id): id is number => Number.isFinite(id)))];
  if (ids.length === 0) return 0;
  return db
    .query(
      `UPDATE inbox SET acked_at = COALESCE(acked_at, ?)
       WHERE recipient_peer_id = ? AND acked_at IS NULL AND event_id IN (${ids.map(() => "?").join(",")})`,
    )
    .run(new Date().toISOString(), peerId, ...ids).changes;
}

export function attachReactions<T extends EventRow>(db: Database, events: T[]): T[] {
  if (events.length === 0) return events;
  const ids = [...new Set(events.map((event) => event.event_id))];
  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .query<ReactionRow, number[]>(
      `SELECT
         mr.event_id,
         mr.emoji,
         mr.peer_id,
         mr.created_at,
         p.session_name,
         p.tool,
         gm.alias
       FROM message_reactions mr
       JOIN events e ON e.event_id = mr.event_id
       JOIN peers p ON p.peer_id = mr.peer_id
       LEFT JOIN group_members gm ON gm.group_id = e.group_id AND gm.peer_id = mr.peer_id
       WHERE mr.event_id IN (${placeholders})
       ORDER BY mr.event_id ASC, mr.emoji ASC, mr.created_at ASC`,
    )
    .all(...ids);
  const byEvent = new Map<number, Map<string, ReactionSummary>>();
  for (const row of rows) {
    let byEmoji = byEvent.get(row.event_id);
    if (!byEmoji) {
      byEmoji = new Map();
      byEvent.set(row.event_id, byEmoji);
    }
    let summary = byEmoji.get(row.emoji);
    if (!summary) {
      summary = { emoji: row.emoji, count: 0, by: [] };
      byEmoji.set(row.emoji, summary);
    }
    summary.count += 1;
    summary.by.push({
      peer_id: row.peer_id,
      session_name: row.session_name,
      tool: row.tool,
      alias: row.alias,
      created_at: row.created_at,
    });
  }
  return events.map((event) => ({
    ...event,
    reactions: [...(byEvent.get(event.event_id)?.values() ?? [])],
  }));
}
