import type { Database } from "bun:sqlite";

// Per-peer web composer drafts (schema v16). room_id is the web room id string
// ("group:1" / "dm:<peer>"); thread_parent_id '' = the main-room composer.
// See docs/plans/web-multi-tab-popout-v0.md.

export interface WebDraftRow {
  room_id: string;
  thread_parent_id: string;
  body: string;
  updated_at: string;
}

export function listWebDrafts(db: Database, peerId: string): WebDraftRow[] {
  return db
    .query<WebDraftRow, [string]>(
      "SELECT room_id, thread_parent_id, body, updated_at FROM web_drafts WHERE peer_id = ? ORDER BY updated_at",
    )
    .all(peerId);
}

export function putWebDraft(
  db: Database,
  input: { peerId: string; roomId: string; threadParentId: string; body: string },
): void {
  if (input.body === "") {
    db.query("DELETE FROM web_drafts WHERE peer_id = ? AND room_id = ? AND thread_parent_id = ?")
      .run(input.peerId, input.roomId, input.threadParentId);
    return;
  }
  db.query(
    `INSERT INTO web_drafts (peer_id, room_id, thread_parent_id, body)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (peer_id, room_id, thread_parent_id) DO UPDATE SET
       body = excluded.body,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
  ).run(input.peerId, input.roomId, input.threadParentId, input.body);
}
