export const APP_NAME = "synchronize";
export const API_VERSION = 1;
export const DEFAULT_BIND_HOST = "127.0.0.1";
// Stable default port so long-lived clients (Pi extension especially)
// don't need to re-resolve the daemon URL on every restart. Tests still
// pass SYNCHRONIZE_PORT=0 explicitly to get a random free port and avoid
// collisions when many test processes spin up daemons in parallel.
export const DEFAULT_PORT = 58405;
export const DISCOVERY_FILE = "daemon.json";
export const LOCK_DIR = "daemon.lock";
export const DB_FILE = "synchronize.db";
export const MEDIA_DIR = "media";
export const LOG_FILE = "daemon.log";
export const CLI_IDENTITY_FILE = "cli-peer.json";

export const ENV_HOME = "SYNCHRONIZE_HOME";
export const ENV_BIND = "SYNCHRONIZE_BIND";
export const ENV_PORT = "SYNCHRONIZE_PORT";
export const ENV_TOKEN = "SYNCHRONIZE_TOKEN";
export const ENV_STARTED_BY_CLIENT = "SYNCHRONIZE_STARTED_BY_CLIENT";
export const ENV_PEER_ID = "SYNCHRONIZE_PEER_ID";
export const ENV_SESSION_NAME = "SYNCHRONIZE_SESSION_NAME";
export const ENV_HOOK_ENABLE = "SYNCHRONIZE_HOOK_ENABLE";
// Temporary launch-scoped correlation key shared by `synchronize launch`,
// Claude's SessionStart hook, and the spawned synchronize MCP process.
// It is not a durable identity: peer_id remains synchronize's identity and
// host_session_id remains the native Claude/Pi session identity. The daemon
// stores this only so MCP can discover the proactively registered peer before
// bridge_register has run; it should not be used as a session-store key.
export const ENV_LAUNCH_ID = "SYNCHRONIZE_LAUNCH_ID";

export const STARTUP_TIMEOUT_MS = 5_000;
export const HEALTH_TIMEOUT_MS = 500;
export const STALE_LOCK_MS = 30_000;
export const DEFAULT_LEASE_MS = 5 * 60_000;
export const MAX_MESSAGE_CHARS = 16_000;
export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 200;
export const DEFAULT_NOTIFICATION_BUFFER = 100;
export const NOTIFIER_ACTIVE_MS = 500;
export const NOTIFIER_IDLE_MS = 2_000;
export const MCP_HEARTBEAT_MS = 15_000;

// Canonical event types stored on events.type. Adding a new type here also
// requires updating the CHECK constraint in src/db.ts so the daemon stays in
// sync with the schema. Use the EventType union below to make TS callers
// type-safe at insert sites.
export const EVENT_TYPES = [
  "dm",
  "group_created",
  "group_joined",
  "group_left",
  "group_message",
  "media_shared",
  "media_changed",
  "group_member_alias_reclaimed",
  "group_member_renamed",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];
