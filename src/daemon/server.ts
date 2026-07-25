import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { appendFile, rm } from "node:fs/promises";
import { extname, join } from "node:path";
import { loadRuntimeConfig, type RuntimeConfig } from "../config.ts";
import { newGroupPublicId, openDatabase, pruneEphemeralGroups } from "../db.ts";
import { applyDaemonEnvFiles } from "../env-files.ts";
import { ensureDir, writeJson } from "../fs.ts";
import { errorResponse, HttpError } from "../http.ts";
import { getRuntimePaths, type RuntimePaths } from "../paths.ts";
import { collectDaemonProvenance, type DaemonProvenance } from "../provenance.ts";
import { AoeBackend } from "../launch/backend.ts";
import { LaunchService, aoeAttachCommand, aoeProfileName } from "../launch/service.ts";
import {
  appendLaunchEvent,
  claimNextLaunchWork,
  completeLaunchWork,
  failLaunchWork,
  getLaunchIntent,
  type LaunchIntentRow,
} from "../launch/store.ts";
import { resolveProviderConfig } from "../llm/index.ts";
import { loadSkillCatalog } from "../skill-catalog.ts";
import {
  getCachedSummary,
  isEnabled as isSummarizeEnabled,
  loadSummaryResponse,
  makeProviderCaller,
  startSummarizeWorker,
  summarizeThread,
  type WorkerHandle,
} from "../summarize/index.ts";
import type { ReplyDestination, SkillCatalogEntry } from "../api/types.ts";
import {
  attachReactions,
  getEvent,
  type EventRow,
} from "./repo/events.ts";
import {
  defaultGroupPath,
  deriveBackendTitleForPeer,
  formatGroup,
  formatGroupPath,
  getGroupById,
  insertGroupPath,
  MEMBER_SELECT_SQL,
  type FormattedGroup,
  type FormattedGroupPath,
  type FormattedMember,
  type GroupPathRow,
  type GroupRow,
  type MemberRow,
} from "./repo/groups.ts";
import type { MediaRow } from "./repo/media.ts";
import { applyLaunchTransition } from "./repo/launch.ts";
import type { EventSubscriber } from "./services/subscriptions.ts";
import { emitWebStateChanged, type WebStateClient } from "./services/web-events.ts";
import {
  derivePresence,
  ensurePeer,
  getPeer,
  LOCAL_WEB_PEER_ID,
  selectExpiredPeerIds,
  selectStoppedLaunchPeerIds,
  softDeletePeerIfPresent,
  type PeerRow,
} from "./repo/peers.ts";
import { assertLanModeIsProtected, resolveBind } from "./auth.ts";
import { mapSqliteConstraint } from "./errors.ts";
import {
  selectorToSummaryStrategy,
  type NormalizedSelectors,
} from "./selectors.ts";
import {
  parseCursor,
  parseLimit,
  requireGroupName,
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

interface MentionWarning {
  token: string;
  reason: "alias_not_in_group" | "alias_archived";
}

export interface InboxRow extends EventRow {
  delivered_at: string | null;
  read_at: string | null;
  acked_at: string | null;
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

export function log(message: string): void {
  console.error(`[synchronize-daemon] ${message}`);
}

export function debugEnabled(): boolean {
  const flag = process.env.SYNCHRONIZE_DEBUG;
  return Boolean(flag) && flag !== "0" && flag !== "false";
}

export function debug(message: string): void {
  if (debugEnabled()) console.error(`[synchronize-daemon:debug] ${message}`);
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
  const archivedAliasLookup = db.query<{ peer_id: string }, [number, string]>(
    "SELECT peer_id FROM group_members WHERE group_id = ? AND member_state = 'archived' AND alias = ?",
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
    if (normalizedRow) {
      peerIds.push(normalizedRow.peer_id);
      continue;
    }
    // Distinguish "archived" from "unknown": an archived seat keeps its alias
    // reserved (member_state='archived', active=0), so it won't match the
    // active-only lookup above. Surfacing alias_archived lets the web warn
    // "they're archived — resume to reach them" instead of "no such alias".
    const archived = archivedAliasLookup.get(groupId, token) ?? (normalizedToken && normalizedToken !== token ? archivedAliasLookup.get(groupId, normalizedToken) : null);
    warnings.push({ token: `@${normalizedToken || token}`, reason: archived ? "alias_archived" : "alias_not_in_group" });
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

function deactivateWebAliasHolders(db: Database, groupId: number, alias: string, peerId: string): void {
  db.query(
    `UPDATE group_members
     SET active = 0, member_state = 'left',
         left_at = COALESCE(left_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     WHERE group_id = ?
       AND alias = ?
       AND active = 1
       AND peer_id != ?
       AND peer_id IN (SELECT peer_id FROM peers WHERE tool = 'web')`,
  ).run(groupId, alias, peerId);
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
  if (debugEnabled()) {
    const exempt = ctx.db
      .query<{ n: number }, [string]>(
        "SELECT COUNT(*) AS n FROM peers WHERE deleted_at IS NULL AND lifecycle_state = 'archived' AND lease_expires_at < ?",
      )
      .get(cutoff)?.n ?? 0;
    if (exempt > 0) debug(`sweep[retention]: exempting ${exempt} archived lease-expired peer(s) (reserved for resume)`);
  }
  const swept = ctx.db.transaction(() => {
    const peerIds = selectExpiredPeerIds(ctx.db, cutoff);
    const now = new Date().toISOString();
    for (const peer_id of peerIds) {
      ctx.db.query("UPDATE peers SET deleted_at = ? WHERE peer_id = ?").run(now, peer_id);
      ctx.db
        .query("UPDATE group_members SET active = 0, member_state = 'left', left_at = COALESCE(left_at, ?) WHERE peer_id = ? AND active = 1")
        .run(now, peer_id);
      ctx.subscribers.delete(peer_id);
    }
    return peerIds;
  })();
  if (swept.length > 0) {
    log(`sweeper soft-deleted ${swept.length} peer(s) lease-expired > ${retentionMs}ms`);
    emitWebStateChanged(ctx, { domains: ["peers", "groups"] });
  }
}

function sweepStoppedLaunchPeers(ctx: DaemonContext): number {
  const peerIds = selectStoppedLaunchPeerIds(ctx.db);
  if (debugEnabled()) {
    const exempt = ctx.db
      .query<{ n: number }, []>(
        "SELECT COUNT(*) AS n FROM peers WHERE deleted_at IS NULL AND lifecycle_state = 'archived'",
      )
      .get()?.n ?? 0;
    debug(`sweep[stopped-launch]: ${peerIds.length} candidate(s)${exempt > 0 ? `, ${exempt} archived peer(s) exempt` : ""}`);
  }
  if (peerIds.length === 0) return 0;
  const deletedAt = new Date().toISOString();
  let deactivated = 0;
  for (const peerId of peerIds) {
    if (softDeletePeerIfPresent(ctx, peerId, deletedAt)) deactivated += 1;
  }
  if (deactivated > 0) {
    log(`launch cleanup soft-deleted ${deactivated} stopped launch peer(s)`);
    emitWebStateChanged(ctx, { domains: ["peers", "groups", "agent_sessions"] });
  }
  return deactivated;
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
  launch_tools: Record<"claude" | "pi" | "letta", WebLaunchToolStatus>;
  launch_profiles: WebLaunchProfileStatus[];
  launch_lifecycle: WebLaunchLifecycleRow[];
  agent_runtime_details: WebAgentRuntimeDetails[];
  peers: Array<PeerRow & { online: boolean; aoe_session?: WebAoeSession }>;
  groups: FormattedGroup[];
  group_paths: FormattedGroupPath[];
  memberships: Array<FormattedMember & { online: boolean }>;
  room_summaries: WebRoomSummary[];
  events: WebEventRow[];
  media: MediaRow[];
  skill_catalog: SkillCatalogEntry[];
  // Present only when hydrating around a deep-link target (around_event_id). Lets
  // the client know whether the exact target made it into the bounded window.
  target?: { event_id: number; included: boolean; before_count: number; after_count: number };
}

type WebLaunchLifecycleRow = Pick<
  LaunchIntentRow,
  | "launch_id"
  | "peer_id"
  | "tool"
  | "profile_name"
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

interface WebAgentRuntimeDetails {
  peer_id: string;
  binding_id: string | null;
  launch_id: string | null;
  profile_name: string | null;
  tool: string | null;
  session_name: string | null;
  model: string | null;
  thinking: string | null;
  source: string | null;
  agent_type: string | null;
  host_tool: string | null;
  host_session_id: string | null;
  host_session_file: string | null;
  machine_id: string | null;
  cwd: string | null;
  git_branch: string | null;
  git_dirty: boolean | null;
  pid: number | null;
  launch_state: string | null;
  backend_title: string | null;
  target_group: string | null;
  failure_code: string | null;
  failure_message: string | null;
  created_at: string | null;
  updated_at: string | null;
  last_seen_at: string | null;
}

type WebAgentRuntimeDetailsRow = Omit<WebAgentRuntimeDetails, "git_dirty"> & { git_dirty: number | null };

interface WebLaunchToolStatus {
  tool: "claude" | "pi" | "letta";
  available: boolean;
  path?: string;
}

interface WebLaunchProfileStatus {
  name: string;
  tool: "claude" | "pi" | "letta";
  available: boolean;
  path?: string;
  model?: string;
  thinking?: string;
  session_name?: string;
  repo?: string;
  disabled_reason?: string;
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
  const aroundRaw = Number(url.searchParams.get("around_event_id"));
  const aroundEventId = Number.isInteger(aroundRaw) && aroundRaw >= 1 ? aroundRaw : null;
  const cursor = ctx.db.query<{ cursor: number | null }, []>("SELECT MAX(event_id) AS cursor FROM events").get()?.cursor ?? 0;
  const aoeProfile = aoeProfileName(ctx.paths.home);
  const launchLifecycle = ctx.db
    .query<WebLaunchLifecycleRow, []>(
      `SELECT launch_id, peer_id, tool, profile_name, session_name, alias, cwd, target_group,
              backend_profile, backend_title, state, failure_code, failure_message,
              created_at, updated_at, accepted_at, spawned_at, prompt_seen_at,
              prompt_accepted_at, registered_at, reconciled_at, joined_at,
              stale_at, failed_at, stopped_at
       FROM launch_intents
       ORDER BY created_at DESC
       LIMIT 200`,
    )
    .all();
  const agentRuntimeDetails = ctx.db
    .query<WebAgentRuntimeDetailsRow, []>(
      `SELECT
         p.peer_id,
         s.binding_id,
         COALESCE(s.launch_id, li.launch_id) AS launch_id,
         li.profile_name,
         COALESCE(li.tool, s.host_tool, p.tool) AS tool,
         COALESCE(li.session_name, p.session_name) AS session_name,
         COALESCE(s.model, li.model) AS model,
         li.thinking,
         s.source,
         s.agent_type,
         s.host_tool,
         s.host_session_id,
         s.host_session_file,
         p.machine_id,
         COALESCE(s.cwd, li.cwd) AS cwd,
         s.git_branch,
         s.git_dirty,
         s.pid,
         li.state AS launch_state,
         li.backend_title,
         li.target_group,
         li.failure_code,
         li.failure_message,
         COALESCE(s.created_at, li.created_at) AS created_at,
         COALESCE(s.updated_at, li.updated_at) AS updated_at,
         s.last_seen_at
       FROM peers p
       LEFT JOIN agent_sessions s
         ON s.binding_id = (
           SELECT latest_s.binding_id
           FROM agent_sessions latest_s
           WHERE latest_s.peer_id = p.peer_id
           ORDER BY latest_s.updated_at DESC, latest_s.created_at DESC
           LIMIT 1
         )
       LEFT JOIN launch_intents li
         ON li.launch_id = COALESCE(
           s.launch_id,
           (
             SELECT latest_li.launch_id
             FROM launch_intents latest_li
             WHERE latest_li.peer_id = p.peer_id
             ORDER BY latest_li.updated_at DESC, latest_li.created_at DESC
             LIMIT 1
           )
         )
       WHERE p.deleted_at IS NULL
       ORDER BY p.updated_at DESC, p.session_name ASC`,
    )
    .all()
    .map((row) => ({
      ...row,
      git_dirty: row.git_dirty === null ? null : Boolean(row.git_dirty),
    }));
  const peers = ctx.db
    .query<PeerRow & { online: number }, [string]>(
      `SELECT peer_id, tool, session_name, purpose, machine_id, lease_expires_at,
              activity_state, last_activity_at,
              last_cursor, lifecycle_state, archived_at, archived_reason, archive_source,
              created_at, updated_at, lease_expires_at > ? AS online
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
       WHERE gm.member_state IN ('active','archived')
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
  const events = readWebRoomEvents(ctx, { room, since, limit, webPeerId, aroundEventId });
  const media = readWebRoomMedia(ctx, { room, limit });
  const target = aroundEventId === null
    ? undefined
    : {
        event_id: aroundEventId,
        included: events.some((event) => event.event_id === aroundEventId),
        before_count: events.filter((event) => event.event_id < aroundEventId).length,
        after_count: events.filter((event) => event.event_id > aroundEventId).length,
      };
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
                activity_state, last_activity_at, last_cursor,
                lifecycle_state, archived_at, archived_reason, archive_source,
                created_at, updated_at, lease_expires_at > ? AS online
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
    launch_profiles: launchProfileStatus(ctx),
    launch_lifecycle: launchLifecycle,
    agent_runtime_details: agentRuntimeDetails,
    peers: [...peers, ...extraPeers],
    groups,
    group_paths: groupPaths,
    memberships,
    room_summaries: roomSummaries,
    events,
    media,
    skill_catalog: ctx.skillCatalog,
    ...(target ? { target } : {}),
  };
}

function launchToolStatus(): Record<"claude" | "pi" | "letta", WebLaunchToolStatus> {
  return {
    claude: launchToolStatusFor("claude"),
    pi: launchToolStatusFor("pi"),
    letta: launchToolStatusFor("letta"),
  };
}

function launchProfileStatus(ctx: DaemonContext): WebLaunchProfileStatus[] {
  return Object.entries(ctx.config.agents ?? {})
    .filter((entry): entry is [string, NonNullable<DaemonContext["config"]["agents"]>[string] & { tool: "claude" | "pi" | "letta" }] =>
      entry[1].tool === "claude" || entry[1].tool === "pi" || entry[1].tool === "letta",
    )
    .map(([name, profile]) => {
      const status = profile.bin
        ? { available: isExecutablePathAvailable(profile.bin), path: profile.bin }
        : launchToolStatusFor(profile.tool);
      const unsupportedRemoteLetta = profile.tool === "letta" && Boolean(profile.server || profile.agentId || profile.remote);
      return {
        name,
        tool: profile.tool,
        available: status.available && !unsupportedRemoteLetta,
        ...(status.path ? { path: status.path } : {}),
        ...(profile.model ? { model: profile.model } : {}),
        ...(profile.thinking ? { thinking: profile.thinking } : {}),
        ...(profile.sessionName ? { session_name: profile.sessionName } : {}),
        ...(profile.repo ? { repo: profile.repo } : {}),
        ...(unsupportedRemoteLetta ? { disabled_reason: "remote letta profiles are not group-spawnable" } : {}),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function isExecutablePathAvailable(path: string): boolean {
  if (path.includes("/")) return existsSync(path);
  return Boolean(Bun.which(path));
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

function launchToolStatusFor(tool: "claude" | "pi" | "letta"): WebLaunchToolStatus {
  const path = Bun.which(tool === "letta" ? "bun" : tool) ?? undefined;
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

// Deep links must open to events outside the latest room window, so target
// hydration fetches a bounded context window centred on around_event_id instead
// of the newest slice. Conservative bounds keep an old link from loading an
// unbounded transcript. ponytail: fixed 40/40; widen if context proves too thin.
const DEEP_LINK_WINDOW_BEFORE = 40;
const DEEP_LINK_WINDOW_AFTER = 40;

export function readWebRoomEvents(
  ctx: DaemonContext,
  input: { room: string | null; since: number; limit: number; webPeerId: string | null; aroundEventId?: number | null },
): WebEventRow[] {
  if (!input.room) return [];
  const around = input.aroundEventId ?? null;
  if (input.room.startsWith("group:")) {
    const groupId = Number.parseInt(input.room.slice("group:".length), 10);
    if (!Number.isInteger(groupId) || groupId < 1) {
      throw new HttpError(400, "invalid_request", "room must be group:<group_id> or dm:<peer_id>");
    }
    if (around !== null) {
      return readGroupAroundWindow(ctx, groupId, around);
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
    const dmWhere = `WHERE e.type = 'dm'
             AND ((e.sender_peer_id = ? AND e.recipient_peer_id = ?)
               OR (e.sender_peer_id = ? AND e.recipient_peer_id = ?))`;
    if (around !== null) {
      const before = ctx.db
        .query<WebEventRow, [string, string, string, string, number, number]>(webEventSelectSql(`${dmWhere} AND e.event_id <= ?`))
        .all(input.webPeerId, otherPeerId, otherPeerId, input.webPeerId, around, DEEP_LINK_WINDOW_BEFORE + 1);
      const after = ctx.db
        .query<WebEventRow, [string, string, string, string, number, number]>(webEventSelectSql(`${dmWhere} AND e.event_id > ?`))
        .all(input.webPeerId, otherPeerId, otherPeerId, input.webPeerId, around, DEEP_LINK_WINDOW_AFTER);
      return attachReactions(ctx.db, [...after, ...before].reverse());
    }
    const rows = ctx.db
      .query<WebEventRow, [string, string, string, string, number, number]>(webEventSelectSql(`${dmWhere} AND e.event_id > ?`))
      .all(input.webPeerId, otherPeerId, otherPeerId, input.webPeerId, input.since, input.limit)
      .reverse();
    return attachReactions(ctx.db, rows);
  }
  throw new HttpError(400, "invalid_request", "room must be group:<group_id> or dm:<peer_id>");
}

// Bounded window of group events centred on a target event id. When the target
// is a thread reply whose root falls outside the window, the root is added so the
// thread parent still renders without a second round trip.
function readGroupAroundWindow(ctx: DaemonContext, groupId: number, around: number): WebEventRow[] {
  const before = ctx.db
    .query<WebEventRow, [number, number, number]>(webEventSelectSql("WHERE e.group_id = ? AND e.event_id <= ?"))
    .all(groupId, around, DEEP_LINK_WINDOW_BEFORE + 1);
  const after = ctx.db
    .query<WebEventRow, [number, number, number]>(webEventSelectSql("WHERE e.group_id = ? AND e.event_id > ?"))
    .all(groupId, around, DEEP_LINK_WINDOW_AFTER);
  const rows = [...after, ...before].reverse();
  const targetRow = rows.find((row) => row.event_id === around);
  if (targetRow?.parent_event_id != null && !rows.some((row) => row.event_id === targetRow.parent_event_id)) {
    const root = ctx.db
      .query<WebEventRow, [number, number]>(webEventSelectSql("WHERE e.event_id = ?"))
      .get(targetRow.parent_event_id, 1);
    if (root) rows.unshift(root);
  }
  return attachReactions(ctx.db, rows);
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
    // An archived member's seat is RESERVED (not reclaimable). If a different
    // peer tries to take the alias, fail with a clear, actionable error instead
    // of a generic alias_collision from the unique index. The same peer resuming
    // its own archived seat is handled by the resume path, not here.
    const archivedHolder = ctx.db
      .query<{ peer_id: string }, [number, string]>(
        "SELECT peer_id FROM group_members WHERE group_id = ? AND alias = ? AND member_state = 'archived' LIMIT 1",
      )
      .get(group.group_id, alias);
    if (archivedHolder && archivedHolder.peer_id !== peer.peer_id) {
      debug(`guard: alias_reserved_by_archived alias=${alias} group=${group.name} held_by=${archivedHolder.peer_id} attempted_by=${peer.peer_id} (join)`);
      throw new HttpError(
        409,
        "alias_reserved_by_archived",
        `Alias '${alias}' is reserved by an archived session in group '${group.name}'. Resume or delete it to free the seat.`,
      );
    }
    // Detect alias reclaim: the most-recently-departed prior holder of this
    // alias belongs to a different peer_id. Respawn (same peer_id) is not a
    // reclaim. Only a 'left' member frees its alias for reclaim — an archived
    // seat is reserved (guarded above). The event leaves an audit trail so
    // observers can distinguish respawn from a new peer.
    const previousHolder = ctx.db
      .query<{ peer_id: string }, [number, string]>(
        `SELECT peer_id FROM group_members
         WHERE group_id = ? AND alias = ? AND member_state = 'left'
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
             (group_id, peer_id, alias, join_event_id, history_from_event_id, active, member_state, purpose, left_at)
           VALUES (?, ?, ?, ?, ?, 1, 'active', ?, NULL)
           ON CONFLICT(group_id, peer_id) DO UPDATE SET
             alias = excluded.alias,
             join_event_id = excluded.join_event_id,
             history_from_event_id = excluded.history_from_event_id,
             active = 1,
             member_state = 'active',
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
      .query("INSERT INTO groups (name, durable, media_dir, creator_peer_id, description, public_id) VALUES (?, 1, ?, NULL, NULL, ?)")
      .run(groupName, mediaDir, newGroupPublicId());
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
