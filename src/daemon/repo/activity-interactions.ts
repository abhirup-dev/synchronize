import { Database } from "bun:sqlite";

export type ThreadInteractionKind = "message" | "reaction" | "handled";

interface ThreadScopeRow {
  event_id: number;
  group_id: number | null;
  parent_event_id: number | null;
  type: string;
}

interface AwaitingScopeRow {
  group_id: number;
  thread_root_event_id: number;
  last_event_id: number;
}

export function recordGroupMessageInteraction(
  db: Database,
  input: {
    peerId: string;
    groupId: number;
    eventId: number;
    parentEventId: number | null;
    kind: ThreadInteractionKind;
  },
): void {
  db
    .query(
      `INSERT INTO peer_thread_interactions (
         peer_id,
         group_id,
         thread_root_event_id,
         last_interaction_event_id,
         last_interaction_kind,
         updated_at
       )
       VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(peer_id, group_id, thread_root_event_id) DO UPDATE SET
         last_interaction_event_id =
           CASE
             WHEN excluded.last_interaction_event_id > peer_thread_interactions.last_interaction_event_id
             THEN excluded.last_interaction_event_id
             ELSE peer_thread_interactions.last_interaction_event_id
           END,
         last_interaction_kind =
           CASE
             WHEN excluded.last_interaction_event_id >= peer_thread_interactions.last_interaction_event_id
             THEN excluded.last_interaction_kind
             ELSE peer_thread_interactions.last_interaction_kind
           END,
         updated_at =
           CASE
             WHEN excluded.last_interaction_event_id >= peer_thread_interactions.last_interaction_event_id
             THEN excluded.updated_at
             ELSE peer_thread_interactions.updated_at
           END`,
    )
    .run(input.peerId, input.groupId, input.parentEventId ?? input.eventId, input.eventId, input.kind);
}

export function recordThreadInteractionForEvent(
  db: Database,
  input: { peerId: string; eventId: number; kind: ThreadInteractionKind },
): boolean {
  const event = db
    .query<ThreadScopeRow, [number]>(
      "SELECT event_id, type, group_id, parent_event_id FROM events WHERE event_id = ?",
    )
    .get(input.eventId);
  if (!event || event.type !== "group_message" || event.group_id === null) return false;
  recordGroupMessageInteraction(db, {
    peerId: input.peerId,
    groupId: event.group_id,
    eventId: event.event_id,
    parentEventId: event.parent_event_id,
    kind: input.kind,
  });
  return true;
}

export function markActivityEventsHandled(db: Database, peerId: string, eventIds: number[]): number {
  let handled = 0;
  for (const eventId of new Set(eventIds)) {
    if (recordThreadInteractionForEvent(db, { peerId, eventId, kind: "handled" })) handled += 1;
  }
  return handled;
}

export function markAllAwaitingActivityHandled(db: Database, peerId: string): number {
  const rows = db
    .query<AwaitingScopeRow, [string, string]>(
      `SELECT
         e.group_id AS group_id,
         COALESCE(e.parent_event_id, e.event_id) AS thread_root_event_id,
         MAX(e.event_id) AS last_event_id
       FROM events e
       JOIN peers sender ON sender.peer_id = e.sender_peer_id
       LEFT JOIN peer_thread_interactions pti
         ON pti.peer_id = ?
        AND pti.group_id = e.group_id
        AND pti.thread_root_event_id = COALESCE(e.parent_event_id, e.event_id)
       WHERE e.type = 'group_message'
         AND e.group_id IS NOT NULL
         AND e.sender_peer_id IS NOT NULL
         AND e.sender_peer_id != ?
         AND sender.tool != 'web'
         AND e.event_id > COALESCE(pti.last_interaction_event_id, 0)
       GROUP BY e.group_id, COALESCE(e.parent_event_id, e.event_id)`,
    )
    .all(peerId, peerId);
  for (const row of rows) {
    recordGroupMessageInteraction(db, {
      peerId,
      groupId: row.group_id,
      eventId: row.last_event_id,
      parentEventId: row.thread_root_event_id === row.last_event_id ? null : row.thread_root_event_id,
      kind: "handled",
    });
  }
  return rows.length;
}
