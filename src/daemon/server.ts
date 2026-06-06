import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { appendFile, copyFile, rm, stat, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import {
  ACTIVITY_STATES,
  type ActivityState,
  MAX_MESSAGE_CHARS,
  MAX_PAGE_LIMIT,
  API_VERSION,
} from "../constants.ts";
import { loadRuntimeConfig, type RuntimeConfig } from "../config.ts";
import { openDatabase, pruneEphemeralGroups } from "../db.ts";
import { applyDaemonEnvFiles } from "../env-files.ts";
import { ensureDir, writeJson } from "../fs.ts";
import { errorResponse, HttpError, jsonResponse } from "../http.ts";
import { getRuntimePaths, type RuntimePaths } from "../paths.ts";
import { collectDaemonProvenance, collectGitContext, type DaemonProvenance } from "../provenance.ts";
import { AoeBackend } from "../launch/backend.ts";
import { LaunchService, LaunchValidationError, aoeAttachCommand, aoeProfileName, aoeTitle, validateLaunchRequest } from "../launch/service.ts";
import { isLaunchTool } from "../launch/build.ts";
import { transitionLaunch, type LaunchLifecycleEvent } from "../launch/lifecycle.ts";
import {
  appendLaunchEvent,
  claimNextLaunchWork,
  completeLaunchWork,
  failLaunchWork,
  getLaunchIntent,
  updateLaunchState,
  type LaunchIntentRow,
} from "../launch/store.ts";
import { runEventQuery } from "../query/events.ts";
import { resolveProviderConfig } from "../llm/index.ts";
import { loadSkillCatalog } from "../skill-catalog.ts";
import {
  defaultStrategyFromEnv,
  getCachedSummary,
  isEnabled as isSummarizeEnabled,
  loadSummaryResponse,
  makeProviderCaller,
  startSummarizeWorker,
  strategyFromInput,
  summarizeThread,
  type WorkerHandle,
} from "../summarize/index.ts";
import type { ReactionSummary, ReplyDestination, SkillCatalogEntry } from "../api/types.ts";
import { assertLanModeIsProtected, requireAuth, resolveBind } from "./auth.ts";
import { mapSqliteConstraint } from "./errors.ts";
import {
  parseSelectorsFromUrl,
  selectThreadEvents,
  selectorLimit,
  selectorToSummaryStrategy,
  type NormalizedSelectors,
} from "./selectors.ts";
import {
  optionalFormString,
  optionalInteger,
  optionalIntegerArray,
  optionalObjectJson,
  optionalReactionOp,
  optionalSqlParams,
  optionalString,
  optionalStringArray,
  parseCursor,
  parseEventIdsParam,
  parseGroupHistoryView,
  parseLimit,
  parseThreadFormat,
  readBody,
  requireEmoji,
  requireGroupName,
  requireLaunchPath,
  requireLocalCallbackUrl,
  requirePositiveInteger,
  requireString,
  type ReactionOp,
} from "./validation.ts";
import { route } from "./routing.ts";

const REPLY_CONTEXT_PREVIEW_WORDS = 30;

export interface DaemonContext {
  paths: RuntimePaths;
  db: Database;
  startedAt: string;
  token: string | null;
  provenance: DaemonProvenance;
  server: Bun.Server<unknown>;
  subscribers: Map<string, EventSubscriber>;
  webStateClients: Set<WebStateClient>;
  stateVersion: number;
  launchService: LaunchService;
  launchWorker: WorkerHandle | null;
  summarizeWorker: WorkerHandle | null;
  skillCatalog: SkillCatalogEntry[];
  // Resolved once at startup (defaults < config.toml < env). Daemon tunables
  // (lease/retention/sweep) read from here instead of import-time constants.
  config: RuntimeConfig;
}

interface DiscoveryFile {
  pid: number;
  host: string;
  port: number;
  baseUrl: string;
  tokenRequired: boolean;
  dbPath: string;
  mediaPath: string;
  startedAt: string;
  provenance: DaemonProvenance;
}

export interface PeerRow {
  peer_id: string;
  tool: string;
  session_name: string;
  purpose: string | null;
  machine_id: string;
  lease_expires_at: string;
  activity_state: string | null;
  last_activity_at: string | null;
  last_cursor: number;
  created_at: string;
  updated_at: string;
}

interface AgentSessionRow {
  binding_id: string;
  peer_id: string;
  host_tool: string;
  host_session_id: string;
  host_session_file: string | null;
  cwd: string | null;
  git_branch: string | null;
  git_dirty: boolean | null;
  pid: number | null;
  source: string | null;
  model: string | null;
  agent_type: string | null;
  metadata_json: string | null;
  launch_id: string | null;
  created_at: string;
  updated_at: string;
  last_seen_at: string;
}

interface AgentSessionJoinedRow extends AgentSessionRow {
  peer_tool: string;
  peer_session_name: string;
  peer_purpose: string | null;
  peer_lease_expires_at: string;
  peer_online: number;
  peer_activity_state: string | null;
}

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

interface MentionWarning {
  token: string;
  reason: "alias_not_in_group";
}

interface EventSubscriber {
  peer_id: string;
  callback_url: string;
  token: string;
  created_at: string;
}

interface WebStateClient {
  id: string;
  send(change: WebStateChange): void;
}

interface WebStateChange {
  cursor: number;
  type: "connected" | "state_changed";
  domains: string[];
  event_id?: number;
  group_id?: number | null;
  peer_id?: string | null;
}

const WEB_PEER_LEASE_EXPIRES_AT = "9999-12-31T23:59:59.999Z";
const LOCAL_WEB_PEER_ID = "web:local-human";
const LOCAL_WEB_SESSION_NAME = "web-ui";
const LOCAL_WEB_PURPOSE = "local human web participant";

export interface InboxRow extends EventRow {
  delivered_at: string | null;
  read_at: string | null;
  acked_at: string | null;
}

// Row for the read-only web Activity feed: the standard event columns plus a
// thread reply count and an explicit `awaiting` flag (1 when the event is in the
// observer's inbox and un-acked). The endpoint never mutates delivery/read state.
// `awaiting` is computed in SQL — under the LEFT JOIN, a null acked_at is
// ambiguous (no inbox row vs. unacked row), so we never derive awaiting from
// acked_at on the client.
export interface ActivityRow extends EventRow {
  group_name: string | null;
  reply_count: number;
  acked_at: string | null;
  awaiting: number;
}

export interface GroupRow {
  group_id: number;
  name: string;
  durable: number;
  media_dir: string;
  creator_peer_id: string | null;
  description: string | null;
  created_at: string;
}

interface GroupPathRow {
  path_id: number;
  group_id: number;
  path: string;
  label: string | null;
  active: number;
  created_at: string;
}

export interface MediaRow {
  media_id: string;
  group_id: number;
  original_path: string;
  copied_path: string;
  size_bytes: number;
  sha256: string;
  content_type: string;
  description: string | null;
  shared_by_peer_id: string;
  created_at: string;
}

export interface MemberRow {
  group_id: number;
  peer_id: string;
  alias: string;
  join_event_id: number | null;
  history_from_event_id: number | null;
  active: number;
  purpose: string | null;
  joined_at: string;
  left_at: string | null;
  session_name: string;
  tool: string;
  activity_state: string | null;
  host_session_id: string | null;
}

export interface SummaryPeerRow {
  peer_id: string;
  session_name: string;
  tool: string;
  purpose: string | null;
  online: number;
  activity_state: string | null;
  pending_inbox: number;
  groups: number;
  updated_at: string;
  host_session_id: string | null;
}

export interface SummaryGroupRow {
  name: string;
  durable: number;
  members: number;
  online_members: number;
  messages: number;
  media: number;
  last_activity_at: string | null;
}

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

export function log(message: string): void {
  console.error(`[synchronize-daemon] ${message}`);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}


// Normalize Slack-style thread parents to a single level: a reply to a reply
// collapses to the original thread root. Returns the root event_id (always
// the root, never a leaf), or throws if in_reply_to is not a visible event in
// this group.
export function resolveThreadParent(db: Database, groupId: number, inReplyTo: number): number {
  const target = db
    .query<{ event_id: number; group_id: number | null; parent_event_id: number | null; type: string }, [number]>(
      "SELECT event_id, group_id, parent_event_id, type FROM events WHERE event_id = ?",
    )
    .get(inReplyTo);
  if (!target || target.group_id !== groupId) {
    throw new HttpError(404, "reply_target_not_found", `No such event in group: ${inReplyTo}`);
  }
  // Reject replies to non-message roster events (group_joined, group_left,
  // group_member_renamed, group_member_alias_reclaimed, group_created,
  // media_*). Bob flagged in the sustained-thread review that the spec
  // didn't say what happens here — answer: it shouldn't be allowed, since
  // those events have no "reply" semantic and routing rules (root_author
  // ∪ thread_posters) become meaningless.
  if (target.type !== "group_message") {
    throw new HttpError(
      400,
      "reply_target_not_message",
      `Cannot reply to event ${inReplyTo}: type is '${target.type}', not 'group_message'`,
    );
  }
  return target.parent_event_id ?? target.event_id;
}

const MENTION_TOKEN_RE = /@([a-zA-Z0-9][a-zA-Z0-9._:-]*)/g;
const MENTION_TRAILING_PUNCTUATION_RE = /[.,;:!?]+$/;

function normalizeMentionToken(token: string): string {
  return token.replace(MENTION_TRAILING_PUNCTUATION_RE, "");
}

// Strip backtick-fenced regions (`...`, ``...``, and ```...```) before mention parsing.
// Alice flagged this during the sustained-thread test: discussing proposed
// syntax like `@peer:<uuid>` in prose produced false-positive
// alias_not_in_group warnings for `@peer` / `@id` / `@alias`. Treating
// backticked spans as code-not-prose mirrors how a reader interprets them.
function stripBacktickedRegions(message: string): string {
  // Fenced (```...```) first, then double (``...``), then single (`...`).
  // Replace with spaces of matching length so character positions don't shift
  // (cheap correctness hedge in case anything downstream cares about positions).
  const withoutFenced = message.replace(/```[\s\S]*?```/g, (m) => " ".repeat(m.length));
  const withoutDouble = withoutFenced.replace(/``[\s\S]*?``/g, (m) => " ".repeat(m.length));
  return withoutDouble.replace(/`[^`]*`/g, (m) => " ".repeat(m.length));
}

// Resolve @-mentions in a message body against the active member roster of
// the group. Returns deduped resolved peer_ids and a warning per unresolved
// token (no-op tokens, e.g. "@self", still warn — the daemon does not
// special-case the sender). Send still succeeds; warnings are advisory.
export function resolveMentions(
  db: Database,
  groupId: number,
  message: string,
): { peerIds: string[]; warnings: MentionWarning[] } {
  const tokens = new Set<string>();
  const scannable = stripBacktickedRegions(message);
  for (const match of scannable.matchAll(MENTION_TOKEN_RE)) {
    if (match[1]) {
      const token = normalizeMentionToken(match[1]);
      if (token) tokens.add(token);
    }
  }
  if (tokens.size === 0) return { peerIds: [], warnings: [] };
  const lookup = db.query<{ peer_id: string }, [number, string]>(
    "SELECT peer_id FROM group_members WHERE group_id = ? AND active = 1 AND alias = ?",
  );
  const peerIds: string[] = [];
  const warnings: MentionWarning[] = [];
  for (const token of tokens) {
    const row = lookup.get(groupId, token);
    if (row) {
      peerIds.push(row.peer_id);
      continue;
    }
    const normalizedToken = normalizeMentionToken(token);
    const normalizedRow = normalizedToken !== token && normalizedToken ? lookup.get(groupId, normalizedToken) : null;
    if (normalizedRow) peerIds.push(normalizedRow.peer_id);
    else warnings.push({ token: `@${normalizedToken || token}`, reason: "alias_not_in_group" });
  }
  return { peerIds, warnings };
}

// Members of a thread for push fanout: the root author plus every distinct
// peer who has posted into the thread so far (the new reply has not yet been
// inserted at the time this is called). Excludes the current sender; callers
// union in this-message mentions separately.
export function computeThreadParticipants(db: Database, rootEventId: number, sender: string): string[] {
  const rows = db
    .query<{ peer_id: string }, [number, number]>(
      `SELECT DISTINCT sender_peer_id AS peer_id FROM events
       WHERE (event_id = ? OR parent_event_id = ?) AND sender_peer_id IS NOT NULL`,
    )
    .all(rootEventId, rootEventId);
  return rows.map((row) => row.peer_id).filter((peerId) => peerId !== sender);
}

// Roster events (group_joined / group_left / group_member_renamed /
// group_member_alias_reclaimed) land in every active member's inbox for
// durable visibility but never push. Excludes the actor.
export function fanoutRosterEventToInbox(db: Database, groupId: number, eventId: number, actor: string): void {
  const recipients = db
    .query<{ peer_id: string }, [number, string]>(
      "SELECT peer_id FROM group_members WHERE group_id = ? AND active = 1 AND peer_id != ?",
    )
    .all(groupId, actor);
  const insertInbox = db.query("INSERT OR IGNORE INTO inbox (recipient_peer_id, event_id) VALUES (?, ?)");
  for (const recipient of recipients) insertInbox.run(recipient.peer_id, eventId);
}

export function getPeer(db: Database, peerId: string): PeerRow {
  const peer = db
    .query<PeerRow, [string]>("SELECT * FROM peers WHERE peer_id = ? AND deleted_at IS NULL")
    .get(peerId);
  if (!peer) throw new HttpError(404, "peer_not_found", `Peer not found: ${peerId}`);
  return peer;
}

export function ensurePeer(db: Database, peerId: string): void {
  getPeer(db, peerId);
}

export function ensureLocalWebPeer(ctx: DaemonContext): PeerRow {
  upsertPeer(ctx.db, {
    peerId: LOCAL_WEB_PEER_ID,
    tool: "web",
    sessionName: LOCAL_WEB_SESSION_NAME,
    purpose: LOCAL_WEB_PURPOSE,
    machineId: hostname(),
    leaseExpiresAt: WEB_PEER_LEASE_EXPIRES_AT,
  });
  return getPeer(ctx.db, LOCAL_WEB_PEER_ID);
}

function deactivateWebAliasHolders(db: Database, groupId: number, alias: string, peerId: string): void {
  db.query(
    `UPDATE group_members
     SET active = 0,
         left_at = COALESCE(left_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     WHERE group_id = ?
       AND alias = ?
       AND active = 1
       AND peer_id != ?
       AND peer_id IN (SELECT peer_id FROM peers WHERE tool = 'web')`,
  ).run(groupId, alias, peerId);
}

export function leaseExpiresAtForTool(tool: string, leaseMs: number): string {
  return tool === "web" ? WEB_PEER_LEASE_EXPIRES_AT : new Date(Date.now() + leaseMs).toISOString();
}

// Presence derivation — the single rule applied wherever a peer is serialized.
// Offline if the lease has lapsed (the only reliable crash detector); else the
// reported activity_state for instrumented agents; else a generic "online" for
// uninstrumented peers (web/cli/codex). See plan-agent-ttl-presence-v0.md.
type Presence = "offline" | "online" | ActivityState;
export function derivePresence(online: boolean, activityState: string | null): Presence {
  if (!online) return "offline";
  if (activityState && (ACTIVITY_STATES as readonly string[]).includes(activityState)) {
    return activityState as ActivityState;
  }
  return "online";
}

// Agents (pi/claude) start at "initializing" and stay there until their first
// activity push. Uninstrumented tools (web/cli/codex) keep NULL → generic
// online. Applied only on first INSERT; re-register/resurrect preserves any
// existing state (see upsertPeer COALESCE).
function initialActivityState(tool: string): ActivityState | null {
  return tool === "pi" || tool === "claude" ? "initializing" : null;
}

// Retention sweeper — soft-deletes peers whose lease has been expired for
// longer than PEER_RETENTION_MS. Offline (lease-lapsed) peers stay visible in
// the roster for the retention window (useful for "who was here" + reclaim
// audit); past it they are hidden via the same soft-delete path as the manual
// operator evict (deleted_at + group_members deactivated), preserving the audit
// trail. web peers (lease year-9999) never match the cutoff. Resume after a
// sweep resurrects the same peer via findPeerByHostSession + upsertPeer's
// `deleted_at = NULL` path.
function sweepExpiredPeers(ctx: DaemonContext): void {
  const retentionMs = ctx.config.daemon.peerRetentionMs;
  const cutoff = new Date(Date.now() - retentionMs).toISOString();
  const swept = ctx.db.transaction(() => {
    const rows = ctx.db
      .query<{ peer_id: string }, [string]>(
        "SELECT peer_id FROM peers WHERE deleted_at IS NULL AND lease_expires_at < ?",
      )
      .all(cutoff);
    const now = new Date().toISOString();
    for (const { peer_id } of rows) {
      ctx.db.query("UPDATE peers SET deleted_at = ? WHERE peer_id = ?").run(now, peer_id);
      ctx.db
        .query("UPDATE group_members SET active = 0, left_at = COALESCE(left_at, ?) WHERE peer_id = ? AND active = 1")
        .run(now, peer_id);
      ctx.subscribers.delete(peer_id);
    }
    return rows.map((row) => row.peer_id);
  })();
  if (swept.length > 0) {
    log(`sweeper soft-deleted ${swept.length} peer(s) lease-expired > ${retentionMs}ms`);
    emitWebStateChanged(ctx, { domains: ["peers", "groups"] });
  }
}

export function softDeletePeerIfPresent(
  ctx: Pick<DaemonContext, "db" | "subscribers">,
  peerId: string,
  deletedAt = new Date().toISOString(),
): boolean {
  const exists = ctx.db
    .query<{ count: number }, [string]>(
      "SELECT COUNT(*) AS count FROM peers WHERE peer_id = ? AND deleted_at IS NULL",
    )
    .get(peerId)?.count ?? 0;
  if (exists === 0) return false;
  ctx.db.transaction(() => {
    ctx.db
      .query("UPDATE peers SET deleted_at = ?, lease_expires_at = ?, updated_at = ? WHERE peer_id = ? AND deleted_at IS NULL")
      .run(deletedAt, deletedAt, deletedAt, peerId);
    ctx.db
      .query("UPDATE group_members SET active = 0, left_at = COALESCE(left_at, ?) WHERE peer_id = ? AND active = 1")
      .run(deletedAt, peerId);
  })();
  ctx.subscribers.delete(peerId);
  return true;
}

export function deactivateStoppedLaunchPeer(ctx: DaemonContext, peerId: string): boolean {
  return softDeletePeerIfPresent(ctx, peerId);
}

function sweepStoppedLaunchPeers(ctx: DaemonContext): number {
  const rows = ctx.db
    .query<{ peer_id: string }, []>(
      `SELECT DISTINCT li.peer_id
       FROM launch_intents li
       JOIN peers p ON p.peer_id = li.peer_id
       WHERE li.state = 'stopped'
         AND p.deleted_at IS NULL`,
    )
    .all();
  if (rows.length === 0) return 0;
  const deletedAt = new Date().toISOString();
  let deactivated = 0;
  for (const row of rows) {
    if (softDeletePeerIfPresent(ctx, row.peer_id, deletedAt)) deactivated += 1;
  }
  if (deactivated > 0) {
    log(`launch cleanup soft-deleted ${deactivated} stopped launch peer(s)`);
    emitWebStateChanged(ctx, { domains: ["peers", "groups", "agent_sessions"] });
  }
  return deactivated;
}

export function upsertPeer(
  db: Database,
  input: {
    peerId: string;
    tool: string;
    sessionName: string;
    purpose: string | null;
    machineId: string;
    leaseExpiresAt: string;
  },
): void {
  // ON CONFLICT path also clears deleted_at — re-registering with a known
  // peer_id resurrects a soft-deleted peer. The companion fixup below
  // re-activates any group_members rows the peer still owns so a returning
  // peer rejoins their old groups rather than having to re-issue join calls
  // (which would fail with alias-taken if anyone reclaimed in the interim —
  // resurrection is symmetric with the deletion that preceded it).
  // Capture any prior soft-delete timestamp BEFORE the upsert clears it, so we
  // can tell whether this register is a resurrection (and which group_members
  // rows that death deactivated — see reactivateMembershipsOnResurrect).
  const priorDeletedAt =
    db
      .query<{ deleted_at: string | null }, [string]>("SELECT deleted_at FROM peers WHERE peer_id = ?")
      .get(input.peerId)?.deleted_at ?? null;

  // activity_state is set only on first INSERT (initializing for agents, NULL
  // for uninstrumented tools). On re-register/resurrect we COALESCE so an
  // existing working/idle state is preserved — a heartbeat-driven re-register
  // or a resume must not reset a live agent back to initializing.
  db.query(
    `INSERT INTO peers (peer_id, tool, session_name, purpose, machine_id, lease_expires_at, activity_state)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(peer_id) DO UPDATE SET
       tool = excluded.tool,
       session_name = excluded.session_name,
       purpose = excluded.purpose,
       machine_id = excluded.machine_id,
       lease_expires_at = excluded.lease_expires_at,
       activity_state = COALESCE(activity_state, excluded.activity_state),
       deleted_at = NULL,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
  ).run(
    input.peerId,
    input.tool,
    input.sessionName,
    input.purpose,
    input.machineId,
    input.leaseExpiresAt,
    initialActivityState(input.tool),
  );

  if (priorDeletedAt) reactivateMembershipsOnResurrect(db, input.peerId, priorDeletedAt);
}

// Restore the group memberships that a soft-delete (operator evict or retention
// sweep) deactivated, when the peer re-registers. Both delete paths set
// group_members.left_at to the SAME timestamp as peers.deleted_at, so rows with
// left_at == the cleared deleted_at are exactly the ones killed by that death —
// this distinguishes a death-deactivation from an earlier voluntary leave
// (which carries an older left_at and must stay inactive). An alias reclaimed by
// someone else during the gap is skipped so the unique-active-alias invariant
// holds. Without this, a revived peer is online but silent in all its groups
// (sync-3nu). The structural alternative (derive active from lease) is sync-<A>.
function reactivateMembershipsOnResurrect(db: Database, peerId: string, deathTimestamp: string): void {
  db.query(
    `UPDATE group_members
     SET active = 1, left_at = NULL
     WHERE peer_id = ? AND active = 0 AND left_at = ?
       AND NOT EXISTS (
         SELECT 1 FROM group_members other
         WHERE other.group_id = group_members.group_id
           AND other.alias = group_members.alias
           AND other.active = 1
           AND other.peer_id != group_members.peer_id
       )`,
  ).run(peerId, deathTimestamp);
}

export function findPeerByHostSession(db: Database, hostTool: string, hostSessionId: string): string | undefined {
  return db
    .query<{ peer_id: string }, [string, string]>(
      "SELECT peer_id FROM agent_sessions WHERE host_tool = ? AND host_session_id = ?",
    )
    .get(hostTool, hostSessionId)?.peer_id;
}

export function findPeerByRequiredHostSession(db: Database, hostTool: string, hostSessionId: string): string {
  const peerId = findPeerByHostSession(db, hostTool, hostSessionId);
  if (!peerId) {
    throw new HttpError(404, "agent_session_not_found", `Agent session not found: ${hostTool}/${hostSessionId}`);
  }
  return peerId;
}

export function listAgentSessions(
  db: Database,
  input: { hostTool: string | null; peerId: string | null; launchId?: string | null },
): ReturnType<typeof formatAgentSession>[] {
  const now = new Date().toISOString();
  if (input.launchId) {
    return db
      .query<AgentSessionJoinedRow, [string, string]>(
        `${agentSessionSelectSql()} WHERE s.launch_id = ? ORDER BY s.updated_at DESC`,
      )
      .all(now, input.launchId)
      .map(formatAgentSession);
  }
  if (input.hostTool && input.peerId) {
    return db
      .query<AgentSessionJoinedRow, [string, string, string]>(
        `${agentSessionSelectSql()} WHERE s.host_tool = ? AND s.peer_id = ? ORDER BY s.updated_at DESC`,
      )
      .all(now, input.hostTool, input.peerId)
      .map(formatAgentSession);
  }
  if (input.hostTool) {
    return db
      .query<AgentSessionJoinedRow, [string, string]>(
        `${agentSessionSelectSql()} WHERE s.host_tool = ? ORDER BY s.updated_at DESC`,
      )
      .all(now, input.hostTool)
      .map(formatAgentSession);
  }
  if (input.peerId) {
    return db
      .query<AgentSessionJoinedRow, [string, string]>(
        `${agentSessionSelectSql()} WHERE s.peer_id = ? ORDER BY s.updated_at DESC`,
      )
      .all(now, input.peerId)
      .map(formatAgentSession);
  }
  return db
    .query<AgentSessionJoinedRow, [string]>(`${agentSessionSelectSql()} ORDER BY s.updated_at DESC`)
    .all(now)
    .map(formatAgentSession);
}

export function getAgentSessionByHost(db: Database, hostTool: string, hostSessionId: string): ReturnType<typeof formatAgentSession> {
  const now = new Date().toISOString();
  const row = db
    .query<AgentSessionJoinedRow, [string, string, string]>(
      `${agentSessionSelectSql()} WHERE s.host_tool = ? AND s.host_session_id = ?`,
    )
    .get(now, hostTool, hostSessionId);
  if (!row) throw new HttpError(404, "agent_session_not_found", `Agent session not found: ${hostTool}/${hostSessionId}`);
  return formatAgentSession(row);
}

export function getAgentSessionByPeer(db: Database, peerId: string): ReturnType<typeof formatAgentSession> {
  const now = new Date().toISOString();
  const row = db
    .query<AgentSessionJoinedRow, [string, string]>(
      `${agentSessionSelectSql()} WHERE s.peer_id = ? ORDER BY s.updated_at DESC LIMIT 1`,
    )
    .get(now, peerId);
  if (!row) throw new HttpError(404, "agent_session_not_found", `Agent session not found for peer: ${peerId}`);
  return formatAgentSession(row);
}

function agentSessionSelectSql(): string {
  return `SELECT
      s.*,
      p.tool AS peer_tool,
      p.session_name AS peer_session_name,
      p.purpose AS peer_purpose,
      p.lease_expires_at AS peer_lease_expires_at,
      p.activity_state AS peer_activity_state,
      p.lease_expires_at > ? AS peer_online
    FROM agent_sessions s
    JOIN peers p ON p.peer_id = s.peer_id`;
}

function formatAgentSession(
  row: AgentSessionJoinedRow,
): AgentSessionRow & { peer: PeerRow & { online: boolean; presence: Presence } } {
  return {
    binding_id: row.binding_id,
    peer_id: row.peer_id,
    host_tool: row.host_tool,
    host_session_id: row.host_session_id,
    host_session_file: row.host_session_file,
    cwd: row.cwd,
    git_branch: row.git_branch,
    git_dirty: row.git_dirty === null ? null : Boolean(row.git_dirty),
    pid: row.pid,
    source: row.source,
    model: row.model,
    agent_type: row.agent_type,
    metadata_json: row.metadata_json,
    launch_id: row.launch_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_seen_at: row.last_seen_at,
    peer: {
      peer_id: row.peer_id,
      tool: row.peer_tool,
      session_name: row.peer_session_name,
      purpose: row.peer_purpose,
      machine_id: "",
      lease_expires_at: row.peer_lease_expires_at,
      activity_state: row.peer_activity_state,
      last_activity_at: null,
      last_cursor: 0,
      created_at: "",
      updated_at: "",
      online: Boolean(row.peer_online),
      presence: derivePresence(Boolean(row.peer_online), row.peer_activity_state),
    },
  };
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

export function buildReplyDestination(db: Database, directEvent: EventRow | null, createdEvent: EventRow): ReplyDestination {
  const directSender = directEvent ? describeEventSender(db, directEvent) : { peerId: null, display: null };
  const base = {
    direct_event_id: directEvent?.event_id ?? null,
    direct_sender_peer_id: directSender.peerId,
    direct_sender: directSender.display,
    direct_preview: directEvent ? previewEventBody(directEvent) : null,
  };

  if (createdEvent.type === "dm") {
    return { surface: "dm", ...base };
  }

  if (createdEvent.group_id === null) {
    return { surface: "group_main", ...base };
  }

  const group = getGroupById(db, createdEvent.group_id);
  if (createdEvent.parent_event_id === null) {
    return {
      surface: "group_main",
      ...base,
      group_id: group.group_id,
      group_name: group.name,
    };
  }

  const root = getEvent(db, createdEvent.parent_event_id);
  const rootSender = describeEventSender(db, root);
  return {
    surface: "thread",
    ...base,
    group_id: group.group_id,
    group_name: group.name,
    thread_root_event_id: root.event_id,
    thread_root_sender_peer_id: rootSender.peerId,
    thread_root_sender: rootSender.display,
    thread_root_preview: previewEventBody(root),
  };
}

function describeEventSender(db: Database, event: EventRow): { peerId: string | null; display: string | null } {
  if (!event.sender_peer_id) return { peerId: null, display: null };
  const row = db
    .query<{ session_name: string; alias: string | null }, [number | null, string]>(
      `SELECT p.session_name, gm.alias
       FROM peers p
       LEFT JOIN group_members gm ON gm.peer_id = p.peer_id AND gm.group_id = ?
       WHERE p.peer_id = ?`,
    )
    .get(event.group_id, event.sender_peer_id);
  return {
    peerId: event.sender_peer_id,
    display: row?.alias ?? row?.session_name ?? event.sender_peer_id,
  };
}

function previewEventBody(event: EventRow): string | null {
  if (event.body === null) return null;
  const words = event.body.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  const preview = words.slice(0, REPLY_CONTEXT_PREVIEW_WORDS).join(" ");
  return words.length > REPLY_CONTEXT_PREVIEW_WORDS ? `${preview}...` : preview;
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

export async function loadThreadSummaryProjection(
  ctx: DaemonContext,
  rootEventId: number,
  selectors: NormalizedSelectors,
): Promise<Record<string, unknown>> {
  // Validate that this is a thread root before any cache/provider work.
  const root = getEvent(ctx.db, rootEventId);
  if (root.group_id === null || root.parent_event_id !== null || root.type !== "group_message") {
    throw new HttpError(400, "thread_of_not_root", `Event ${rootEventId} is not a thread root`);
  }
  const cached = getCachedSummary(ctx.db, rootEventId);
  const cfg = resolveProviderConfig();
  if (!cached && cfg) {
    await summarizeThread(ctx.db, makeProviderCaller(cfg), rootEventId, { strategy: selectorToSummaryStrategy(selectors) });
  }
  const response = loadSummaryResponse(ctx.db, rootEventId, Boolean(cached || cfg));
  return {
    format: "summary",
    selectors,
    summary: response.summary,
    summary_status: response.status,
    stale: response.stale,
    covered_last_event_id: response.covered_last_event_id,
    covered_event_count: response.covered_event_count,
    selected_event_count: response.covered_event_count,
    ...(response.status === "disabled"
      ? { fallback: { suggested_format: "transcript", selectors } }
      : {}),
  };
}

export function emitWebStateChanged(
  ctx: DaemonContext,
  input: { domains: string[]; eventId?: number; groupId?: number | null; peerId?: string | null },
): void {
  ctx.stateVersion += 1;
  const change: WebStateChange = {
    cursor: input.eventId ?? ctx.db.query<{ cursor: number | null }, []>("SELECT MAX(event_id) AS cursor FROM events").get()?.cursor ?? ctx.stateVersion,
    type: "state_changed",
    domains: input.domains,
    ...(input.eventId !== undefined ? { event_id: input.eventId } : {}),
    ...(input.groupId !== undefined ? { group_id: input.groupId } : {}),
    ...(input.peerId !== undefined ? { peer_id: input.peerId } : {}),
  };
  for (const client of [...ctx.webStateClients]) client.send(change);
}

export function openWebEvents(ctx: DaemonContext): Response {
  const encoder = new TextEncoder();
  const id = crypto.randomUUID();
  let cleanup: (() => void) | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string) => controller.enqueue(encoder.encode(chunk));
      const client: WebStateClient = {
        id,
        send(change) {
          try {
            write(formatSse(change));
          } catch {
            ctx.webStateClients.delete(client);
          }
        },
      };
      const heartbeat = setInterval(() => {
        try {
          write(`: heartbeat ${new Date().toISOString()}\n\n`);
        } catch {
          ctx.webStateClients.delete(client);
          clearInterval(heartbeat);
        }
      }, 15_000);
      cleanup = () => {
        clearInterval(heartbeat);
        ctx.webStateClients.delete(client);
      };
      ctx.webStateClients.add(client);
      client.send({ cursor: ctx.stateVersion, type: "connected", domains: [] });
    },
    cancel() {
      cleanup?.();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}

function formatSse(change: WebStateChange): string {
  return [
    `id: ${change.cursor}`,
    `event: ${change.type}`,
    `data: ${JSON.stringify(change)}`,
    "",
    "",
  ].join("\n");
}

interface WebStateResponse {
  ok: true;
  generated_at: string;
  cursor: number;
  daemon: {
    pid: number;
    base_url: string;
    started_at: string;
    token_required: boolean;
  };
  launch_tools: Record<"claude" | "pi", WebLaunchToolStatus>;
  launch_lifecycle: WebLaunchLifecycleRow[];
  peers: Array<PeerRow & { online: boolean; aoe_session?: WebAoeSession }>;
  groups: FormattedGroup[];
  group_paths: FormattedGroupPath[];
  memberships: Array<FormattedMember & { online: boolean }>;
  room_summaries: WebRoomSummary[];
  events: WebEventRow[];
  media: MediaRow[];
  skill_catalog: SkillCatalogEntry[];
}

type WebLaunchLifecycleRow = Pick<
  LaunchIntentRow,
  | "launch_id"
  | "peer_id"
  | "tool"
  | "session_name"
  | "alias"
  | "cwd"
  | "target_group"
  | "backend_profile"
  | "backend_title"
  | "state"
  | "failure_code"
  | "failure_message"
  | "created_at"
  | "updated_at"
  | "accepted_at"
  | "spawned_at"
  | "prompt_seen_at"
  | "prompt_accepted_at"
  | "registered_at"
  | "reconciled_at"
  | "joined_at"
  | "stale_at"
  | "failed_at"
  | "stopped_at"
>;

interface WebAoeSession {
  profile: string;
  title: string;
  attach_command: string;
}

interface WebLaunchToolStatus {
  tool: "claude" | "pi";
  available: boolean;
  path?: string;
}

interface WebRoomSummary {
  group_id: number;
  last_event_id: number | null;
  last_event_at: string | null;
  last_preview: string | null;
  message_count: number;
}

type WebEventRow = EventRow & {
  reply_count: number;
  last_reply_event_id: number | null;
  delivered_count: number;
  read_count: number;
  acked_count: number;
};

export function buildWebState(ctx: DaemonContext, url: URL): WebStateResponse {
  const now = new Date().toISOString();
  const limit = parseLimit(url.searchParams.get("limit"));
  const since = parseCursor(url.searchParams.get("since"));
  const room = url.searchParams.get("room");
  const webPeerId = url.searchParams.get("peer_id");
  const cursor = ctx.db.query<{ cursor: number | null }, []>("SELECT MAX(event_id) AS cursor FROM events").get()?.cursor ?? 0;
  const aoeProfile = aoeProfileName(ctx.paths.home);
  const launchLifecycle = ctx.db
    .query<WebLaunchLifecycleRow, []>(
      `SELECT launch_id, peer_id, tool, session_name, alias, cwd, target_group,
              backend_profile, backend_title, state, failure_code, failure_message,
              created_at, updated_at, accepted_at, spawned_at, prompt_seen_at,
              prompt_accepted_at, registered_at, reconciled_at, joined_at,
              stale_at, failed_at, stopped_at
       FROM launch_intents
       ORDER BY created_at DESC
       LIMIT 200`,
    )
    .all();
  const peers = ctx.db
    .query<PeerRow & { online: number }, [string]>(
      `SELECT peer_id, tool, session_name, purpose, machine_id, lease_expires_at,
              activity_state, last_activity_at,
              last_cursor, created_at, updated_at, lease_expires_at > ? AS online
       FROM peers
       WHERE deleted_at IS NULL
       ORDER BY updated_at DESC, session_name ASC`,
    )
    .all(now)
    .map((peer) => ({
      ...peer,
      online: Boolean(peer.online),
      presence: derivePresence(Boolean(peer.online), peer.activity_state),
    }))
    .map((peer) => {
      const aoeSession = deriveAoeSessionForPeer(ctx.db, peer.peer_id, aoeProfile);
      return aoeSession ? { ...peer, aoe_session: aoeSession } : peer;
    });
  const groups = ctx.db
    .query<GroupRow, []>("SELECT * FROM groups ORDER BY name ASC")
    .all()
    .map(formatGroup);
  const groupPaths = ctx.db
    .query<GroupPathRow, []>("SELECT * FROM group_paths WHERE active = 1 ORDER BY group_id ASC, path ASC")
    .all()
    .map(formatGroupPath);
  const memberships = ctx.db
    .query<MemberRow & { online: number }, [string]>(
      `SELECT ${MEMBER_SELECT_SQL}, p.lease_expires_at > ? AS online
       FROM group_members gm
       JOIN peers p ON p.peer_id = gm.peer_id
       WHERE gm.active = 1
         AND p.deleted_at IS NULL
       ORDER BY gm.group_id ASC, gm.alias ASC`,
    )
    .all(now)
    .map((member) => ({
      ...member,
      active: Boolean(member.active),
      online: Boolean(member.online),
      presence: derivePresence(Boolean(member.online), member.activity_state),
    }));
  const roomSummaries = ctx.db
    .query<WebRoomSummary, []>(
      `SELECT
         g.group_id,
         MAX(e.event_id) AS last_event_id,
         MAX(e.created_at) AS last_event_at,
         (SELECT body FROM events latest
          WHERE latest.group_id = g.group_id AND latest.parent_event_id IS NULL
          ORDER BY latest.event_id DESC LIMIT 1) AS last_preview,
         COUNT(CASE WHEN e.type = 'group_message' AND e.parent_event_id IS NULL THEN 1 END) AS message_count
       FROM groups g
       LEFT JOIN events e ON e.group_id = g.group_id
       GROUP BY g.group_id
       ORDER BY last_event_id DESC, g.name ASC`,
    )
    .all();
  const events = readWebRoomEvents(ctx, { room, since, limit, webPeerId });
  const media = readWebRoomMedia(ctx, { room, limit });
  // A soft-deleted (evicted / lease-lapsed) peer can still be the author of
  // historical events. The active `peers` directory above excludes deleted peers
  // (correct for the live roster), but the web client resolves an event's sender
  // by looking it up in `peers` — so without the author present the message
  // renders authorless/blank and effectively disappears. Re-include any
  // sender/recipient referenced by the returned events that is not already in the
  // active list (bounded to this room's referenced peers), so durable messages
  // stay visible after their author is evicted. The roster/memberships queries are
  // intentionally left filtered — this only feeds identity resolution.
  const knownPeerIds = new Set(peers.map((peer) => peer.peer_id));
  const referencedPeerIds = new Set<string>();
  for (const event of events) {
    if (event.sender_peer_id && !knownPeerIds.has(event.sender_peer_id)) referencedPeerIds.add(event.sender_peer_id);
    if (event.recipient_peer_id && !knownPeerIds.has(event.recipient_peer_id)) referencedPeerIds.add(event.recipient_peer_id);
  }
  const extraPeers = [...referencedPeerIds].flatMap((peerId) => {
    const row = ctx.db
      .query<PeerRow & { online: number }, [string, string]>(
        `SELECT peer_id, tool, session_name, purpose, machine_id, lease_expires_at,
                activity_state, last_activity_at, last_cursor, created_at, updated_at,
                lease_expires_at > ? AS online
         FROM peers WHERE peer_id = ?`,
      )
      .get(now, peerId);
    if (!row) return [];
    return [{ ...row, online: Boolean(row.online), presence: derivePresence(Boolean(row.online), row.activity_state) }];
  });
  return {
    ok: true,
    generated_at: now,
    cursor,
    daemon: {
      pid: process.pid,
      base_url: `http://${ctx.server.hostname}:${ctx.server.port}`,
      started_at: ctx.startedAt,
      token_required: Boolean(ctx.token),
    },
    launch_tools: launchToolStatus(),
    launch_lifecycle: launchLifecycle,
    peers: [...peers, ...extraPeers],
    groups,
    group_paths: groupPaths,
    memberships,
    room_summaries: roomSummaries,
    events,
    media,
    skill_catalog: ctx.skillCatalog,
  };
}

function launchToolStatus(): Record<"claude" | "pi", WebLaunchToolStatus> {
  return {
    claude: launchToolStatusFor("claude"),
    pi: launchToolStatusFor("pi"),
  };
}

function startLaunchWorker(ctx: DaemonContext): WorkerHandle {
  const workerId = `launch-worker:${process.pid}:${crypto.randomUUID().slice(0, 8)}`;
  const pollIntervalMs = positiveEnvInt("SYNCHRONIZE_LAUNCH_WORKER_POLL_MS", 500);
  const leaseMs = positiveEnvInt("SYNCHRONIZE_LAUNCH_WORKER_LEASE_MS", 60_000);
  const batchSize = positiveEnvInt("SYNCHRONIZE_LAUNCH_WORKER_BATCH_SIZE", 4);
  let stopped = false;
  let ticking = false;
  recoverLocalLaunchWork(ctx.db);

  async function tick(): Promise<{ summarized: number; skipped: number; errors: number }> {
    if (ticking) return { summarized: 0, skipped: 1, errors: 0 };
    ticking = true;
    let handled = 0;
    let skipped = 0;
    let errors = 0;
    try {
      for (let index = 0; index < batchSize; index += 1) {
        const now = new Date();
        const work = claimNextLaunchWork(ctx.db, {
          workerId,
          now: now.toISOString(),
          leaseExpiresAt: new Date(now.getTime() + leaseMs).toISOString(),
        });
        if (!work) {
          skipped += 1;
          break;
        }
        try {
          if (work.kind === "spawn" || work.kind === "prompt_confirm") {
            await ctx.launchService.runWork(work.kind, work.launch_id);
          }
          completeLaunchWork(ctx.db, work.work_id, new Date().toISOString());
          handled += 1;
          emitWebStateChanged(ctx, { domains: ["agent_sessions"] });
        } catch (error) {
          errors += 1;
          const message = formatError(error);
          const nextRunAt = new Date(Date.now() + Math.min(30_000, 1_000 * 2 ** work.attempts)).toISOString();
          const failed = failLaunchWork(ctx.db, work.work_id, {
            error: message,
            nextRunAt,
            now: new Date().toISOString(),
          });
          if (failed.status === "failed") {
            const launch = getLaunchIntent(ctx.db, work.launch_id);
            if (launch && launch.state !== "failed") {
              applyLaunchTransition(ctx, launch, {
                type: "failed",
                reason: "max_attempts_exceeded",
                message,
              });
            }
          }
          log(`launch worker ${work.kind} failed launch_id=${work.launch_id} attempts=${work.attempts}: ${message}`);
        }
      }
      return { summarized: handled, skipped, errors };
    } finally {
      ticking = false;
    }
  }

  const timer = setInterval(() => {
    if (!stopped) void tick();
  }, pollIntervalMs);
  timer.unref?.();
  void tick();
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
    tick,
  };
}

function recoverLocalLaunchWork(db: Database): void {
  db
    .query(
      `UPDATE launch_work
       SET status = 'queued',
           claimed_by = NULL,
           lease_expires_at = NULL,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE status = 'running'`,
    )
    .run();
}

function positiveEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function launchToolStatusFor(tool: "claude" | "pi"): WebLaunchToolStatus {
  const path = Bun.which(tool) ?? undefined;
  return {
    tool,
    available: Boolean(path),
    ...(path ? { path } : {}),
  };
}

function webEventSelectSql(where: string): string {
  return `SELECT e.*,
                 g.name AS group_name,
                 (SELECT COUNT(*) FROM events r WHERE r.parent_event_id = e.event_id) AS reply_count,
                 (SELECT MAX(event_id) FROM events r WHERE r.parent_event_id = e.event_id) AS last_reply_event_id,
                 (SELECT COUNT(*) FROM inbox i WHERE i.event_id = e.event_id AND i.delivered_at IS NOT NULL) AS delivered_count,
                 (SELECT COUNT(*) FROM inbox i WHERE i.event_id = e.event_id AND i.read_at IS NOT NULL) AS read_count,
                 (SELECT COUNT(*) FROM inbox i WHERE i.event_id = e.event_id AND i.acked_at IS NOT NULL) AS acked_count
          FROM events e
          LEFT JOIN groups g ON g.group_id = e.group_id
          ${where}
          ORDER BY e.event_id DESC
          LIMIT ?`;
}

export function readWebRoomEvents(
  ctx: DaemonContext,
  input: { room: string | null; since: number; limit: number; webPeerId: string | null },
): WebEventRow[] {
  if (!input.room) return [];
  if (input.room.startsWith("group:")) {
    const groupId = Number.parseInt(input.room.slice("group:".length), 10);
    if (!Number.isInteger(groupId) || groupId < 1) {
      throw new HttpError(400, "invalid_request", "room must be group:<group_id> or dm:<peer_id>");
    }
    const rows = ctx.db
      .query<WebEventRow, [number, number, number]>(
        webEventSelectSql("WHERE e.group_id = ? AND e.event_id > ?"),
      )
      .all(groupId, input.since, input.limit)
      .reverse();
    return attachReactions(ctx.db, rows);
  }
  if (input.room.startsWith("dm:")) {
    if (!input.webPeerId) throw new HttpError(400, "invalid_request", "peer_id is required for dm room state");
    const otherPeerId = input.room.slice("dm:".length);
    ensurePeer(ctx.db, input.webPeerId);
    ensurePeer(ctx.db, otherPeerId);
    const rows = ctx.db
      .query<WebEventRow, [string, string, string, string, number, number]>(
        webEventSelectSql(
          `WHERE e.type = 'dm'
             AND ((e.sender_peer_id = ? AND e.recipient_peer_id = ?)
               OR (e.sender_peer_id = ? AND e.recipient_peer_id = ?))
             AND e.event_id > ?`,
        ),
      )
      .all(input.webPeerId, otherPeerId, otherPeerId, input.webPeerId, input.since, input.limit)
      .reverse();
    return attachReactions(ctx.db, rows);
  }
  throw new HttpError(400, "invalid_request", "room must be group:<group_id> or dm:<peer_id>");
}

function readWebRoomMedia(ctx: DaemonContext, input: { room: string | null; limit: number }): MediaRow[] {
  if (!input.room?.startsWith("group:")) return [];
  const groupId = Number.parseInt(input.room.slice("group:".length), 10);
  if (!Number.isInteger(groupId) || groupId < 1) return [];
  return ctx.db
    .query<MediaRow, [number, number]>(
      "SELECT * FROM media_items WHERE group_id = ? ORDER BY created_at DESC LIMIT ?",
    )
    .all(groupId, input.limit);
}

export async function notifySubscribers(ctx: DaemonContext, peerIds: string[], event: EventRow): Promise<void> {
  await Promise.all(
    peerIds.map(async (peerId) => {
      const subscriber = ctx.subscribers.get(peerId);
      if (!subscriber) {
        log(`notification pending event_id=${event.event_id} peer_id=${peerId}: no active subscriber; durable inbox fallback only`);
        return;
      }
      try {
        log(`notification callback start event_id=${event.event_id} peer_id=${peerId} callback_url=${subscriber.callback_url}`);
        const response = await fetch(subscriber.callback_url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-synchronize-subscription-token": subscriber.token,
          },
          body: JSON.stringify({ event: eventForRecipient(event, peerId) }),
        });
        if (!response.ok) {
          ctx.subscribers.delete(peerId);
          log(`notification callback failed event_id=${event.event_id} peer_id=${peerId} status=${response.status}; subscriber removed`);
          return;
        }
        const now = new Date().toISOString();
        ctx.db
          .query(
            `UPDATE inbox
             SET delivered_at = COALESCE(delivered_at, ?)
             WHERE recipient_peer_id = ? AND event_id = ?`,
          )
          .run(now, peerId, event.event_id);
        ctx.db.query("UPDATE peers SET last_cursor = ? WHERE peer_id = ?").run(event.event_id, peerId);
        log(`notification callback delivered event_id=${event.event_id} peer_id=${peerId} delivered_at=${now}`);
      } catch (error) {
        ctx.subscribers.delete(peerId);
        log(`notification callback error event_id=${event.event_id} peer_id=${peerId}: ${formatError(error)}; subscriber removed`);
      }
    }),
  );
}

export function getGroup(db: Database, name: string): GroupRow {
  const group = db.query<GroupRow, [string]>("SELECT * FROM groups WHERE name = ?").get(name);
  if (!group) throw new HttpError(404, "group_not_found", `Group not found: ${name}`);
  return group;
}

export function getGroupById(db: Database, groupId: number): GroupRow {
  const group = db.query<GroupRow, [number]>("SELECT * FROM groups WHERE group_id = ?").get(groupId);
  if (!group) throw new HttpError(404, "group_not_found", `Group not found: ${groupId}`);
  return group;
}

/**
 * Core group-join transaction shared by the `/groups/:name/join` route and the
 * server-side launch reconcile. Emits the join (and any alias-reclaim) events,
 * fans them out to inboxes, and upserts the active membership. Throws
 * `alias_collision` when the alias is already held by another active member.
 * Callers own the idempotent short-circuit, web-state emit, and HTTP shaping.
 */
export function joinGroupCore(
  ctx: DaemonContext,
  group: GroupRow,
  peer: PeerRow,
  alias: string,
  fresh: boolean,
): { eventId: number; reclaimed: { previous_peer_id: string; event_id: number } | null } {
  let reclaimed: { previous_peer_id: string; event_id: number } | null = null;
  const eventId = ctx.db.transaction(() => {
    if (peer.peer_id === LOCAL_WEB_PEER_ID && peer.tool === "web" && alias === "you") {
      deactivateWebAliasHolders(ctx.db, group.group_id, alias, peer.peer_id);
    }
    // Detect alias reclaim: the most-recently-departed prior holder of this
    // alias belongs to a different peer_id. Respawn (same peer_id) is not a
    // reclaim. v0 storage policy frees the alias on leave; the event leaves
    // an audit trail so observers can distinguish respawn from a new peer.
    const previousHolder = ctx.db
      .query<{ peer_id: string }, [number, string]>(
        `SELECT peer_id FROM group_members
         WHERE group_id = ? AND alias = ? AND active = 0
         ORDER BY COALESCE(left_at, joined_at) DESC
         LIMIT 1`,
      )
      .get(group.group_id, alias);
    if (previousHolder && previousHolder.peer_id !== peer.peer_id) {
      ctx.db
        .query(
          `INSERT INTO events (type, sender_peer_id, group_id, body)
           VALUES ('group_member_alias_reclaimed', ?, ?, ?)`,
        )
        .run(peer.peer_id, group.group_id, JSON.stringify({ alias, previous_peer_id: previousHolder.peer_id }));
      const reclaimEventId = Number(ctx.db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()?.id);
      fanoutRosterEventToInbox(ctx.db, group.group_id, reclaimEventId, peer.peer_id);
      reclaimed = { previous_peer_id: previousHolder.peer_id, event_id: reclaimEventId };
    }
    ctx.db
      .query("INSERT INTO events (type, sender_peer_id, group_id, body) VALUES ('group_joined', ?, ?, ?)")
      .run(peer.peer_id, group.group_id, JSON.stringify({ alias, fresh }));
    const newEventId = Number(ctx.db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()?.id);
    fanoutRosterEventToInbox(ctx.db, group.group_id, newEventId, peer.peer_id);
    const firstEventId =
      ctx.db.query<{ event_id: number }, [number]>("SELECT MIN(event_id) AS event_id FROM events WHERE group_id = ?").get(group.group_id)
        ?.event_id ?? newEventId;
    const historyFrom = fresh ? newEventId : firstEventId;
    try {
      ctx.db
        .query(
          `INSERT INTO group_members
             (group_id, peer_id, alias, join_event_id, history_from_event_id, active, purpose, left_at)
           VALUES (?, ?, ?, ?, ?, 1, ?, NULL)
           ON CONFLICT(group_id, peer_id) DO UPDATE SET
             alias = excluded.alias,
             join_event_id = excluded.join_event_id,
             history_from_event_id = excluded.history_from_event_id,
             active = 1,
             purpose = excluded.purpose,
             joined_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
             left_at = NULL`,
        )
        .run(group.group_id, peer.peer_id, alias, newEventId, historyFrom, peer.purpose);
    } catch (error) {
      throw mapSqliteConstraint(
        error,
        "alias_collision",
        `Alias '${alias}' is already active in group '${group.name}'. Provide a unique alias to join this group.`,
      );
    }
    return newEventId;
  })();
  return { eventId, reclaimed };
}

/** Resolve a launch's target synchronize group, creating it durably if absent. */
function ensureLaunchGroup(ctx: DaemonContext, name: string): GroupRow {
  const groupName = requireGroupName(name);
  const existing = ctx.db.query<GroupRow, [string]>("SELECT * FROM groups WHERE LOWER(name) = LOWER(?)").get(groupName);
  if (existing) return existing;
  const mediaDir = `${ctx.paths.mediaPath}/${groupName.toLowerCase()}`;
  const groupId = ctx.db.transaction(() => {
    ctx.db
      .query("INSERT INTO groups (name, durable, media_dir, creator_peer_id, description) VALUES (?, 1, ?, NULL, NULL)")
      .run(groupName, mediaDir);
    const id = Number(ctx.db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()?.id);
    insertGroupPath(ctx.db, id, defaultGroupPath(ctx));
    ctx.db
      .query("INSERT INTO events (type, sender_peer_id, group_id, body) VALUES ('group_created', NULL, ?, ?)")
      .run(id, JSON.stringify({ name: groupName, durable: true }));
    return id;
  })();
  emitWebStateChanged(ctx, { domains: ["groups", "events"], groupId });
  return getGroupById(ctx.db, groupId);
}

/**
 * Server-side launch reconcile: when a launched agent self-registers carrying
 * its launch_id, consume the in-memory launch intent and, if it named a group,
 * auto-join the peer (alias = launch name, fresh history). Best-effort: an
 * alias collision or any join failure is logged as join_failed and never blocks
 * registration — the session is alive, just unjoined (operator-recoverable).
 */
export function reconcileLaunch(ctx: DaemonContext, launchId: string | null, peerId: string): void {
  if (!launchId) return;
  const durable = getLaunchIntent(ctx.db, launchId);
  if (durable) {
    reconcileDurableLaunch(ctx, durable, peerId);
    return;
  }
  const pending = ctx.launchService.consume(launchId, peerId);
  if (!pending || !pending.group) return;
  try {
    const group = ensureLaunchGroup(ctx, pending.group);
    insertGroupPath(ctx.db, group.group_id, pending.cwd);
    const peer = getPeer(ctx.db, peerId);
    const existing = ctx.db
      .query<{ alias: string; active: number }, [number, string]>(
        "SELECT alias, active FROM group_members WHERE group_id = ? AND peer_id = ?",
      )
      .get(group.group_id, peerId);
    if (existing && existing.active === 1 && existing.alias === pending.alias) {
      return; // already an active member under this alias — nothing to do
    }
    const { eventId } = joinGroupCore(ctx, group, peer, pending.alias, true);
    emitWebStateChanged(ctx, { domains: ["groups", "events", "inbox"], eventId, groupId: group.group_id, peerId });
    log(`launch auto-join peer_id=${peerId} group=${group.name} alias=${pending.alias} launch_id=${launchId}`);
  } catch (error) {
    log(
      `launch auto-join join_failed peer_id=${peerId} group=${pending.group} alias=${pending.alias} launch_id=${launchId}: ${formatError(error)}`,
    );
  }
}

function reconcileDurableLaunch(ctx: DaemonContext, launch: LaunchIntentRow, peerId: string): void {
  if (launch.state === "running") return;
  if (launch.state === "failed" || launch.state === "stale" || launch.state === "stopped") return;
  if (launch.peer_id !== peerId) {
    appendLaunchEvent(ctx.db, {
      launchId: launch.launch_id,
      kind: "launch.peer_mismatch",
      fromState: launch.state,
      toState: launch.state,
      payload: { expectedPeerId: launch.peer_id, actualPeerId: peerId },
      createdAt: new Date().toISOString(),
    });
    log(`launch reconcile peer_mismatch launch_id=${launch.launch_id} expected=${launch.peer_id} actual=${peerId}`);
    return;
  }

  const registered = applyLaunchTransition(ctx, launch, { type: "registered" });
  if (launch.target_group === null) {
    applyLaunchTransition(ctx, registered, { type: "running_observed" });
    emitWebStateChanged(ctx, { domains: ["agent_sessions"], peerId });
    log(`launch registered peer_id=${peerId} launch_id=${launch.launch_id} group=<none>`);
    return;
  }

  const reconciling = applyLaunchTransition(ctx, registered, { type: "reconcile_started" });
  try {
    const group = ensureLaunchGroup(ctx, launch.target_group);
    insertGroupPath(ctx.db, group.group_id, launch.cwd);
    const peer = getPeer(ctx.db, peerId);
    const existing = ctx.db
      .query<{ alias: string; active: number }, [number, string]>(
        "SELECT alias, active FROM group_members WHERE group_id = ? AND peer_id = ?",
      )
      .get(group.group_id, peerId);
    if (!(existing && existing.active === 1 && existing.alias === launch.alias)) {
      joinGroupCore(ctx, group, peer, launch.alias, true);
    }
    const joined = applyLaunchTransition(ctx, reconciling, { type: "join_succeeded" });
    applyLaunchTransition(ctx, joined, { type: "running_observed" });
    emitWebStateChanged(ctx, { domains: ["groups", "events", "inbox", "agent_sessions"], groupId: group.group_id, peerId });
    log(`launch durable auto-join peer_id=${peerId} group=${group.name} alias=${launch.alias} launch_id=${launch.launch_id}`);
  } catch (error) {
    applyLaunchTransition(ctx, reconciling, {
      type: "join_failed",
      reason: "join_failed",
      message: formatError(error),
    });
    emitWebStateChanged(ctx, { domains: ["agent_sessions"], peerId });
    log(
      `launch durable auto-join join_failed peer_id=${peerId} group=${launch.target_group} alias=${launch.alias} launch_id=${launch.launch_id}: ${formatError(error)}`,
    );
  }
}

export function applyLaunchTransition(ctx: DaemonContext, launch: LaunchIntentRow, event: LaunchLifecycleEvent): LaunchIntentRow {
  const transition = transitionLaunch(launch.state, event);
  const now = new Date().toISOString();
  if (!transition.ok) {
    appendLaunchEvent(ctx.db, {
      launchId: launch.launch_id,
      kind: `launch.invalid.${event.type}`,
      fromState: launch.state,
      toState: launch.state,
      payload: { error: transition.error },
      createdAt: now,
    });
    return launch;
  }
  return updateLaunchState(ctx.db, {
    launchId: launch.launch_id,
    fromState: transition.from,
    state: transition.to,
    eventKind: event.type,
    payload: {
      ...(transition.reason ? { reason: transition.reason } : {}),
      ...(transition.message ? { message: transition.message } : {}),
    },
    failureCode: event.type === "failed" ? event.reason : null,
    failureMessage: "message" in event ? event.message ?? null : null,
    now,
  });
}

type FormattedGroup = Omit<GroupRow, "durable"> & { durable: boolean };
type FormattedGroupPath = Omit<GroupPathRow, "active"> & { active: boolean };
type FormattedMember = Omit<MemberRow, "active"> & { active: boolean };

export function formatGroup(group: GroupRow): FormattedGroup {
  return { ...group, durable: Boolean(group.durable) };
}

function formatGroupPath(path: GroupPathRow): FormattedGroupPath {
  return { ...path, active: Boolean(path.active) };
}

export function insertGroupPath(db: Database, groupId: number, path: string, label: string | null = null): void {
  const launchPath = requireLaunchPath(path);
  db
    .query(
      `INSERT INTO group_paths (group_id, path, label)
       VALUES (?, ?, ?)
       ON CONFLICT(group_id, path) DO UPDATE SET
         active = 1,
         label = COALESCE(excluded.label, label)`,
    )
    .run(groupId, launchPath, label);
}

export function getGroupPaths(db: Database, groupId: number): FormattedGroupPath[] {
  return db
    .query<GroupPathRow, [number]>(
      "SELECT * FROM group_paths WHERE group_id = ? AND active = 1 ORDER BY path ASC",
    )
    .all(groupId)
    .map(formatGroupPath);
}

function ensureDefaultGroupPaths(ctx: DaemonContext): void {
  const defaultPath = defaultGroupPath(ctx);
  const groups = ctx.db.query<GroupRow, []>("SELECT * FROM groups").all();
  for (const group of groups) {
    const existing = ctx.db
      .query<{ count: number }, [number]>("SELECT COUNT(*) AS count FROM group_paths WHERE group_id = ? AND active = 1")
      .get(group.group_id)?.count ?? 0;
    if (existing === 0) insertGroupPath(ctx.db, group.group_id, defaultPath);
  }
}

export function defaultGroupPath(ctx: DaemonContext): string {
  return requireLaunchPath(ctx.provenance?.source_root ?? process.cwd());
}

export const MEMBER_SELECT_SQL = `gm.*, p.session_name, p.tool, p.activity_state,
  (SELECT s.host_session_id FROM agent_sessions s
   WHERE s.peer_id = gm.peer_id
   ORDER BY s.updated_at DESC, s.created_at DESC LIMIT 1) AS host_session_id`;

export function getGroupMembers(db: Database, groupId: number): FormattedMember[] {
  return db
    .query<MemberRow & { host_session_id: string | null }, [number]>(
      `SELECT ${MEMBER_SELECT_SQL}
       FROM group_members gm
       JOIN peers p ON p.peer_id = gm.peer_id
       WHERE gm.group_id = ?
       ORDER BY gm.active DESC, gm.alias ASC`,
    )
    .all(groupId)
    .map((member) => ({ ...member, active: Boolean(member.active) }));
}

export function deriveBackendTitleForPeer(db: Database, peerId: string): string {
  const peer = getPeer(db, peerId);
  if (!isLaunchTool(peer.tool)) {
    throw new HttpError(400, "invalid_stop", `Cannot derive backend title for non-launch tool: ${peer.tool}`);
  }
  const launch = db
    .query<{ launch_id: string | null }, [string]>(
      `SELECT launch_id
       FROM agent_sessions
       WHERE peer_id = ? AND launch_id IS NOT NULL
       ORDER BY updated_at DESC, created_at DESC
       LIMIT 1`,
    )
    .get(peerId);
  if (!launch?.launch_id) {
    throw new HttpError(400, "invalid_stop", "peer_id stop requires an agent session with launch_id; pass title instead");
  }
  const durable = getLaunchIntent(db, launch.launch_id);
  if (durable?.backend_title) return durable.backend_title;
  const group = db
    .query<{ name: string | null }, [string]>(
      `SELECT g.name
       FROM group_members gm
       JOIN groups g ON g.group_id = gm.group_id
       WHERE gm.peer_id = ? AND gm.active = 1
       ORDER BY gm.joined_at DESC
       LIMIT 1`,
    )
    .get(peerId)?.name ?? undefined;
  return aoeTitle({
    launchId: launch.launch_id,
    peerId,
    ...(group ? { group } : {}),
    sessionName: peer.session_name,
    tool: peer.tool,
  });
}

function deriveAoeSessionForPeer(db: Database, peerId: string, profile: string): WebAoeSession | null {
  try {
    const title = deriveBackendTitleForPeer(db, peerId);
    return {
      profile,
      title,
      attach_command: aoeAttachCommand(profile, title),
    };
  } catch {
    return null;
  }
}

export function getGroupMember(db: Database, groupId: number, peerId: string): FormattedMember {
  const member = db
    .query<MemberRow & { host_session_id: string | null }, [number, string]>(
      `SELECT ${MEMBER_SELECT_SQL}
       FROM group_members gm
       JOIN peers p ON p.peer_id = gm.peer_id
       WHERE gm.group_id = ? AND gm.peer_id = ?`,
    )
    .get(groupId, peerId);
  if (!member) throw new HttpError(404, "member_not_found", `Peer is not a group member: ${peerId}`);
  return { ...member, active: Boolean(member.active) } as FormattedMember;
}

export function ensureActiveMember(db: Database, groupId: number, peerId: string): MemberRow {
  const member = db
    .query<MemberRow, [number, string]>(
      `SELECT ${MEMBER_SELECT_SQL}
       FROM group_members gm
       JOIN peers p ON p.peer_id = gm.peer_id
       WHERE gm.group_id = ? AND gm.peer_id = ? AND gm.active = 1`,
    )
    .get(groupId, peerId);
  if (!member) throw new HttpError(403, "not_group_member", `Peer is not an active group member: ${peerId}`);
  return member;
}

export function getMedia(db: Database, mediaId: string): MediaRow {
  const media = db.query<MediaRow, [string]>("SELECT * FROM media_items WHERE media_id = ?").get(mediaId);
  if (!media) throw new HttpError(404, "media_not_found", `Media not found: ${mediaId}`);
  return media;
}

export async function hashFile(path: string): Promise<string> {
  const hasher = createHash("sha256");
  const bytes = await Bun.file(path).arrayBuffer();
  hasher.update(Buffer.from(bytes));
  return hasher.digest("hex");
}

export function guessContentType(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === ".json") return "application/json";
  if (ext === ".md" || ext === ".txt") return "text/plain";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".pdf") return "application/pdf";
  return "application/octet-stream";
}

export function webAttachmentRoot(paths: RuntimePaths): string {
  return join(paths.home, "tmp", "web-attachments");
}

export function safePathSegment(value: string, fallback: string): string {
  const safe = basename(value).replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^_+|_+$/g, "");
  return safe || fallback;
}

export function attachmentExtension(name: string, mimeType: string): string {
  const ext = extname(name).replace(/^\./, "");
  if (ext) return ext.toUpperCase();
  const subtype = mimeType.split("/")[1]?.split(";")[0]?.trim();
  return subtype ? subtype.replace(/[^a-zA-Z0-9]+/g, "-").toUpperCase() : "FILE";
}

export function resolveStagedAttachmentPath(paths: RuntimePaths, inputPath: string): string {
  const root = resolve(webAttachmentRoot(paths));
  const candidate = resolve(inputPath);
  const rel = relative(root, candidate);
  if (rel === "" || rel.startsWith("..") || rel.startsWith("/")) {
    throw new HttpError(400, "invalid_attachment_path", "path is not a staged web attachment");
  }
  return candidate;
}

export async function appendMediaIndex(group: GroupRow, media: MediaRow): Promise<void> {
  await ensureDir(group.media_dir);
  await appendFile(join(group.media_dir, "index.jsonl"), `${JSON.stringify(media)}\n`, "utf8");
}

export async function writeMediaReadme(group: GroupRow, db: Database): Promise<void> {
  const rows = db
    .query<MediaRow, [number]>("SELECT * FROM media_items WHERE group_id = ? ORDER BY created_at DESC LIMIT 50")
    .all(group.group_id);
  const body = [
    `# MediaStore: ${group.name}`,
    "",
    ...rows.map((row) => `- ${row.created_at} ${row.media_id} ${basename(row.copied_path)} ${row.description ?? ""}`.trim()),
    "",
  ].join("\n");
  await writeFile(join(group.media_dir, "README.md"), body, "utf8");
}

export async function main(): Promise<void> {
  const paths = getRuntimePaths();
  await ensureDir(paths.home);
  await ensureDir(paths.mediaPath);
  const provenance = collectDaemonProvenance();
  const loadedEnvKeys = await applyDaemonEnvFiles(paths, provenance.source_root);
  if (loadedEnvKeys.length > 0) {
    console.error(`[env] loaded daemon env keys=${loadedEnvKeys.join(",")}`);
  }

  const { db } = await openDatabase(paths.dbPath);
  await pruneEphemeralGroups(db, async (mediaDir) => {
    try {
      await rm(mediaDir, { recursive: true, force: true });
    } catch (error) {
      log(`ephemeral media_dir cleanup failed: ${mediaDir}: ${formatError(error)}`);
    }
  });
  const startedAt = new Date().toISOString();
  const runtimeConfig = await loadRuntimeConfig(paths.configPath, process.env);
  const token = runtimeConfig.daemon.token;
  const { host, port } = resolveBind(process.env, runtimeConfig.daemon);
  assertLanModeIsProtected(host, token);
  const skillCatalog = await loadSkillCatalog({ repoRoot: provenance.source_root, env: process.env });
  log(`skill catalog loaded entries=${skillCatalog.length}`);

  let ctx: DaemonContext;
  const server = Bun.serve({
    hostname: host,
    port,
    fetch(request) {
      return route(request, ctx).catch((error) => errorResponse(error));
    },
  });

  const launchProfile = aoeProfileName(paths.home);
  const launchService = new LaunchService({
    backend: new AoeBackend({ profile: launchProfile }),
    home: paths.home,
    db,
    backendProfile: launchProfile,
  });

  const summarizeWorker = isSummarizeEnabled() ? startSummarizeWorker(db) : null;
  if (summarizeWorker) {
    console.error(`[summarize] worker started (provider configured)`);
  } else {
    console.error(`[summarize] worker disabled (no OPENROUTER_API_KEY)`);
  }

  ctx = {
    paths,
    db,
    startedAt,
    token,
    provenance,
    server,
    subscribers: new Map(),
    webStateClients: new Set(),
    stateVersion: 0,
    launchService,
    launchWorker: null,
    summarizeWorker,
    skillCatalog,
    config: runtimeConfig,
  };
  ctx.launchWorker = startLaunchWorker(ctx);
  console.error(`[launch] worker started`);
  ensureDefaultGroupPaths(ctx);
  sweepStoppedLaunchPeers(ctx);

  // Retention sweeper: run once at startup (cleans up peers that died while the
  // daemon was down) then on an interval. unref so it never blocks shutdown.
  sweepExpiredPeers(ctx);
  const sweepTimer = setInterval(() => sweepExpiredPeers(ctx), runtimeConfig.daemon.sweepIntervalMs);
  sweepTimer.unref?.();

  const discovery: DiscoveryFile = {
    pid: process.pid,
    host: server.hostname ?? host,
    port: server.port ?? port,
    baseUrl: `http://${server.hostname ?? host}:${server.port ?? port}`,
    tokenRequired: Boolean(token),
    dbPath: paths.dbPath,
    mediaPath: paths.mediaPath,
    startedAt,
    provenance,
  };
  await writeJson(paths.discoveryPath, discovery);
  await appendDaemonStartupLog(paths, discovery);

  console.error(`synchronize daemon listening on ${discovery.baseUrl}`);
}

async function appendDaemonStartupLog(paths: RuntimePaths, discovery: DiscoveryFile): Promise<void> {
  const record = {
    event: "daemon_start",
    written_at: new Date().toISOString(),
    ...discovery,
    home: paths.home,
  };
  await appendFile(paths.logPath, `${JSON.stringify(record)}\n`, "utf8");
}

// ─── Web UI static serving ────────────────────────────────────────────────
// Resolves the web/dist directory relative to this source file. Override with
// SYNCHRONIZE_WEB_DIST. In V0 we serve unauthenticated under /web/* because the
// daemon binds to 127.0.0.1 by default; for non-localhost binds the API still
// requires the bearer token, so the bundle would just fail to fetch data.

const WEB_DIST = process.env["SYNCHRONIZE_WEB_DIST"] ?? new URL("../../web/dist", import.meta.url).pathname;

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".map":  "application/json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export async function serveWebAsset(pathname: string): Promise<Response> {
  // Strip leading /web (and optional trailing /). Default to index.html.
  let rel = pathname.replace(/^\/web\/?/, "");
  if (rel === "" || rel.endsWith("/")) rel = "index.html";
  // Block traversal.
  if (rel.includes("..")) return new Response("forbidden", { status: 403 });
  const filePath = join(WEB_DIST, rel);
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    // Fallback to index.html so client routing works once we add it.
    const fallback = Bun.file(join(WEB_DIST, "index.html"));
    if (!(await fallback.exists())) {
      return new Response(
        "web bundle not built — run `bun run web/build.ts`",
        { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } },
      );
    }
    return new Response(fallback, { headers: { "content-type": "text/html; charset=utf-8" } });
  }
  const ext = extname(rel).toLowerCase();
  const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";
  const immutable = /\.[A-Za-z0-9_-]{8,}\.(js|css|map|png|svg|woff2?)$/.test(rel);
  return new Response(file, {
    headers: {
      "content-type": contentType,
      "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    },
  });
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
  });
}
