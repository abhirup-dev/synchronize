import { Database } from "bun:sqlite";
import { dirname } from "node:path";
import { EVENT_TYPES } from "./constants.ts";
import { ensureDir } from "./fs.ts";

// SQL-fragment list for the CHECK constraint on events.type. Single source of
// truth for the canonical event-type set; see EVENT_TYPES in constants.ts.
const EVENT_TYPE_CHECK = EVENT_TYPES.map((value) => `'${value}'`).join(",");

export interface DatabaseHandle {
  db: Database;
  path: string;
}

export async function openDatabase(path: string): Promise<DatabaseHandle> {
  await ensureDir(dirname(path));
  const db = new Database(path, { create: true, strict: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA temp_store = MEMORY");
  db.exec("PRAGMA cache_size = -64000");
  db.exec("PRAGMA mmap_size = 268435456");
  migrate(db);
  return { db, path };
}

function migrate(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS peers (
      peer_id TEXT PRIMARY KEY,
      tool TEXT NOT NULL,
      session_name TEXT NOT NULL,
      purpose TEXT,
      machine_id TEXT NOT NULL,
      lease_expires_at TEXT NOT NULL,
      last_cursor INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE INDEX IF NOT EXISTS idx_peers_lease_expires_at
      ON peers (lease_expires_at);

    CREATE TABLE IF NOT EXISTS agent_sessions (
      binding_id TEXT PRIMARY KEY,
      peer_id TEXT NOT NULL REFERENCES peers(peer_id) ON DELETE CASCADE,
      host_tool TEXT NOT NULL,
      host_session_id TEXT NOT NULL,
      host_session_file TEXT,
      cwd TEXT,
      pid INTEGER,
      source TEXT,
      model TEXT,
      agent_type TEXT,
      metadata_json TEXT,
      launch_id TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(host_tool, host_session_id)
    );

    CREATE INDEX IF NOT EXISTS idx_agent_sessions_peer
      ON agent_sessions (peer_id);

    CREATE INDEX IF NOT EXISTS idx_agent_sessions_launch
      ON agent_sessions (launch_id);

    CREATE TABLE IF NOT EXISTS groups (
      group_id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      durable INTEGER NOT NULL DEFAULT 1,
      media_dir TEXT NOT NULL,
      creator_peer_id TEXT,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS group_members (
      group_id INTEGER NOT NULL REFERENCES groups(group_id) ON DELETE CASCADE,
      peer_id TEXT NOT NULL REFERENCES peers(peer_id) ON DELETE CASCADE,
      alias TEXT NOT NULL,
      join_event_id INTEGER,
      history_from_event_id INTEGER,
      active INTEGER NOT NULL DEFAULT 1,
      purpose TEXT,
      joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      left_at TEXT,
      PRIMARY KEY (group_id, peer_id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_group_members_alias
      ON group_members (group_id, alias)
      WHERE active = 1;

    CREATE TABLE IF NOT EXISTS events (
      event_id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK (type IN (${EVENT_TYPE_CHECK})),
      sender_peer_id TEXT,
      recipient_peer_id TEXT,
      group_id INTEGER REFERENCES groups(group_id) ON DELETE CASCADE,
      body TEXT,
      media_id TEXT,
      parent_event_id INTEGER REFERENCES events(event_id) ON DELETE CASCADE,
      mentions_json TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE INDEX IF NOT EXISTS idx_events_group_event
      ON events (group_id, event_id);

    CREATE INDEX IF NOT EXISTS idx_events_recipient_event
      ON events (recipient_peer_id, event_id);

    CREATE INDEX IF NOT EXISTS idx_events_group_parent_event
      ON events (group_id, parent_event_id, event_id);

    CREATE TABLE IF NOT EXISTS inbox (
      recipient_peer_id TEXT NOT NULL REFERENCES peers(peer_id) ON DELETE CASCADE,
      event_id INTEGER NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
      delivered_at TEXT,
      read_at TEXT,
      acked_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY (recipient_peer_id, event_id)
    );

    CREATE INDEX IF NOT EXISTS idx_inbox_recipient_acked_event
      ON inbox (recipient_peer_id, acked_at, event_id);

    CREATE TABLE IF NOT EXISTS media_items (
      media_id TEXT PRIMARY KEY,
      group_id INTEGER NOT NULL REFERENCES groups(group_id) ON DELETE CASCADE,
      original_path TEXT NOT NULL,
      copied_path TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      content_type TEXT NOT NULL,
      description TEXT,
      shared_by_peer_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE INDEX IF NOT EXISTS idx_media_group_created
      ON media_items (group_id, created_at);

    INSERT OR IGNORE INTO schema_migrations (version) VALUES (1);
  `);

  // Migration v2 — peers.deleted_at for soft-delete (closes sync-dmc).
  // DELETE /peers/:id used to cascade through group_members.peer_id and drop
  // every group membership the peer ever had, killing the reclaim-audit
  // trail and turning past events into orphans with null senders. Soft-delete
  // by setting deleted_at; all peer reads filter `deleted_at IS NULL`, and
  // re-register through upsertPeer clears the column to "resurrect" the peer.
  const hasV2 = db
    .query<{ version: number }, []>("SELECT version FROM schema_migrations WHERE version = 2")
    .get();
  if (!hasV2) {
    const hasDeletedAt = db
      .query<{ name: string }, []>("SELECT name FROM pragma_table_info('peers') WHERE name = 'deleted_at'")
      .get();
    if (!hasDeletedAt) {
      db.exec(`ALTER TABLE peers ADD COLUMN deleted_at TEXT`);
    }
    db.exec(`CREATE INDEX IF NOT EXISTS idx_peers_deleted_at ON peers (deleted_at)`);
    db.exec(`INSERT OR IGNORE INTO schema_migrations (version) VALUES (2)`);
  }

  // Migration v3 — peers.activity_state + last_activity_at for 3-state
  // presence. activity_state ∈ {initializing,working,idle} for instrumented
  // agents (pi/claude); NULL for uninstrumented peers (web/cli/codex), which
  // render as generic online. Fed by POST /peers/activity. See
  // session-tracker/plan-agent-ttl-presence-v0.md.
  const hasV3 = db
    .query<{ version: number }, []>("SELECT version FROM schema_migrations WHERE version = 3")
    .get();
  if (!hasV3) {
    const cols = db
      .query<{ name: string }, []>("SELECT name FROM pragma_table_info('peers')")
      .all()
      .map((row) => row.name);
    if (!cols.includes("activity_state")) {
      db.exec(`ALTER TABLE peers ADD COLUMN activity_state TEXT`);
    }
    if (!cols.includes("last_activity_at")) {
      db.exec(`ALTER TABLE peers ADD COLUMN last_activity_at TEXT`);
    }
    db.exec(`INSERT OR IGNORE INTO schema_migrations (version) VALUES (3)`);
  }
}

/**
 * Drop ephemeral group rows AND their media directories on daemon startup.
 * Kept separate from migrate() so callers can pass an FS-cleanup callback —
 * the schema layer should not know how media is laid out on disk.
 */
export async function pruneEphemeralGroups(
  db: Database,
  removeMediaDir: (mediaDir: string) => Promise<void>,
): Promise<void> {
  const rows = db
    .query<{ media_dir: string }, []>("SELECT media_dir FROM groups WHERE durable = 0")
    .all();
  db.exec("DELETE FROM groups WHERE durable = 0");
  // Filesystem cleanup is best-effort; failure is logged by the caller via the
  // callback. We do not want a stale dir to block daemon startup.
  for (const row of rows) {
    if (row.media_dir) await removeMediaDir(row.media_dir);
  }
}
