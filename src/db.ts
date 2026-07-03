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
      git_branch TEXT,
      git_dirty INTEGER,
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

    CREATE TABLE IF NOT EXISTS group_paths (
      path_id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL REFERENCES groups(group_id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      label TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(group_id, path)
    );

    CREATE INDEX IF NOT EXISTS idx_group_paths_group
      ON group_paths (group_id, active, path);

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
      reply_to_event_id INTEGER REFERENCES events(event_id) ON DELETE SET NULL,
      mentions_json TEXT,
      skill_directives_json TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE INDEX IF NOT EXISTS idx_events_group_event
      ON events (group_id, event_id);

    CREATE INDEX IF NOT EXISTS idx_events_recipient_event
      ON events (recipient_peer_id, event_id);

    CREATE INDEX IF NOT EXISTS idx_events_group_parent_event
      ON events (group_id, parent_event_id, event_id);

    CREATE INDEX IF NOT EXISTS idx_events_type_event
      ON events (type, event_id);

    CREATE INDEX IF NOT EXISTS idx_events_sender_event
      ON events (sender_peer_id, event_id);

    CREATE INDEX IF NOT EXISTS idx_events_created_at
      ON events (created_at);

    CREATE INDEX IF NOT EXISTS idx_events_parent_event
      ON events (parent_event_id, event_id);

    CREATE TABLE IF NOT EXISTS message_reactions (
      event_id INTEGER NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
      peer_id TEXT NOT NULL REFERENCES peers(peer_id) ON DELETE CASCADE,
      emoji TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY (event_id, emoji, peer_id)
    );

    CREATE INDEX IF NOT EXISTS idx_message_reactions_event
      ON message_reactions (event_id, emoji, created_at);

    CREATE INDEX IF NOT EXISTS idx_message_reactions_peer
      ON message_reactions (peer_id, created_at);

    CREATE INDEX IF NOT EXISTS idx_message_reactions_peer_event
      ON message_reactions (peer_id, event_id);

    CREATE TABLE IF NOT EXISTS peer_thread_interactions (
      peer_id TEXT NOT NULL REFERENCES peers(peer_id) ON DELETE CASCADE,
      group_id INTEGER NOT NULL REFERENCES groups(group_id) ON DELETE CASCADE,
      thread_root_event_id INTEGER NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
      last_interaction_event_id INTEGER NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
      last_interaction_kind TEXT NOT NULL CHECK (last_interaction_kind IN ('message','reaction','handled')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY (peer_id, group_id, thread_root_event_id)
    );

    CREATE INDEX IF NOT EXISTS idx_peer_thread_interactions_peer_group_thread
      ON peer_thread_interactions (peer_id, group_id, thread_root_event_id, last_interaction_event_id);

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

    CREATE VIEW IF NOT EXISTS event_log AS
      SELECT
        e.*,
        g.name AS group_name,
        sp.session_name AS sender_session_name,
        sp.tool AS sender_tool,
        direct.sender_peer_id AS direct_sender_peer_id,
        direct.body AS direct_body,
        dsp.session_name AS direct_sender_session_name,
        dsp.tool AS direct_sender_tool,
        rp.session_name AS recipient_session_name,
        rp.tool AS recipient_tool
      FROM events e
      LEFT JOIN groups g ON g.group_id = e.group_id
      LEFT JOIN peers sp ON sp.peer_id = e.sender_peer_id
      LEFT JOIN events direct ON direct.event_id = e.reply_to_event_id
      LEFT JOIN peers dsp ON dsp.peer_id = direct.sender_peer_id
      LEFT JOIN peers rp ON rp.peer_id = e.recipient_peer_id;

    CREATE VIEW IF NOT EXISTS thread_events AS
      SELECT
        e.*,
        CASE WHEN e.parent_event_id IS NULL THEN e.event_id ELSE e.parent_event_id END AS thread_root_event_id,
        CASE WHEN e.parent_event_id IS NULL THEN 0 ELSE 1 END AS thread_position,
        g.name AS group_name,
        sp.session_name AS sender_session_name,
        sp.tool AS sender_tool,
        direct.sender_peer_id AS direct_sender_peer_id,
        direct.body AS direct_body,
        dsp.session_name AS direct_sender_session_name,
        dsp.tool AS direct_sender_tool,
        root.sender_peer_id AS thread_root_sender_peer_id,
        root.body AS thread_root_body,
        rsp.session_name AS thread_root_sender_session_name,
        rsp.tool AS thread_root_sender_tool
      FROM events e
      LEFT JOIN groups g ON g.group_id = e.group_id
      LEFT JOIN peers sp ON sp.peer_id = e.sender_peer_id
      LEFT JOIN events direct ON direct.event_id = e.reply_to_event_id
      LEFT JOIN peers dsp ON dsp.peer_id = direct.sender_peer_id
      LEFT JOIN events root ON root.event_id = CASE WHEN e.parent_event_id IS NULL THEN e.event_id ELSE e.parent_event_id END
      LEFT JOIN peers rsp ON rsp.peer_id = root.sender_peer_id
      WHERE e.type = 'group_message';

    CREATE VIEW IF NOT EXISTS discoverable_threads AS
      SELECT
        root.event_id AS root_event_id,
        root.group_id,
        g.name AS group_name,
        root.sender_peer_id AS root_sender_peer_id,
        sp.session_name AS root_sender_session_name,
        gm.alias AS root_sender_alias,
        root.created_at,
        COALESCE(MAX(reply.created_at), root.created_at) AS last_activity_at,
        COUNT(DISTINCT reply.event_id) AS reply_count,
        COUNT(DISTINCT participant.sender_peer_id) AS participant_count,
        root.body AS preview
      FROM events root
      JOIN groups g ON g.group_id = root.group_id
      LEFT JOIN peers sp ON sp.peer_id = root.sender_peer_id
      LEFT JOIN group_members gm ON gm.group_id = root.group_id AND gm.peer_id = root.sender_peer_id
      JOIN events reply ON reply.parent_event_id = root.event_id
      LEFT JOIN events participant
        ON participant.event_id = root.event_id OR participant.parent_event_id = root.event_id
      WHERE root.type = 'group_message' AND root.parent_event_id IS NULL
      GROUP BY root.event_id;

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

  // Migration v4 — group_paths: each group owns the set of workspace paths
  // agents may be launched against from the web/AOE flow. Existing groups are
  // populated by the daemon at startup because the correct default path depends
  // on the running source root, not only the schema.
  const hasV4 = db
    .query<{ version: number }, []>("SELECT version FROM schema_migrations WHERE version = 4")
    .get();
  if (!hasV4) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS group_paths (
        path_id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER NOT NULL REFERENCES groups(group_id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        label TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        UNIQUE(group_id, path)
      );
      CREATE INDEX IF NOT EXISTS idx_group_paths_group
        ON group_paths (group_id, active, path);
    `);
    db.exec(`INSERT OR IGNORE INTO schema_migrations (version) VALUES (4)`);
  }

  // Migration v5 — thread summaries (sync-b8q).
  //   * Adds the thread_summaries table (one row per root_event_id, LWW cache).
  //   * Recreates discoverable_threads to expose last_event_id so the worker
  //     can detect staleness by event id, not just last_activity_at timestamp.
  const hasV5 = db
    .query<{ version: number }, []>("SELECT version FROM schema_migrations WHERE version = 5")
    .get();
  if (!hasV5) {
    db.exec(`
      DROP VIEW IF EXISTS discoverable_threads;
      CREATE VIEW discoverable_threads AS
        SELECT
          root.event_id AS root_event_id,
          root.group_id,
          g.name AS group_name,
          root.sender_peer_id AS root_sender_peer_id,
          sp.session_name AS root_sender_session_name,
          gm.alias AS root_sender_alias,
          root.created_at,
          COALESCE(MAX(reply.created_at), root.created_at) AS last_activity_at,
          COALESCE(MAX(reply.event_id), root.event_id) AS last_event_id,
          COUNT(DISTINCT reply.event_id) AS reply_count,
          COUNT(DISTINCT participant.sender_peer_id) AS participant_count,
          root.body AS preview
        FROM events root
        JOIN groups g ON g.group_id = root.group_id
        LEFT JOIN peers sp ON sp.peer_id = root.sender_peer_id
        LEFT JOIN group_members gm ON gm.group_id = root.group_id AND gm.peer_id = root.sender_peer_id
        JOIN events reply ON reply.parent_event_id = root.event_id
        LEFT JOIN events participant
          ON participant.event_id = root.event_id OR participant.parent_event_id = root.event_id
        WHERE root.type = 'group_message' AND root.parent_event_id IS NULL
        GROUP BY root.event_id;

      CREATE TABLE IF NOT EXISTS thread_summaries (
        root_event_id         INTEGER PRIMARY KEY REFERENCES events(event_id) ON DELETE CASCADE,
        summary               TEXT    NOT NULL,
        model                 TEXT    NOT NULL,
        strategy              TEXT    NOT NULL,
        strategy_params_json  TEXT    NOT NULL,
        prompt_version        INTEGER NOT NULL,
        covered_last_event_id INTEGER NOT NULL,
        covered_event_count   INTEGER NOT NULL,
        created_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      CREATE INDEX IF NOT EXISTS idx_thread_summaries_updated_at
        ON thread_summaries (updated_at);
    `);
    db.exec(`INSERT OR IGNORE INTO schema_migrations (version) VALUES (5)`);
  }

  // Migration v6 — durable emoji reactions attached to message events.
  // Reactions are structured acknowledgments: no message body, no thread
  // reply, and no push notification. They are keyed by (event, emoji, peer)
  // so a peer can react once per emoji and toggle/remove idempotently.
  const hasV6 = db
    .query<{ version: number }, []>("SELECT version FROM schema_migrations WHERE version = 6")
    .get();
  const hasMessageReactions = db
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'message_reactions'")
    .get();
  if (!hasV6 || !hasMessageReactions) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS message_reactions (
        event_id INTEGER NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
        peer_id TEXT NOT NULL REFERENCES peers(peer_id) ON DELETE CASCADE,
        emoji TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        PRIMARY KEY (event_id, emoji, peer_id)
      );

      CREATE INDEX IF NOT EXISTS idx_message_reactions_event
        ON message_reactions (event_id, emoji, created_at);

      CREATE INDEX IF NOT EXISTS idx_message_reactions_peer
        ON message_reactions (peer_id, created_at);
    `);
    if (!hasV6) db.exec(`INSERT OR IGNORE INTO schema_migrations (version) VALUES (6)`);
  }

  // Migration v7 — durable launch lifecycle kernel (sync-txpj).
  // Launch intent, lifecycle evidence, and side-effect work are stored in
  // SQLite so delayed registration, daemon restart, and HTTP timeout cannot
  // lose the group auto-join contract.
  const hasLaunchLifecycleV7 = db
    .query<{ version: number }, []>("SELECT version FROM schema_migrations WHERE version = 7")
    .get();
  const hasLaunchIntents = db
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'launch_intents'")
    .get();
  if (!hasLaunchLifecycleV7 || !hasLaunchIntents) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS launch_intents (
        launch_id TEXT PRIMARY KEY,
        peer_id TEXT NOT NULL,
        tool TEXT NOT NULL,
        profile_name TEXT,
        session_name TEXT NOT NULL,
        alias TEXT NOT NULL,
        cwd TEXT NOT NULL,
        target_group TEXT,
        model TEXT,
        thinking TEXT,
        args_json TEXT,
        backend TEXT NOT NULL,
        backend_profile TEXT,
        backend_title TEXT NOT NULL,
        state TEXT NOT NULL,
        failure_code TEXT,
        failure_message TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        accepted_at TEXT,
        spawned_at TEXT,
        prompt_seen_at TEXT,
        prompt_accepted_at TEXT,
        registered_at TEXT,
        reconciled_at TEXT,
        joined_at TEXT,
        stale_at TEXT,
        failed_at TEXT,
        stopped_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_launch_intents_peer
        ON launch_intents (peer_id);

      CREATE INDEX IF NOT EXISTS idx_launch_intents_state_updated
        ON launch_intents (state, updated_at);

      CREATE INDEX IF NOT EXISTS idx_launch_intents_backend_title
        ON launch_intents (backend, backend_title);

      CREATE TABLE IF NOT EXISTS launch_events (
        event_id INTEGER PRIMARY KEY AUTOINCREMENT,
        launch_id TEXT NOT NULL REFERENCES launch_intents(launch_id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        from_state TEXT,
        to_state TEXT,
        payload_json TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      CREATE INDEX IF NOT EXISTS idx_launch_events_launch_event
        ON launch_events (launch_id, event_id);

      CREATE INDEX IF NOT EXISTS idx_launch_events_kind_created
        ON launch_events (kind, created_at);

      CREATE TABLE IF NOT EXISTS launch_work (
        work_id INTEGER PRIMARY KEY AUTOINCREMENT,
        launch_id TEXT NOT NULL REFERENCES launch_intents(launch_id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        claimed_by TEXT,
        lease_expires_at TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL,
        next_run_at TEXT NOT NULL,
        last_error TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      CREATE INDEX IF NOT EXISTS idx_launch_work_ready
        ON launch_work (status, next_run_at, lease_expires_at);

      CREATE INDEX IF NOT EXISTS idx_launch_work_launch
        ON launch_work (launch_id, status);
    `);
    if (!hasLaunchLifecycleV7) db.exec(`INSERT OR IGNORE INTO schema_migrations (version) VALUES (7)`);
  }

  // Migration v8 — message-scoped skill directives. The stored event body
  // stays canonical; recipients get directive prefixes at read/push time.
  const hasSkillDirectivesV8 = db
    .query<{ version: number }, []>("SELECT version FROM schema_migrations WHERE version = 8")
    .get();
  const hasSkillDirectives = db
    .query<{ name: string }, []>("SELECT name FROM pragma_table_info('events') WHERE name = 'skill_directives_json'")
    .get();
  if (!hasSkillDirectivesV8 || !hasSkillDirectives) {
    if (!hasSkillDirectives) {
      db.exec(`ALTER TABLE events ADD COLUMN skill_directives_json TEXT`);
    }
    if (!hasSkillDirectivesV8) db.exec(`INSERT OR IGNORE INTO schema_migrations (version) VALUES (8)`);
  }

  // Migration v9 — preserve the direct reply target separately from the
  // normalized thread root. `parent_event_id` remains the placement root for
  // one-level threads; `reply_to_event_id` records the exact event the sender
  // answered so responses, SQL, and UI can show both levels.
  const hasReplyTargetV9 = db
    .query<{ version: number }, []>("SELECT version FROM schema_migrations WHERE version = 9")
    .get();
  const hasReplyToEventId = db
    .query<{ name: string }, []>("SELECT name FROM pragma_table_info('events') WHERE name = 'reply_to_event_id'")
    .get();
  if (!hasReplyTargetV9 || !hasReplyToEventId) {
    if (!hasReplyToEventId) db.exec(`ALTER TABLE events ADD COLUMN reply_to_event_id INTEGER REFERENCES events(event_id) ON DELETE SET NULL`);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_events_reply_to_event
        ON events (reply_to_event_id, event_id);

      DROP VIEW IF EXISTS event_log;
      CREATE VIEW event_log AS
        SELECT
          e.*,
          g.name AS group_name,
          sp.session_name AS sender_session_name,
          sp.tool AS sender_tool,
          direct.sender_peer_id AS direct_sender_peer_id,
          direct.body AS direct_body,
          dsp.session_name AS direct_sender_session_name,
          dsp.tool AS direct_sender_tool,
          rp.session_name AS recipient_session_name,
          rp.tool AS recipient_tool
        FROM events e
        LEFT JOIN groups g ON g.group_id = e.group_id
        LEFT JOIN peers sp ON sp.peer_id = e.sender_peer_id
        LEFT JOIN events direct ON direct.event_id = e.reply_to_event_id
        LEFT JOIN peers dsp ON dsp.peer_id = direct.sender_peer_id
        LEFT JOIN peers rp ON rp.peer_id = e.recipient_peer_id;

      DROP VIEW IF EXISTS thread_events;
      CREATE VIEW thread_events AS
        SELECT
          e.*,
          CASE WHEN e.parent_event_id IS NULL THEN e.event_id ELSE e.parent_event_id END AS thread_root_event_id,
          CASE WHEN e.parent_event_id IS NULL THEN 0 ELSE 1 END AS thread_position,
          g.name AS group_name,
          sp.session_name AS sender_session_name,
          sp.tool AS sender_tool,
          direct.sender_peer_id AS direct_sender_peer_id,
          direct.body AS direct_body,
          dsp.session_name AS direct_sender_session_name,
          dsp.tool AS direct_sender_tool,
          root.sender_peer_id AS thread_root_sender_peer_id,
          root.body AS thread_root_body,
          rsp.session_name AS thread_root_sender_session_name,
          rsp.tool AS thread_root_sender_tool
        FROM events e
        LEFT JOIN groups g ON g.group_id = e.group_id
        LEFT JOIN peers sp ON sp.peer_id = e.sender_peer_id
        LEFT JOIN events direct ON direct.event_id = e.reply_to_event_id
        LEFT JOIN peers dsp ON dsp.peer_id = direct.sender_peer_id
        LEFT JOIN events root ON root.event_id = CASE WHEN e.parent_event_id IS NULL THEN e.event_id ELSE e.parent_event_id END
        LEFT JOIN peers rsp ON rsp.peer_id = root.sender_peer_id
        WHERE e.type = 'group_message';
    `);
    if (!hasReplyTargetV9) db.exec(`INSERT OR IGNORE INTO schema_migrations (version) VALUES (9)`);
  }

  // Migration v10 — capture per-agent git context at host-session binding time
  // so bridge_whoami can surface the exact cwd/branch/dirty state agents are
  // operating in.
  const hasAgentSessionGitV10 = db
    .query<{ version: number }, []>("SELECT version FROM schema_migrations WHERE version = 10")
    .get();
  const agentSessionCols = db.query<{ name: string }, []>("PRAGMA table_info(agent_sessions)").all().map((col) => col.name);
  if (!hasAgentSessionGitV10 || !agentSessionCols.includes("git_branch") || !agentSessionCols.includes("git_dirty")) {
    if (!agentSessionCols.includes("git_branch")) db.exec(`ALTER TABLE agent_sessions ADD COLUMN git_branch TEXT`);
    if (!agentSessionCols.includes("git_dirty")) db.exec(`ALTER TABLE agent_sessions ADD COLUMN git_dirty INTEGER`);
    if (!hasAgentSessionGitV10) db.exec(`INSERT OR IGNORE INTO schema_migrations (version) VALUES (10)`);
  }

  // Migration v11 — archive/resume LIFECYCLE axis on peers + groups
  // (docs/plans/resumable-archived-sessions.md). lifecycle_state is the second
  // orthogonal axis (presence/lease is the first); deleted_at stays the
  // canonical 'released' tombstone (a third axis), so we do NOT add a 'deleted'
  // value here. Columns are inert until later issues consume them.
  //   peers.lifecycle_state  : 'active' | 'archived'   (archived IS resumable)
  //   peers.archived_at      : when it was archived
  //   peers.archived_reason  : free-text reason
  //   peers.archive_source   : 'manual' | 'auto'       (drives future cleanup)
  //   peers.auto_archive     : per-agent override (NULL = inherit the group)
  //   groups.auto_archive    : per-group toggle (cascades to members), 0 = off
  const hasArchiveLifecycleV11 = db
    .query<{ version: number }, []>("SELECT version FROM schema_migrations WHERE version = 11")
    .get();
  const peerArchiveCols = db.query<{ name: string }, []>("PRAGMA table_info(peers)").all().map((col) => col.name);
  const groupArchiveCols = db.query<{ name: string }, []>("PRAGMA table_info(groups)").all().map((col) => col.name);
  if (
    !hasArchiveLifecycleV11 ||
    !peerArchiveCols.includes("lifecycle_state") ||
    !groupArchiveCols.includes("auto_archive")
  ) {
    if (!peerArchiveCols.includes("lifecycle_state"))
      db.exec(`ALTER TABLE peers ADD COLUMN lifecycle_state TEXT NOT NULL DEFAULT 'active'`);
    if (!peerArchiveCols.includes("archived_at")) db.exec(`ALTER TABLE peers ADD COLUMN archived_at TEXT`);
    if (!peerArchiveCols.includes("archived_reason")) db.exec(`ALTER TABLE peers ADD COLUMN archived_reason TEXT`);
    if (!peerArchiveCols.includes("archive_source")) db.exec(`ALTER TABLE peers ADD COLUMN archive_source TEXT`);
    if (!peerArchiveCols.includes("auto_archive")) db.exec(`ALTER TABLE peers ADD COLUMN auto_archive INTEGER`);
    if (!groupArchiveCols.includes("auto_archive"))
      db.exec(`ALTER TABLE groups ADD COLUMN auto_archive INTEGER NOT NULL DEFAULT 0`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_peers_lifecycle_state ON peers (lifecycle_state)`);
    if (!hasArchiveLifecycleV11) db.exec(`INSERT OR IGNORE INTO schema_migrations (version) VALUES (11)`);
  }

  // Migration v12 — group_members LIFECYCLE column + archived-seat alias
  // reservation. The `active` INTEGER stays the hot DELIVERY bit (~6 hot SQL
  // paths unchanged); member_state adds the lifecycle dimension so an archived
  // seat keeps its alias reserved while being excluded from delivery.
  //   INVARIANT: active = 1  ⇔  member_state = 'active'   (archived/left ⇒ active = 0)
  // The alias uniqueness index moves from (WHERE active = 1) to
  // (WHERE member_state IN ('active','archived')) so an archived member's alias
  // is NOT reclaimable, while a 'left' member frees its alias as today.
  // Daemon leave/sweep SQL updated to also set member_state='left' (merge-map §7/§15).
  const hasMemberStateV12 = db
    .query<{ version: number }, []>("SELECT version FROM schema_migrations WHERE version = 12")
    .get();
  const memberCols = db.query<{ name: string }, []>("PRAGMA table_info(group_members)").all().map((col) => col.name);
  if (!hasMemberStateV12 || !memberCols.includes("member_state")) {
    if (!memberCols.includes("member_state"))
      db.exec(`ALTER TABLE group_members ADD COLUMN member_state TEXT NOT NULL DEFAULT 'active'`);
    // Backfill existing rows from the delivery bit, preserving the invariant.
    db.exec(`UPDATE group_members SET member_state = 'left' WHERE active = 0`);
    db.exec(`UPDATE group_members SET member_state = 'active' WHERE active = 1`);
    // Swap the alias-reservation index to cover archived seats too.
    // The daemon leave/sweep code also sets member_state='left' (merge-map §7/§15)
    // so the invariant active=1 ⇔ member_state='active' is always honored.
    db.exec(`DROP INDEX IF EXISTS idx_group_members_alias`);
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_group_members_alias
        ON group_members (group_id, alias)
        WHERE member_state IN ('active','archived')
    `);
    if (!hasMemberStateV12) db.exec(`INSERT OR IGNORE INTO schema_migrations (version) VALUES (12)`);
  }

  // v13: persist the resume target on launch_intents. Without it, the durable
  // launch worker (specFromRow) rebuilds the spawn WITHOUT --session, so every
  // daemon-mode resume forks a FRESH session and loses prior context. These
  // columns let the worker reconstruct req.resume and emit `pi --session <id>`
  // / `claude --resume <id>` faithfully. (sync-ocdt bug.)
  const hasResumeTargetV13 = db
    .query<{ version: number }, []>("SELECT version FROM schema_migrations WHERE version = 13")
    .get();
  const launchCols = db.query<{ name: string }, []>("PRAGMA table_info(launch_intents)").all().map((col) => col.name);
  if (!hasResumeTargetV13 || !launchCols.includes("resume_host_session_id")) {
    if (!launchCols.includes("resume_host_session_id"))
      db.exec(`ALTER TABLE launch_intents ADD COLUMN resume_host_session_id TEXT`);
    if (!launchCols.includes("resume_host_session_file"))
      db.exec(`ALTER TABLE launch_intents ADD COLUMN resume_host_session_file TEXT`);
    if (!hasResumeTargetV13) db.exec(`INSERT OR IGNORE INTO schema_migrations (version) VALUES (13)`);
  }

  // v14: store the selected agent profile name for configured launch/spawn.
  // Only the profile key is durable; env values and secret sources are resolved
  // from config.toml at spawn/retry time and are never copied into SQLite.
  const hasAgentProfileV14 = db
    .query<{ version: number }, []>("SELECT version FROM schema_migrations WHERE version = 14")
    .get();
  const launchColsV14 = db.query<{ name: string }, []>("PRAGMA table_info(launch_intents)").all().map((col) => col.name);
  if (!hasAgentProfileV14 || !launchColsV14.includes("profile_name")) {
    if (!launchColsV14.includes("profile_name")) db.exec(`ALTER TABLE launch_intents ADD COLUMN profile_name TEXT`);
    if (!hasAgentProfileV14) db.exec(`INSERT OR IGNORE INTO schema_migrations (version) VALUES (14)`);
  }

  // v15: materialized thread-interaction projection for Activity awaiting.
  // SQLite views are always recomputed, so the "agent messages after my last
  // reply/reaction/handled marker in this thread" signal is stored as a small
  // derived table and maintained by message/reaction/ack write paths.
  const hasPeerThreadInteractionsV15 = db
    .query<{ version: number }, []>("SELECT version FROM schema_migrations WHERE version = 15")
    .get();
  const hasPeerThreadInteractions = db
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'peer_thread_interactions'")
    .get();
  if (!hasPeerThreadInteractionsV15 || !hasPeerThreadInteractions) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_message_reactions_peer_event
        ON message_reactions (peer_id, event_id);

      CREATE TABLE IF NOT EXISTS peer_thread_interactions (
        peer_id TEXT NOT NULL REFERENCES peers(peer_id) ON DELETE CASCADE,
        group_id INTEGER NOT NULL REFERENCES groups(group_id) ON DELETE CASCADE,
        thread_root_event_id INTEGER NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
        last_interaction_event_id INTEGER NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
        last_interaction_kind TEXT NOT NULL CHECK (last_interaction_kind IN ('message','reaction','handled')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        PRIMARY KEY (peer_id, group_id, thread_root_event_id)
      );

      CREATE INDEX IF NOT EXISTS idx_peer_thread_interactions_peer_group_thread
        ON peer_thread_interactions (peer_id, group_id, thread_root_event_id, last_interaction_event_id);

      INSERT INTO peer_thread_interactions (
        peer_id,
        group_id,
        thread_root_event_id,
        last_interaction_event_id,
        last_interaction_kind,
        updated_at
      )
      SELECT
        sender_peer_id,
        group_id,
        COALESCE(parent_event_id, event_id) AS thread_root_event_id,
        MAX(event_id) AS last_interaction_event_id,
        'message' AS last_interaction_kind,
        COALESCE(MAX(created_at), strftime('%Y-%m-%dT%H:%M:%fZ','now')) AS updated_at
      FROM events
      WHERE type = 'group_message'
        AND sender_peer_id IS NOT NULL
        AND group_id IS NOT NULL
      GROUP BY sender_peer_id, group_id, COALESCE(parent_event_id, event_id)
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
          END;

      INSERT INTO peer_thread_interactions (
        peer_id,
        group_id,
        thread_root_event_id,
        last_interaction_event_id,
        last_interaction_kind,
        updated_at
      )
      SELECT
        mr.peer_id,
        e.group_id,
        COALESCE(e.parent_event_id, e.event_id) AS thread_root_event_id,
        MAX(e.event_id) AS last_interaction_event_id,
        'reaction' AS last_interaction_kind,
        COALESCE(MAX(mr.created_at), strftime('%Y-%m-%dT%H:%M:%fZ','now')) AS updated_at
      FROM message_reactions mr
      JOIN events e ON e.event_id = mr.event_id
      WHERE e.type = 'group_message'
        AND e.group_id IS NOT NULL
      GROUP BY mr.peer_id, e.group_id, COALESCE(e.parent_event_id, e.event_id)
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
          END;
    `);
    if (!hasPeerThreadInteractionsV15) db.exec(`INSERT OR IGNORE INTO schema_migrations (version) VALUES (15)`);
  }

  // v16 — session annotation lake (sync-nxqo).
  // The parser decodes a host session transcript into one row per annotation
  // (an assistant message explodes into thinking/text/tool_use rows, etc.).
  // session_annotations is the immutable, append-only, per-session corpus
  // ("the lake"); session_annotation_state is the one-row-per-session catalog
  // (the promoted summary.json: locator-join + provenance + rollups + ingest
  // offset). SQLite B-tree indexes on the facet columns ARE the v0 reverse
  // indexes; FTS5/Tantivy/vector are later rungs rebuilt from the lake. `text`
  // is stored inline so LIKE body search needs no join (sync-214a).
  // See session-tracker/plan-unified-session-annotation-v0.md.
  const hasAnnotationsV16 = db
    .query<{ version: number }, []>("SELECT version FROM schema_migrations WHERE version = 16")
    .get();
  const hasSessionAnnotations = db
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session_annotations'")
    .get();
  if (!hasAnnotationsV16 || !hasSessionAnnotations) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS session_annotations (
        binding_id      TEXT NOT NULL REFERENCES agent_sessions(binding_id) ON DELETE CASCADE,
        seq             INTEGER NOT NULL,
        turn_index      INTEGER NOT NULL,
        ts_ms           INTEGER,
        line_number     INTEGER NOT NULL,
        category        TEXT NOT NULL,
        kind            TEXT NOT NULL,
        record_type     TEXT,
        role            TEXT,
        uuid            TEXT,
        parent_uuid     TEXT,
        content_index   INTEGER,
        tool            TEXT,
        normalized_tool TEXT,
        tool_call_id    TEXT,
        tool_server     TEXT,
        source          TEXT,
        is_error        INTEGER,
        summary         TEXT,
        text            TEXT,
        est_tokens      INTEGER,
        data_json       TEXT,
        PRIMARY KEY (binding_id, seq)
      );

      CREATE INDEX IF NOT EXISTS idx_sa_ts    ON session_annotations (binding_id, ts_ms);
      CREATE INDEX IF NOT EXISTS idx_sa_turn  ON session_annotations (binding_id, turn_index);
      CREATE INDEX IF NOT EXISTS idx_sa_kind  ON session_annotations (binding_id, kind);
      CREATE INDEX IF NOT EXISTS idx_sa_tool  ON session_annotations (tool);
      CREATE INDEX IF NOT EXISTS idx_sa_ntool ON session_annotations (normalized_tool);
      CREATE INDEX IF NOT EXISTS idx_sa_cat   ON session_annotations (category);
      CREATE INDEX IF NOT EXISTS idx_sa_role  ON session_annotations (role);

      CREATE TABLE IF NOT EXISTS session_annotation_state (
        binding_id        TEXT PRIMARY KEY REFERENCES agent_sessions(binding_id) ON DELETE CASCADE,
        project           TEXT,
        schema_version    INTEGER NOT NULL,
        parser_version    TEXT NOT NULL,
        content_hash      TEXT,
        annotated_offset  INTEGER NOT NULL DEFAULT 0,
        annotated_lines   INTEGER NOT NULL DEFAULT 0,
        annotation_count  INTEGER NOT NULL DEFAULT 0,
        ts_min            INTEGER,
        ts_max            INTEGER,
        by_category_json  TEXT,
        by_kind_json      TEXT,
        by_tool_json      TEXT,
        diagnostics_count INTEGER NOT NULL DEFAULT 0,
        annotated_at      TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_sas_project ON session_annotation_state (project);
    `);
    if (!hasAnnotationsV16) db.exec(`INSERT OR IGNORE INTO schema_migrations (version) VALUES (16)`);
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
