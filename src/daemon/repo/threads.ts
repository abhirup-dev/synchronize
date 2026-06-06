import { Database } from "bun:sqlite";

import { MAX_PAGE_LIMIT } from "../../constants.ts";
import { HttpError } from "../../http.ts";
import {
  selectorLimit,
  type NormalizedSelectors,
} from "../selectors.ts";
import { parseLimit } from "../validation.ts";
import { getEvent, type EventRow } from "./events.ts";

interface ThreadDiscoveryRow {
  root_event_id: number;
  group_name: string;
  root_sender_peer_id: string | null;
  root_sender_session_name: string | null;
  root_sender_alias: string | null;
  created_at: string;
  last_activity_at: string;
  reply_count: number;
  participant_count: number;
  preview: string | null;
}

interface ThreadParticipantRow {
  peer_id: string;
  session_name: string | null;
  alias: string | null;
  active: number | null;
  event_count: number;
  first_event_id: number;
  last_event_id: number;
  last_activity_at: string;
}

interface ThreadStatusRow {
  root_event_id: number;
  group_id: number;
  group_name: string;
  root_sender_peer_id: string | null;
  root_sender_session_name: string | null;
  root_sender_alias: string | null;
  created_at: string;
  last_event_id: number;
  last_activity_at: string;
  reply_count: number;
  event_count: number;
  participant_count: number;
}

type MainGroupHistoryRow = EventRow & { reply_count: number; last_reply_event_id: number | null };

export function listGroupHistoryFlat(
  db: Database,
  groupId: number,
  historyFrom: number,
  selectors: NormalizedSelectors,
): { rows: MainGroupHistoryRow[]; truncated: boolean } {
  const limit = selectorLimit(selectors);
  const queryLimit = Math.min(limit + 1, MAX_PAGE_LIMIT + 1);
  const order = selectors.strategy === "last" ? "DESC" : "ASC";
  const rows = db
    .query<MainGroupHistoryRow, [number, number, number]>(
      `SELECT e.*,
              g.name AS group_name,
              (SELECT COUNT(*) FROM events r WHERE r.parent_event_id = e.event_id) AS reply_count,
              (SELECT MAX(event_id) FROM events r WHERE r.parent_event_id = e.event_id) AS last_reply_event_id
       FROM events e
       LEFT JOIN groups g ON g.group_id = e.group_id
       WHERE e.group_id = ? AND e.event_id >= ? AND e.parent_event_id IS NULL
       ORDER BY e.event_id ${order}
       LIMIT ?`,
    )
    .all(groupId, historyFrom, queryLimit);
  const truncated = rows.length > limit;
  const selected = rows.slice(0, limit);
  return { rows: selectors.strategy === "last" ? selected.reverse() : selected, truncated };
}

export function listGroupHistoryThreads(
  db: Database,
  groupName: string,
  sourceUrl: URL,
  selectors: NormalizedSelectors,
): { rows: ThreadDiscoveryRow[]; truncated: boolean } {
  const limit = selectorLimit(selectors);
  const url = new URL(sourceUrl.toString());
  url.searchParams.set("group", groupName);
  url.searchParams.set("limit", String(Math.min(limit + 1, MAX_PAGE_LIMIT + 1)));
  if (selectors.strategy === "first") url.searchParams.set("order", "asc");
  const rows = listThreadDiscoveries(db, url);
  return { rows: rows.slice(0, limit), truncated: rows.length > limit };
}

export function listThreadDiscoveries(db: Database, url: URL): ThreadDiscoveryRow[] {
  const limit = parseLimit(url.searchParams.get("limit"));
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  const group = url.searchParams.get("group")?.trim();
  const startedByPeerId = url.searchParams.get("started_by_peer_id")?.trim();
  const startedBySessionName = url.searchParams.get("started_by_session_name")?.trim();
  const participatedByPeerId = url.searchParams.get("participated_by_peer_id")?.trim();
  const participatedBySessionName = url.searchParams.get("participated_by_session_name")?.trim();
  const activeSince = url.searchParams.get("active_since")?.trim();
  const order = url.searchParams.get("order") === "asc" ? "ASC" : "DESC";

  if (group) {
    clauses.push("dt.group_name = ?");
    params.push(group);
  }
  if (startedByPeerId) {
    clauses.push("dt.root_sender_peer_id = ?");
    params.push(startedByPeerId);
  }
  if (startedBySessionName) {
    clauses.push("dt.root_sender_session_name = ?");
    params.push(startedBySessionName);
  }
  if (participatedByPeerId) {
    clauses.push(
      `EXISTS (
        SELECT 1 FROM thread_events te
        WHERE te.thread_root_event_id = dt.root_event_id AND te.sender_peer_id = ?
      )`,
    );
    params.push(participatedByPeerId);
  }
  if (participatedBySessionName) {
    clauses.push(
      `EXISTS (
        SELECT 1 FROM thread_events te
        WHERE te.thread_root_event_id = dt.root_event_id AND te.sender_session_name = ?
      )`,
    );
    params.push(participatedBySessionName);
  }
  if (activeSince) {
    clauses.push("dt.last_activity_at >= ?");
    params.push(activeSince);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  return db
    .query<ThreadDiscoveryRow, Array<string | number>>(
      `SELECT
         dt.root_event_id,
         dt.group_name,
         dt.root_sender_peer_id,
         dt.root_sender_session_name,
         dt.root_sender_alias,
         dt.created_at,
         dt.last_activity_at,
         dt.reply_count,
         dt.participant_count,
         dt.preview
       FROM discoverable_threads dt
       ${where}
       ORDER BY dt.last_activity_at ${order}, dt.root_event_id ${order}
       LIMIT ?`,
    )
    .all(...params, limit);
}

export function getThreadStatus(db: Database, rootEventId: number): ThreadStatusRow & { participants: Array<Omit<ThreadParticipantRow, "active"> & { active: boolean }> } {
  const root = getEvent(db, rootEventId);
  if (root.group_id === null || root.parent_event_id !== null || root.type !== "group_message") {
    throw new HttpError(400, "thread_of_not_root", `Event ${rootEventId} is not a thread root`);
  }
  const status = db
    .query<ThreadStatusRow, [number]>(
      `SELECT
         dt.root_event_id,
         dt.group_id,
         dt.group_name,
         dt.root_sender_peer_id,
         dt.root_sender_session_name,
         dt.root_sender_alias,
         dt.created_at,
         COALESCE(MAX(te.event_id), dt.root_event_id) AS last_event_id,
         dt.last_activity_at,
         dt.reply_count,
         COUNT(te.event_id) AS event_count,
         dt.participant_count
       FROM discoverable_threads dt
       JOIN thread_events te ON te.thread_root_event_id = dt.root_event_id
       WHERE dt.root_event_id = ?
       GROUP BY dt.root_event_id`,
    )
    .get(rootEventId);
  if (!status) throw new HttpError(404, "thread_not_found", `Thread not found: ${rootEventId}`);
  const participants = db
    .query<ThreadParticipantRow, [number]>(
      `SELECT
         te.sender_peer_id AS peer_id,
         p.session_name,
         gm.alias,
         gm.active,
         COUNT(*) AS event_count,
         MIN(te.event_id) AS first_event_id,
         MAX(te.event_id) AS last_event_id,
         MAX(te.created_at) AS last_activity_at
       FROM thread_events te
       LEFT JOIN peers p ON p.peer_id = te.sender_peer_id
       LEFT JOIN group_members gm ON gm.group_id = te.group_id AND gm.peer_id = te.sender_peer_id
       WHERE te.thread_root_event_id = ? AND te.sender_peer_id IS NOT NULL
       GROUP BY te.sender_peer_id
       ORDER BY last_activity_at ASC, first_event_id ASC`,
    )
    .all(rootEventId)
    .map(({ active, ...row }) => ({ ...row, active: Boolean(active) }));
  return { ...status, participants };
}

export function renderThreadTranscript(db: Database, events: EventRow[]): string {
  return events
    .map((event) => {
      const sender = event.sender_peer_id
        ? db.query<{ session_name: string }, [string]>("SELECT session_name FROM peers WHERE peer_id = ?").get(event.sender_peer_id)
            ?.session_name ?? event.sender_peer_id
        : "system";
      return `[${event.created_at}] ${sender}: ${event.body ?? ""}`;
    })
    .join("\n");
}
