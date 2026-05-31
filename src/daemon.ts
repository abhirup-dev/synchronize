import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { appendFile, copyFile, rm, stat, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { basename, extname, join } from "node:path";
import {
  ACTIVITY_STATES,
  type ActivityState,
  DEFAULT_BIND_HOST,
  DEFAULT_LEASE_MS,
  DEFAULT_PAGE_LIMIT,
  DEFAULT_PORT,
  ENV_BIND,
  ENV_PORT,
  ENV_TOKEN,
  MAX_MESSAGE_CHARS,
  MAX_PAGE_LIMIT,
  PEER_RETENTION_MS,
  SWEEP_INTERVAL_MS,
  API_VERSION,
} from "./constants.ts";
import { openDatabase, pruneEphemeralGroups } from "./db.ts";
import { ensureDir, writeJson } from "./fs.ts";
import { errorResponse, HttpError, jsonResponse } from "./http.ts";
import { getRuntimePaths, type RuntimePaths } from "./paths.ts";
import { collectDaemonProvenance, collectGitContext, type DaemonProvenance } from "./provenance.ts";
import { AoeBackend } from "./launch/backend.ts";
import { LaunchService, LaunchValidationError, aoeAttachCommand, aoeProfileName, aoeTitle, validateLaunchRequest } from "./launch/service.ts";
import { isLaunchTool } from "./launch/build.ts";
import { runEventQuery } from "./query/events.ts";
import { resolveProviderConfig } from "./llm/index.ts";
import {
  defaultStrategyFromEnv,
  isEnabled as isSummarizeEnabled,
  loadSummaryResponse,
  makeProviderCaller,
  startSummarizeWorker,
  strategyFromInput,
  summarizeThread,
  type WorkerHandle,
} from "./summarize/index.ts";
import type { ReactionSummary, ReplyDestination } from "./api/types.ts";

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
  summarizeWorker: WorkerHandle | null;
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

interface PeerRow {
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

interface EventRow {
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

interface InboxRow extends EventRow {
  delivered_at: string | null;
  read_at: string | null;
  acked_at: string | null;
}

interface GroupRow {
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

interface MediaRow {
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

interface MemberRow {
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

interface SummaryPeerRow {
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

interface SummaryGroupRow {
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

function log(message: string): void {
  console.error(`[synchronize-daemon] ${message}`);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveBind(env: NodeJS.ProcessEnv): { host: string; port: number } {
  const host = env[ENV_BIND] ?? DEFAULT_BIND_HOST;
  const rawPort = env[ENV_PORT];
  const port = rawPort ? Number.parseInt(rawPort, 10) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`${ENV_PORT} must be an integer from 0 to 65535`);
  }
  return { host, port };
}

function assertLanModeIsProtected(host: string, token: string | null): void {
  const localhost = host === "127.0.0.1" || host === "localhost" || host === "::1";
  if (!localhost && !token) {
    throw new Error(`${ENV_TOKEN} is required when ${ENV_BIND} is not localhost`);
  }
}

function requireAuth(request: Request, ctx: DaemonContext): void {
  if (!ctx.token) return;
  const header = request.headers.get("authorization");
  if (header !== `Bearer ${ctx.token}`) {
    throw new HttpError(401, "unauthorized", "A valid bearer token is required");
  }
}

async function route(request: Request, ctx: DaemonContext): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") {
    return jsonResponse({
      ok: true,
      service: "synchronize",
      api_version: API_VERSION,
      capabilities: [
        "peers",
        "dm",
        "inbox",
        "groups",
        "events",
        "event_subscriptions",
        "media",
        "summary",
      ],
      pid: process.pid,
      started_at: ctx.startedAt,
      provenance: ctx.provenance,
    });
  }

  if (request.method === "GET" && url.pathname === "/web/state") {
    requireAuth(request, ctx);
    const state = buildWebState(ctx, url);
    // The ETag must change whenever anything the client renders changes. The
    // event cursor alone is insufficient: presence is time-derived (a lapsed
    // lease flips a peer offline, and an activity push flips working/idle), and
    // roster metadata such as AOE attach commands can be derived from non-event
    // tables. Without folding those rendered fields in, the browser revalidates,
    // gets a 304, and serves a stale body.
    const presenceOf = (row: { presence?: string; online: boolean }): string =>
      row.presence ?? (row.online ? "online" : "offline");
    const renderSig = [
      ...Object.values(state.launch_tools).map((tool) => `${tool.tool}:${tool.available}:${tool.path ?? ""}`),
      ...state.peers.map(
        (p) =>
          `${p.peer_id}:${presenceOf(p)}:${p.aoe_session?.profile ?? ""}:${p.aoe_session?.title ?? ""}:${
            p.aoe_session?.attach_command ?? ""
          }`,
      ),
      ...state.memberships.map((m) => `${m.peer_id}@${m.group_id}:${presenceOf(m)}`),
      ...state.events.map((e) =>
        `${e.event_id}:${(e.reactions ?? [])
          .map((reaction) => `${reaction.emoji}:${reaction.count}:${reaction.by.map((actor) => actor.peer_id).sort().join(",")}`)
          .sort()
          .join(";")}`,
      ),
    ]
      .sort()
      .join("|");
    const etag = `W/"${state.cursor}.${Bun.hash(renderSig).toString(36)}"`;
    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers: { etag } });
    }
    return jsonResponse(state, { headers: { etag, "cache-control": "no-cache" } });
  }

  if (request.method === "POST" && url.pathname === "/web/session") {
    requireAuth(request, ctx);
    const peer = ensureLocalWebPeer(ctx);
    log(`local web session resolved peer_id=${peer.peer_id}`);
    emitWebStateChanged(ctx, { domains: ["peers"], peerId: peer.peer_id });
    return jsonResponse({ peer });
  }

  if (request.method === "GET" && url.pathname === "/web/events") {
    requireAuth(request, ctx);
    return openWebEvents(ctx);
  }

  if (request.method === "GET" && (url.pathname === "/web" || url.pathname === "/web/" || url.pathname.startsWith("/web/"))) {
    return serveWebAsset(url.pathname);
  }

  requireAuth(request, ctx);

  if (request.method === "GET" && url.pathname === "/status") {
    const peerCount = ctx.db
      .query<{ count: number }, []>("SELECT COUNT(*) AS count FROM peers WHERE deleted_at IS NULL")
      .get()?.count ?? 0;
    const groupCount = ctx.db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM groups").get()?.count ?? 0;
    const eventCount = ctx.db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM events").get()?.count ?? 0;
    return jsonResponse({
      ok: true,
      pid: process.pid,
      host: ctx.server.hostname,
      port: ctx.server.port,
      base_url: `http://${ctx.server.hostname}:${ctx.server.port}`,
      started_at: ctx.startedAt,
      machine: hostname(),
      token_required: Boolean(ctx.token),
      home: ctx.paths.home,
      db_path: ctx.paths.dbPath,
      media_path: ctx.paths.mediaPath,
      provenance: ctx.provenance,
      counts: {
        peers: peerCount,
        groups: groupCount,
        events: eventCount,
      },
    });
  }

  if (request.method === "GET" && url.pathname === "/summary") {
    const now = new Date().toISOString();
    const peerTotals =
      ctx.db
        .query<{ total: number; online: number }, [string]>(
          "SELECT COUNT(*) AS total, SUM(CASE WHEN lease_expires_at > ? THEN 1 ELSE 0 END) AS online FROM peers WHERE deleted_at IS NULL",
        )
        .get(now) ?? { total: 0, online: 0 };
    const groupTotals =
      ctx.db
        .query<{ total: number; durable: number; ephemeral: number }, []>(
          `SELECT
             COUNT(*) AS total,
             SUM(CASE WHEN durable = 1 THEN 1 ELSE 0 END) AS durable,
             SUM(CASE WHEN durable = 0 THEN 1 ELSE 0 END) AS ephemeral
           FROM groups`,
        )
        .get() ?? { total: 0, durable: 0, ephemeral: 0 };
    const eventTotals =
      ctx.db
        .query<{ total: number; last_event_at: string | null }, []>(
          "SELECT COUNT(*) AS total, MAX(created_at) AS last_event_at FROM events",
        )
        .get() ?? { total: 0, last_event_at: null };
    const inboxTotals =
      ctx.db
        .query<{ total: number; pending: number }, []>(
          "SELECT COUNT(*) AS total, SUM(CASE WHEN acked_at IS NULL THEN 1 ELSE 0 END) AS pending FROM inbox",
        )
        .get() ?? { total: 0, pending: 0 };
    const mediaTotals =
      ctx.db
        .query<{ files: number; bytes: number }, []>(
          "SELECT COUNT(*) AS files, COALESCE(SUM(size_bytes), 0) AS bytes FROM media_items",
        )
        .get() ?? { files: 0, bytes: 0 };
    const peers = ctx.db
      .query<SummaryPeerRow, [string]>(
        `SELECT
           p.peer_id,
           p.session_name,
           p.tool,
           p.purpose,
           p.lease_expires_at > ? AS online,
           p.activity_state,
           COUNT(DISTINCT CASE WHEN i.acked_at IS NULL THEN i.event_id END) AS pending_inbox,
           COUNT(DISTINCT CASE WHEN gm.active = 1 THEN gm.group_id END) AS groups,
           p.updated_at,
           (SELECT s.host_session_id FROM agent_sessions s
            WHERE s.peer_id = p.peer_id
            ORDER BY s.updated_at DESC, s.created_at DESC LIMIT 1) AS host_session_id
         FROM peers p
         LEFT JOIN inbox i ON i.recipient_peer_id = p.peer_id
         LEFT JOIN group_members gm ON gm.peer_id = p.peer_id
         WHERE p.deleted_at IS NULL
         GROUP BY p.peer_id
         ORDER BY online DESC, pending_inbox DESC, p.updated_at DESC
         LIMIT 12`,
      )
      .all(now);
    const groups = ctx.db
      .query<SummaryGroupRow, [string]>(
        `SELECT
           g.name,
           g.durable,
           COUNT(DISTINCT CASE WHEN gm.active = 1 THEN gm.peer_id END) AS members,
           COUNT(DISTINCT CASE WHEN gm.active = 1 AND p.lease_expires_at > ? THEN gm.peer_id END) AS online_members,
           COUNT(DISTINCT CASE WHEN e.type = 'group_message' THEN e.event_id END) AS messages,
           COUNT(DISTINCT mi.media_id) AS media,
           MAX(e.created_at) AS last_activity_at
         FROM groups g
         LEFT JOIN group_members gm ON gm.group_id = g.group_id
         LEFT JOIN peers p ON p.peer_id = gm.peer_id
         LEFT JOIN events e ON e.group_id = g.group_id
         LEFT JOIN media_items mi ON mi.group_id = g.group_id
         GROUP BY g.group_id
         ORDER BY last_activity_at DESC, g.name ASC
         LIMIT 12`,
      )
      .all(now);

    return jsonResponse({
      ok: true,
      daemon: {
        pid: process.pid,
        base_url: `http://${ctx.server.hostname}:${ctx.server.port}`,
        started_at: ctx.startedAt,
        token_required: Boolean(ctx.token),
        home: ctx.paths.home,
        db_path: ctx.paths.dbPath,
        media_path: ctx.paths.mediaPath,
        provenance: ctx.provenance,
      },
      totals: {
        peers: {
          total: peerTotals.total,
          online: peerTotals.online ?? 0,
          stale: peerTotals.total - (peerTotals.online ?? 0),
        },
        groups: {
          total: groupTotals.total,
          durable: groupTotals.durable ?? 0,
          ephemeral: groupTotals.ephemeral ?? 0,
        },
        events: {
          total: eventTotals.total,
          last_event_at: eventTotals.last_event_at,
        },
        inbox: {
          total: inboxTotals.total,
          pending: inboxTotals.pending ?? 0,
        },
        media: mediaTotals,
      },
      peers: peers.map((peer) => ({
        ...peer,
        online: Boolean(peer.online),
        presence: derivePresence(Boolean(peer.online), peer.activity_state),
      })),
      groups: groups.map((group) => ({ ...group, durable: Boolean(group.durable) })),
      generated_at: now,
    });
  }

  if (request.method === "POST" && url.pathname === "/agent-sessions/register") {
    const body = await readBody(request);
    const hostTool = requireString(body, "host_tool");
    const hostSessionId = requireString(body, "host_session_id");
    const requestedPeerId = optionalString(body, "peer_id");
    const sessionName = optionalString(body, "session_name") ?? `${hostTool}-${hostSessionId.slice(0, 8)}`;
    const tool = optionalString(body, "tool") ?? hostTool;
    const purpose = optionalString(body, "purpose");
    const peerId = requestedPeerId ?? findPeerByHostSession(ctx.db, hostTool, hostSessionId) ?? crypto.randomUUID();
    const machineId = optionalString(body, "machine_id") ?? hostname();
    const leaseExpiresAt = leaseExpiresAtForTool(tool);
    const metadata = optionalObjectJson(body, "metadata");
    const bindingId = `${hostTool}:${hostSessionId}`;
    const cwd = optionalString(body, "cwd") ?? null;
    const gitContext = collectGitContext(cwd);

    ctx.db.transaction(() => {
      upsertPeer(ctx.db, {
        peerId,
        tool,
        sessionName,
        purpose: purpose ?? null,
        machineId,
        leaseExpiresAt,
      });
      ctx.db
        .query(
          `INSERT INTO agent_sessions (
             binding_id, peer_id, host_tool, host_session_id, host_session_file, cwd, git_branch, git_dirty, pid,
             source, model, agent_type, metadata_json, launch_id, last_seen_at
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
           ON CONFLICT(host_tool, host_session_id) DO UPDATE SET
             peer_id = excluded.peer_id,
             host_session_file = excluded.host_session_file,
             cwd = excluded.cwd,
             git_branch = excluded.git_branch,
             git_dirty = excluded.git_dirty,
             pid = excluded.pid,
             source = excluded.source,
             model = excluded.model,
             agent_type = excluded.agent_type,
             metadata_json = excluded.metadata_json,
             launch_id = excluded.launch_id,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
             last_seen_at = excluded.last_seen_at`,
        )
        .run(
          bindingId,
          peerId,
          hostTool,
          hostSessionId,
          optionalString(body, "host_session_file") ?? null,
          cwd,
          gitContext.git_branch,
          gitContext.git_dirty === null ? null : Number(gitContext.git_dirty),
          optionalInteger(body, "pid") ?? null,
          optionalString(body, "source") ?? null,
          optionalString(body, "model") ?? null,
          optionalString(body, "agent_type") ?? null,
          metadata,
          optionalString(body, "launch_id") ?? null,
        );
    })();

    log(`agent session registered host_tool=${hostTool} host_session_id=${hostSessionId} peer_id=${peerId}`);
    emitWebStateChanged(ctx, { domains: ["peers", "agent_sessions"], peerId });
    // Server-side launch reconcile: if this register carries a launch_id with a
    // pending group, auto-join the peer to that group (best-effort).
    reconcileLaunch(ctx, optionalString(body, "launch_id") ?? null, peerId);
    return jsonResponse({ binding: getAgentSessionByPeer(ctx.db, peerId) }, { status: 201 });
  }

  if (request.method === "POST" && url.pathname === "/agent-sessions/launch") {
    const body = await readBody(request);
    let launchRequest;
    try {
      launchRequest = validateLaunchRequest(body);
    } catch (error) {
      if (error instanceof LaunchValidationError) throw new HttpError(400, "invalid_launch", error.message);
      throw error;
    }
    const result = await ctx.launchService.launch(launchRequest);
    log(`agent launch title=${result.title} launch_id=${result.launchId} peer_id=${result.peerId} group=${result.group ?? "<none>"}`);
    return jsonResponse(result, { status: 201 });
  }

  if (request.method === "POST" && url.pathname === "/agent-sessions/stop") {
    const body = await readBody(request);
    // Prefer the explicit title (always known from the launch response, works
    // even before the agent has registered). Otherwise derive the deterministic
    // backend title from the launch binding and current peer/group metadata.
    const explicitTitle = optionalString(body, "title");
    const peerId = optionalString(body, "peer_id");
    let title: string;
    if (explicitTitle) {
      title = explicitTitle;
    } else if (peerId) {
      title = deriveBackendTitleForPeer(ctx.db, peerId);
    } else {
      throw new HttpError(400, "invalid_stop", "stop requires title or peer_id");
    }
    await ctx.launchService.stop(title);
    // Drop any pending launch intent for this title (stopped before it registered).
    ctx.launchService.forgetByTitle(title);
    log(`agent stop title=${title}${peerId ? ` peer_id=${peerId}` : ""}`);
    return jsonResponse({ stopped: true, title, ...(peerId ? { peer_id: peerId } : {}) });
  }

  if (request.method === "GET" && url.pathname === "/agent-sessions") {
    const hostTool = url.searchParams.get("tool");
    const peerId = url.searchParams.get("peer_id");
    const launchId = url.searchParams.get("launch_id");
    return jsonResponse({ bindings: listAgentSessions(ctx.db, { hostTool, peerId, launchId }) });
  }

  const agentSessionGet = url.pathname.match(/^\/agent-sessions\/([^/]+)\/([^/]+)$/);
  if (request.method === "GET" && agentSessionGet) {
    const hostTool = decodeURIComponent(agentSessionGet[1] ?? "");
    const hostSessionId = decodeURIComponent(agentSessionGet[2] ?? "");
    return jsonResponse({ binding: getAgentSessionByHost(ctx.db, hostTool, hostSessionId) });
  }

  if (request.method === "POST" && url.pathname === "/agent-sessions/rename") {
    const body = await readBody(request);
    const sessionName = requireString(body, "session_name");
    const peerId =
      optionalString(body, "peer_id") ??
      findPeerByRequiredHostSession(ctx.db, requireString(body, "host_tool"), requireString(body, "host_session_id"));
    ensurePeer(ctx.db, peerId);
    ctx.db
      .query("UPDATE peers SET session_name = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE peer_id = ?")
      .run(sessionName, peerId);
    log(`agent session renamed peer_id=${peerId} session_name=${sessionName}`);
    emitWebStateChanged(ctx, { domains: ["peers", "agent_sessions"], peerId });
    return jsonResponse({ binding: getAgentSessionByPeer(ctx.db, peerId) });
  }

  if (request.method === "POST" && url.pathname === "/peers/register") {
    const body = await readBody(request);
    const sessionName = requireString(body, "session_name");
    const tool = optionalString(body, "tool") ?? "cli";
    const purpose = optionalString(body, "purpose");
    const peerId = optionalString(body, "peer_id") ?? crypto.randomUUID();
    const machineId = optionalString(body, "machine_id") ?? hostname();
    const leaseExpiresAt = leaseExpiresAtForTool(tool);

    upsertPeer(ctx.db, {
      peerId,
      tool,
      sessionName,
      purpose: purpose ?? null,
      machineId,
      leaseExpiresAt,
    });

    log(`peer registered peer_id=${peerId} session_name=${sessionName} tool=${tool} lease_expires_at=${leaseExpiresAt}`);
    emitWebStateChanged(ctx, { domains: ["peers"], peerId });
    return jsonResponse({ peer: getPeer(ctx.db, peerId) }, { status: 201 });
  }

  const peerHeartbeat = url.pathname.match(/^\/peers\/([^/]+)\/heartbeat$/);
  if (request.method === "PATCH" && peerHeartbeat) {
    const peerId = decodeURIComponent(peerHeartbeat[1] ?? "");
    const peer = getPeer(ctx.db, peerId);
    const leaseExpiresAt = leaseExpiresAtForTool(peer.tool);
    ctx.db
      .query(
        `UPDATE peers
         SET lease_expires_at = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE peer_id = ?`,
      )
      .run(leaseExpiresAt, peerId);
    log(`peer heartbeat peer_id=${peerId} lease_expires_at=${leaseExpiresAt}`);
    emitWebStateChanged(ctx, { domains: ["peers"], peerId });
    return jsonResponse({ peer: getPeer(ctx.db, peerId) });
  }

  // Activity push — the in-online sub-state signal. Accepts either an explicit
  // peer_id (Pi, in-process) or a host-session pair (stateless Claude hook) and
  // resolves the peer server-side. Sets activity_state + last_activity_at AND
  // refreshes the lease: activity is proof-of-life, so a busy agent never
  // false-offlines even if a heartbeat is dropped. Idempotent; last-write-wins.
  if (request.method === "POST" && url.pathname === "/peers/activity") {
    const body = await readBody(request);
    const state = requireString(body, "state");
    if (!(ACTIVITY_STATES as readonly string[]).includes(state)) {
      throw new HttpError(400, "invalid_activity_state", `Unknown activity state: ${state}`);
    }
    let peerId = optionalString(body, "peer_id");
    if (!peerId) {
      const hostTool = requireString(body, "host_tool");
      const hostSessionId = requireString(body, "host_session_id");
      peerId = findPeerByHostSession(ctx.db, hostTool, hostSessionId);
      if (!peerId) {
        throw new HttpError(404, "peer_not_found", `No peer for ${hostTool} session ${hostSessionId}`);
      }
    }
    const peer = getPeer(ctx.db, peerId);
    const leaseExpiresAt = leaseExpiresAtForTool(peer.tool);
    ctx.db
      .query(
        `UPDATE peers
         SET activity_state = ?, lease_expires_at = ?,
             last_activity_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE peer_id = ?`,
      )
      .run(state, leaseExpiresAt, peerId);
    log(`peer activity peer_id=${peerId} state=${state}`);
    emitWebStateChanged(ctx, { domains: ["peers"], peerId });
    return jsonResponse({ peer: getPeer(ctx.db, peerId) });
  }

  if (request.method === "GET" && url.pathname === "/peers") {
    const now = new Date().toISOString();
    const groupName = url.searchParams.get("group");
    if (groupName) {
      const group = getGroup(ctx.db, groupName);
      const rows = ctx.db
        .query<MemberRow & { online: number }, [string, number]>(
          `SELECT ${MEMBER_SELECT_SQL}, p.lease_expires_at > ? AS online
           FROM group_members gm
           JOIN peers p ON p.peer_id = gm.peer_id
           WHERE gm.group_id = ? AND gm.active = 1
           ORDER BY gm.alias ASC`,
        )
        .all(now, group.group_id);
      return jsonResponse({
        peers: rows.map((row) => ({
          ...row,
          active: Boolean(row.active),
          online: Boolean(row.online),
          presence: derivePresence(Boolean(row.online), row.activity_state),
        })),
      });
    }
    const rows = ctx.db
      .query<PeerRow & { online: number }, [string]>(
        `SELECT *, lease_expires_at > ? AS online
         FROM peers
         WHERE deleted_at IS NULL
         ORDER BY updated_at DESC, session_name ASC`,
      )
      .all(now);
    return jsonResponse({
      peers: rows.map((row) => ({
        ...row,
        online: Boolean(row.online),
        presence: derivePresence(Boolean(row.online), row.activity_state),
      })),
    });
  }

  const peerDelete = url.pathname.match(/^\/peers\/([^/]+)$/);
  if (request.method === "DELETE" && peerDelete) {
    const peerId = decodeURIComponent(peerDelete[1] ?? "");
    ensurePeer(ctx.db, peerId);
    // Soft-delete: mark the peer as deleted but keep the row so
    // group_members.peer_id remains resolvable and the reclaim audit trail
    // survives. Flip every active group_member row to inactive so rosters
    // and alias-collision checks don't trip over a peer that is no longer
    // online. left_at uses the same timestamp the peer was deleted at.
    ctx.db.transaction(() => {
      const now = new Date().toISOString();
      ctx.db
        .query("UPDATE peers SET deleted_at = ?, lease_expires_at = ? WHERE peer_id = ?")
        .run(now, now, peerId);
      ctx.db
        .query(
          "UPDATE group_members SET active = 0, left_at = COALESCE(left_at, ?) WHERE peer_id = ? AND active = 1",
        )
        .run(now, peerId);
    })();
    ctx.subscribers.delete(peerId);
    log(`peer soft-deleted peer_id=${peerId}; removed any in-memory subscriber`);
    emitWebStateChanged(ctx, { domains: ["peers", "groups"], peerId });
    return jsonResponse({ ok: true, peer_id: peerId });
  }

  if (request.method === "POST" && url.pathname === "/subscriptions") {
    const body = await readBody(request);
    const peerId = requireString(body, "peer_id");
    const callbackUrl = requireLocalCallbackUrl(requireString(body, "callback_url"));
    const token = requireString(body, "token");
    ensurePeer(ctx.db, peerId);
    const subscriber = {
      peer_id: peerId,
      callback_url: callbackUrl,
      token,
      created_at: new Date().toISOString(),
    };
    ctx.subscribers.set(peerId, subscriber);
    log(`subscription registered peer_id=${peerId} callback_url=${callbackUrl}`);
    return jsonResponse({ subscription: subscriber }, { status: 201 });
  }

  if (request.method === "POST" && url.pathname === "/query/events") {
    const body = await readBody(request);
    const sql = requireString(body, "sql");
    const params = optionalSqlParams(body, "params");
    const limit = optionalInteger(body, "limit");
    return jsonResponse(runEventQuery(ctx.db, { sql, ...(params ? { params } : {}), ...(limit !== undefined ? { limit } : {}) }));
  }

  if (request.method === "POST" && url.pathname === "/dm") {
    const body = await readBody(request);
    const senderPeerId = requireString(body, "sender_peer_id");
    const recipientPeerId = requireString(body, "recipient_peer_id");
    const message = requireString(body, "message");
    if (message.length > MAX_MESSAGE_CHARS) {
      throw new HttpError(413, "message_too_large", `Message exceeds ${MAX_MESSAGE_CHARS} characters`);
    }
    ensurePeer(ctx.db, senderPeerId);
    ensurePeer(ctx.db, recipientPeerId);

    const eventId = ctx.db.transaction(() => {
      ctx.db
        .query(
          `INSERT INTO events (type, sender_peer_id, recipient_peer_id, body)
           VALUES ('dm', ?, ?, ?)`,
        )
        .run(senderPeerId, recipientPeerId, message);
      const id = Number(ctx.db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()?.id);
      ctx.db
        .query("INSERT INTO inbox (recipient_peer_id, event_id) VALUES (?, ?)")
        .run(recipientPeerId, id);
      return id;
    })();
    const event = getEvent(ctx.db, eventId);
    log(`dm stored event_id=${eventId} sender=${senderPeerId} recipient=${recipientPeerId} body_chars=${message.length}`);
    emitWebStateChanged(ctx, { domains: ["events", "messages", "inbox"], eventId, peerId: recipientPeerId });
    void notifySubscribers(ctx, [recipientPeerId], event);

    return jsonResponse({ event }, { status: 201 });
  }

  if (request.method === "POST" && url.pathname === "/reply") {
    const body = await readBody(request);
    const senderPeerId = requireString(body, "sender_peer_id");
    const inReplyTo = requirePositiveInteger(body, "in_reply_to");
    const message = requireString(body, "message");
    if (message.length > MAX_MESSAGE_CHARS) {
      throw new HttpError(413, "message_too_large", `Message exceeds ${MAX_MESSAGE_CHARS} characters`);
    }

    const target = getVisibleEvent(ctx.db, inReplyTo, senderPeerId);
    if (target.type !== "group_message" && target.type !== "dm") {
      throw new HttpError(
        400,
        "reply_target_not_message",
        `Cannot reply to event ${inReplyTo}: type is '${target.type}', not 'group_message' or 'dm'`,
      );
    }

    if (target.type === "dm") {
      const recipientPeerId = target.sender_peer_id === senderPeerId ? target.recipient_peer_id : target.sender_peer_id;
      if (!recipientPeerId) {
        throw new HttpError(400, "reply_target_not_message", `Cannot reply to event ${inReplyTo}: missing DM peer`);
      }
      ensurePeer(ctx.db, senderPeerId);
      ensurePeer(ctx.db, recipientPeerId);

      const eventId = ctx.db.transaction(() => {
        ctx.db
          .query(
            `INSERT INTO events (type, sender_peer_id, recipient_peer_id, body, reply_to_event_id)
             VALUES ('dm', ?, ?, ?, ?)`,
          )
          .run(senderPeerId, recipientPeerId, message, target.event_id);
        const id = Number(ctx.db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()?.id);
        ctx.db
          .query("INSERT INTO inbox (recipient_peer_id, event_id) VALUES (?, ?)")
          .run(recipientPeerId, id);
        return id;
      })();
      const event = getEvent(ctx.db, eventId);
      const postedTo = buildReplyDestination(ctx.db, target, event);
      log(`reply dm stored event_id=${eventId} target=${inReplyTo} sender=${senderPeerId} recipient=${recipientPeerId} body_chars=${message.length}`);
      emitWebStateChanged(ctx, { domains: ["events", "messages", "inbox"], eventId, peerId: recipientPeerId });
      void notifySubscribers(ctx, [recipientPeerId], event);

      return jsonResponse({ event, posted_to: postedTo }, { status: 201 });
    }

    if (target.group_id === null) {
      throw new HttpError(400, "reply_target_not_message", `Cannot reply to event ${inReplyTo}: missing group`);
    }
    const group = getGroupById(ctx.db, target.group_id);
    ensureActiveMember(ctx.db, group.group_id, senderPeerId);
    const parentEventId = target.parent_event_id;
    const { peerIds: rawMentionedPeerIds, warnings } = resolveMentions(ctx.db, group.group_id, message);
    const mentionedPeerIds = rawMentionedPeerIds.filter((peerId) => peerId !== senderPeerId);
    const mentionsJson = mentionedPeerIds.length > 0 ? JSON.stringify(mentionedPeerIds) : null;

    let pushTargets: string[] = [];
    let allRecipients: string[] = [];
    const eventId = ctx.db.transaction(() => {
      ctx.db
        .query(
          "INSERT INTO events (type, sender_peer_id, group_id, body, parent_event_id, reply_to_event_id, mentions_json) VALUES ('group_message', ?, ?, ?, ?, ?, ?)",
        )
        .run(senderPeerId, group.group_id, message, parentEventId, target.event_id, mentionsJson);
      const id = Number(ctx.db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()?.id);
      allRecipients = ctx.db
        .query<{ peer_id: string }, [number, string]>(
          "SELECT peer_id FROM group_members WHERE group_id = ? AND active = 1 AND peer_id != ?",
        )
        .all(group.group_id, senderPeerId)
        .map((recipient) => recipient.peer_id);
      const insertInbox = ctx.db.query("INSERT OR IGNORE INTO inbox (recipient_peer_id, event_id) VALUES (?, ?)");
      for (const recipient of allRecipients) insertInbox.run(recipient, id);

      const mentionedActive = mentionedPeerIds.filter((peerId) => peerId !== senderPeerId && allRecipients.includes(peerId));
      let pushSet: Set<string>;
      if (parentEventId === null) {
        pushSet = new Set(mentionedActive);
      } else {
        const threadPosters = computeThreadParticipants(ctx.db, parentEventId, senderPeerId);
        pushSet = new Set([...threadPosters, ...mentionedActive].filter((peerId) => allRecipients.includes(peerId)));
      }
      pushTargets = [...pushSet];
      return id;
    })();
    const event = getEvent(ctx.db, eventId);
    const postedTo = buildReplyDestination(ctx.db, target, event);
    log(
      `reply group stored event_id=${eventId} target=${inReplyTo} group=${group.name} sender=${senderPeerId} push=${pushTargets.length} mentions=${mentionedPeerIds.length} surface=${postedTo.surface} unresolved=${warnings.length}`,
    );
    emitWebStateChanged(ctx, { domains: ["events", "messages", "inbox"], eventId, groupId: group.group_id, peerId: senderPeerId });
    void notifySubscribers(ctx, pushTargets, event);

    const delivery = {
      pushed_to: pushTargets,
      inbox_only: allRecipients.filter((peerId) => !pushTargets.includes(peerId)),
    };
    return jsonResponse({ event, posted_to: postedTo, warnings, delivery }, { status: 201 });
  }

  if (request.method === "POST" && url.pathname === "/groups") {
    const body = await readBody(request);
    const name = requireGroupName(requireString(body, "name"));
    const creatorPeerId = optionalString(body, "creator_peer_id");
    const description = optionalString(body, "description") ?? null;
    const durable = body.ephemeral === true ? 0 : 1;
    if (creatorPeerId) ensurePeer(ctx.db, creatorPeerId);
    // media_dir is always lowercased so case-only differences cannot collide
    // on case-insensitive filesystems (macOS APFS, Windows). Display name keeps
    // original case via groups.name.
    const mediaDir = `${ctx.paths.mediaPath}/${name.toLowerCase()}`;

    const groupId = ctx.db.transaction(() => {
      // Case-insensitive collision check. SQLite's UNIQUE constraint is
      // case-sensitive, so 'Foo' and 'foo' would otherwise both insert but
      // share the same lowercased media_dir on disk.
      const caseConflict = ctx.db
        .query<{ name: string }, [string]>(
          "SELECT name FROM groups WHERE LOWER(name) = LOWER(?)",
        )
        .get(name);
      if (caseConflict) {
        throw new HttpError(
          409,
          "group_exists",
          `Group already exists (case-insensitive match): ${caseConflict.name}`,
        );
      }
      try {
        ctx.db
          .query("INSERT INTO groups (name, durable, media_dir, creator_peer_id, description) VALUES (?, ?, ?, ?, ?)")
          .run(name, durable, mediaDir, creatorPeerId ?? null, description);
      } catch (error) {
        throw mapSqliteConstraint(error, "group_exists", `Group already exists: ${name}`);
      }
      const id = Number(ctx.db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()?.id);
      insertGroupPath(ctx.db, id, defaultGroupPath(ctx));
      ctx.db
        .query("INSERT INTO events (type, sender_peer_id, group_id, body) VALUES ('group_created', ?, ?, ?)")
        .run(creatorPeerId ?? null, id, JSON.stringify({ name, durable: Boolean(durable) }));
      return id;
    })();

    emitWebStateChanged(ctx, { domains: ["groups", "events"], groupId });
    return jsonResponse({ group: formatGroup(getGroupById(ctx.db, groupId)) }, { status: 201 });
  }

  const groupPaths = url.pathname.match(/^\/groups\/([^/]+)\/paths$/);
  if (groupPaths && request.method === "GET") {
    const group = getGroup(ctx.db, decodeURIComponent(groupPaths[1] ?? ""));
    return jsonResponse({ paths: getGroupPaths(ctx.db, group.group_id) });
  }

  if (groupPaths && request.method === "POST") {
    const group = getGroup(ctx.db, decodeURIComponent(groupPaths[1] ?? ""));
    const body = await readBody(request);
    const path = requireLaunchPath(requireString(body, "path"));
    const label = optionalString(body, "label") ?? null;
    insertGroupPath(ctx.db, group.group_id, path, label);
    emitWebStateChanged(ctx, { domains: ["groups"], groupId: group.group_id });
    return jsonResponse({ paths: getGroupPaths(ctx.db, group.group_id) }, { status: 201 });
  }

  if (request.method === "GET" && url.pathname === "/groups") {
    const member = url.searchParams.get("member");
    if (member) {
      // Scoped listing: groups this peer is an ACTIVE member of, with the
      // peer's own alias + join time. Powers bridge_list_groups({ mine: true }).
      const rows = ctx.db
        .query<GroupRow & { alias: string; joined_at: string }, [string]>(
          `SELECT g.*, gm.alias AS alias, gm.joined_at AS joined_at
           FROM groups g
           JOIN group_members gm ON gm.group_id = g.group_id
           WHERE gm.peer_id = ? AND gm.active = 1
           ORDER BY g.name ASC`,
        )
        .all(member);
      return jsonResponse({
        groups: rows.map((row) => ({ ...formatGroup(row), alias: row.alias, joined_at: row.joined_at })),
      });
    }
    const rows = ctx.db.query<GroupRow, []>("SELECT * FROM groups ORDER BY name ASC").all();
    return jsonResponse({ groups: rows.map(formatGroup) });
  }

  const groupMatch = url.pathname.match(/^\/groups\/([^/]+)$/);
  if (request.method === "GET" && groupMatch) {
    const group = getGroup(ctx.db, decodeURIComponent(groupMatch[1] ?? ""));
    return jsonResponse({ group: formatGroup(group), members: getGroupMembers(ctx.db, group.group_id), paths: getGroupPaths(ctx.db, group.group_id) });
  }

  const groupJoin = url.pathname.match(/^\/groups\/([^/]+)\/join$/);
  if (request.method === "POST" && groupJoin) {
    const group = getGroup(ctx.db, decodeURIComponent(groupJoin[1] ?? ""));
    const body = await readBody(request);
    const peerId = requireString(body, "peer_id");
    const peer = getPeer(ctx.db, peerId);
    const alias = optionalString(body, "alias") ?? peer.session_name;
    const fresh = body.fresh === true;

    // Idempotent short-circuit: if this peer is already an active member of
    // the group with the exact same alias, return current state without
    // emitting a phantom group_joined event. A naive re-join (e.g. "join
    // just to be safe") would otherwise pollute the event stream and the
    // inboxes of every other active member.
    const existing = ctx.db
      .query<{ alias: string; active: number }, [number, string]>(
        "SELECT alias, active FROM group_members WHERE group_id = ? AND peer_id = ?",
      )
      .get(group.group_id, peerId);
    if (existing && existing.active === 1 && existing.alias === alias) {
      return jsonResponse({
        member: getGroupMember(ctx.db, group.group_id, peerId),
        event: null,
        already_member: true,
      });
    }

    const { eventId: joinEventId, reclaimed } = joinGroupCore(ctx, group, peer, alias, fresh);

    emitWebStateChanged(ctx, { domains: ["groups", "events", "inbox"], eventId: joinEventId, groupId: group.group_id, peerId });
    return jsonResponse({
      member: getGroupMember(ctx.db, group.group_id, peerId),
      event: getEvent(ctx.db, joinEventId),
      ...(reclaimed ? { reclaimed_from: reclaimed } : {}),
    });
  }

  const groupRename = url.pathname.match(/^\/groups\/([^/]+)\/rename$/);
  if (request.method === "POST" && groupRename) {
    const group = getGroup(ctx.db, decodeURIComponent(groupRename[1] ?? ""));
    const body = await readBody(request);
    const peerId = requireString(body, "peer_id");
    const newAlias = requireString(body, "new_alias");
    ensureActiveMember(ctx.db, group.group_id, peerId);

    const renameEventId = ctx.db.transaction(() => {
      const current = ctx.db
        .query<{ alias: string }, [number, string]>(
          "SELECT alias FROM group_members WHERE group_id = ? AND peer_id = ?",
        )
        .get(group.group_id, peerId);
      const oldAlias = current?.alias ?? "";
      if (oldAlias === newAlias) {
        throw new HttpError(400, "no_op_rename", `Alias is already '${newAlias}'`);
      }
      try {
        ctx.db
          .query("UPDATE group_members SET alias = ? WHERE group_id = ? AND peer_id = ?")
          .run(newAlias, group.group_id, peerId);
      } catch (error) {
        throw mapSqliteConstraint(
          error,
          "alias_collision",
          `Alias '${newAlias}' is already active in group '${group.name}'.`,
        );
      }
      ctx.db
        .query(
          `INSERT INTO events (type, sender_peer_id, group_id, body)
           VALUES ('group_member_renamed', ?, ?, ?)`,
        )
        .run(peerId, group.group_id, JSON.stringify({ old_alias: oldAlias, new_alias: newAlias }));
      const id = Number(ctx.db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()?.id);
      fanoutRosterEventToInbox(ctx.db, group.group_id, id, peerId);
      return id;
    })();

    emitWebStateChanged(ctx, { domains: ["groups", "events", "inbox"], eventId: renameEventId, groupId: group.group_id, peerId });
    return jsonResponse({
      member: getGroupMember(ctx.db, group.group_id, peerId),
      event: getEvent(ctx.db, renameEventId),
    });
  }

  const groupPatch = url.pathname.match(/^\/groups\/([^/]+)$/);
  if (request.method === "PATCH" && groupPatch) {
    const group = getGroup(ctx.db, decodeURIComponent(groupPatch[1] ?? ""));
    const body = await readBody(request);
    if (!("description" in body)) {
      throw new HttpError(400, "invalid_request", "PATCH /groups/:name expects a body with at least one updatable field (description)");
    }
    const raw = body.description;
    let description: string | null;
    if (raw === null) {
      description = null;
    } else if (typeof raw === "string") {
      const trimmed = raw.trim();
      description = trimmed === "" ? null : trimmed;
    } else {
      throw new HttpError(400, "invalid_request", "description must be a string or null");
    }
    ctx.db
      .query("UPDATE groups SET description = ? WHERE group_id = ?")
      .run(description, group.group_id);
    emitWebStateChanged(ctx, { domains: ["groups"], groupId: group.group_id });
    return jsonResponse({ group: formatGroup(getGroup(ctx.db, group.name)) });
  }

  const groupLeave = url.pathname.match(/^\/groups\/([^/]+)\/leave$/);
  if (request.method === "POST" && groupLeave) {
    const group = getGroup(ctx.db, decodeURIComponent(groupLeave[1] ?? ""));
    const body = await readBody(request);
    const peerId = requireString(body, "peer_id");
    // Idempotent: if the peer is not an active member, return ok without
    // emitting a phantom group_left event. Mirrors bridge_join_group's
    // already_member: true shape so the API stays consistent.
    const currentMember = ctx.db
      .query<{ active: number }, [number, string]>(
        "SELECT active FROM group_members WHERE group_id = ? AND peer_id = ?",
      )
      .get(group.group_id, peerId);
    if (!currentMember || currentMember.active === 0) {
      return jsonResponse({ ok: true, event: null, already_left: true });
    }
    const eventId = ctx.db.transaction(() => {
      ctx.db
        .query(
          `UPDATE group_members
           SET active = 0, left_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
           WHERE group_id = ? AND peer_id = ?`,
        )
        .run(group.group_id, peerId);
      ctx.db.query("INSERT INTO events (type, sender_peer_id, group_id) VALUES ('group_left', ?, ?)").run(peerId, group.group_id);
      const id = Number(ctx.db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()?.id);
      fanoutRosterEventToInbox(ctx.db, group.group_id, id, peerId);
      return id;
    })();
    emitWebStateChanged(ctx, { domains: ["groups", "events", "inbox"], eventId, groupId: group.group_id, peerId });
    return jsonResponse({ ok: true, event: getEvent(ctx.db, eventId) });
  }

  const groupMessages = url.pathname.match(/^\/groups\/([^/]+)\/messages$/);
  if (request.method === "POST" && groupMessages) {
    const group = getGroup(ctx.db, decodeURIComponent(groupMessages[1] ?? ""));
    const body = await readBody(request);
    const senderPeerId = requireString(body, "sender_peer_id");
    const message = requireString(body, "message");
    const inReplyTo = optionalInteger(body, "in_reply_to");
    if (message.length > MAX_MESSAGE_CHARS) {
      throw new HttpError(413, "message_too_large", `Message exceeds ${MAX_MESSAGE_CHARS} characters`);
    }
    ensureActiveMember(ctx.db, group.group_id, senderPeerId);
    const parentEventId = inReplyTo !== undefined ? resolveThreadParent(ctx.db, group.group_id, inReplyTo) : null;
    const directReplyTarget = inReplyTo !== undefined ? getEvent(ctx.db, inReplyTo) : null;
    const { peerIds: rawMentionedPeerIds, warnings } = resolveMentions(ctx.db, group.group_id, message);
    // Self-mentions are filtered out: `mentions_json` should reflect peers
    // actually targeted by the mention semantics. Since the sender is always
    // excluded from both push and inbox fanout, advertising a self-mention
    // would mislead observers about who got notified.
    const mentionedPeerIds = rawMentionedPeerIds.filter((peerId) => peerId !== senderPeerId);
    const mentionsJson = mentionedPeerIds.length > 0 ? JSON.stringify(mentionedPeerIds) : null;

    let pushTargets: string[] = [];
    let allRecipients: string[] = [];
    const eventId = ctx.db.transaction(() => {
      ctx.db
        .query(
          "INSERT INTO events (type, sender_peer_id, group_id, body, parent_event_id, reply_to_event_id, mentions_json) VALUES ('group_message', ?, ?, ?, ?, ?, ?)",
        )
        .run(senderPeerId, group.group_id, message, parentEventId, directReplyTarget?.event_id ?? null, mentionsJson);
      const id = Number(ctx.db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()?.id);
      // Durable inbox fanout: every active member except the sender, regardless
      // of mention status — durable visibility is the same as v0; only push
      // is mention/thread-aware.
      allRecipients = ctx.db
        .query<{ peer_id: string }, [number, string]>(
          "SELECT peer_id FROM group_members WHERE group_id = ? AND active = 1 AND peer_id != ?",
        )
        .all(group.group_id, senderPeerId)
        .map((recipient) => recipient.peer_id);
      const insertInbox = ctx.db.query("INSERT OR IGNORE INTO inbox (recipient_peer_id, event_id) VALUES (?, ?)");
      for (const recipient of allRecipients) insertInbox.run(recipient, id);

      // Push fanout. Main channel: mentioned peers only. Thread reply: root
      // author ∪ prior thread posters ∪ this-message mentions, excluding the
      // sender. Intersect with the active roster so a stale alias resolving
      // to a since-left peer doesn't push to someone who can't see the group.
      const mentionedActive = mentionedPeerIds.filter((peerId) => peerId !== senderPeerId && allRecipients.includes(peerId));
      let pushSet: Set<string>;
      if (parentEventId === null) {
        pushSet = new Set(mentionedActive);
      } else {
        const threadPosters = computeThreadParticipants(ctx.db, parentEventId, senderPeerId);
        pushSet = new Set([...threadPosters, ...mentionedActive].filter((peerId) => allRecipients.includes(peerId)));
      }
      pushTargets = [...pushSet];
      return id;
    })();
    const event = getEvent(ctx.db, eventId);
    log(
      `group message stored event_id=${eventId} group=${group.name} sender=${senderPeerId} push=${pushTargets.length} mentions=${mentionedPeerIds.length} thread=${parentEventId ?? "main"} unresolved=${warnings.length}`,
    );
    emitWebStateChanged(ctx, { domains: ["events", "messages", "inbox"], eventId, groupId: group.group_id, peerId: senderPeerId });
    void notifySubscribers(ctx, pushTargets, event);

    // Always return `warnings` (and `delivery`) so consumers can destructure
    // without optional-chaining. Default-undefined fields are a trap for
    // LLM agents that may not write defensive code.
    const delivery = {
      pushed_to: pushTargets,
      inbox_only: allRecipients.filter((peerId) => !pushTargets.includes(peerId)),
    };
    return jsonResponse({ event, posted_to: buildReplyDestination(ctx.db, directReplyTarget, event), warnings, delivery }, { status: 201 });
  }

  const groupHistory = url.pathname.match(/^\/groups\/([^/]+)\/history$/);
  if (request.method === "GET" && groupHistory) {
    const group = getGroup(ctx.db, decodeURIComponent(groupHistory[1] ?? ""));
    const peerId = url.searchParams.get("peer_id");
    if (!peerId) throw new HttpError(400, "invalid_request", "peer_id query parameter is required");
    const member = ensureActiveMember(ctx.db, group.group_id, peerId);
    const limit = parseLimit(url.searchParams.get("limit"));
    const cursor = parseCursor(url.searchParams.get("cursor"));
    const threadOf = parseOptionalPositiveInt(url.searchParams.get("thread_of"), "thread_of");
    const historyFrom = Math.max(member.history_from_event_id ?? 0, cursor + 1);
    let rows: EventRow[];
    if (threadOf !== undefined) {
      const root = ctx.db
        .query<EventRow, [number, number]>(
          `SELECT e.*, g.name AS group_name
           FROM events e
           LEFT JOIN groups g ON g.group_id = e.group_id
           WHERE e.event_id = ? AND e.group_id = ?`,
        )
        .get(threadOf, group.group_id);
      if (!root) throw new HttpError(404, "thread_root_not_found", `No such event in group: ${threadOf}`);
      if (root.parent_event_id !== null) {
        throw new HttpError(400, "thread_of_not_root", `thread_of must reference a thread root (event ${threadOf} is itself a reply)`);
      }
      rows = ctx.db
        .query<EventRow, [number, number, number, number, number]>(
          `SELECT e.*, g.name AS group_name
           FROM events e
           LEFT JOIN groups g ON g.group_id = e.group_id
           WHERE e.group_id = ? AND e.event_id >= ? AND (e.event_id = ? OR e.parent_event_id = ?)
           ORDER BY e.event_id ASC
           LIMIT ?`,
        )
        .all(group.group_id, historyFrom, threadOf, threadOf, limit);
    } else {
      // Main-channel view augments each row with reply_count + last_reply_event_id
      // so agents can discover threads without an extra per-event probe.
      // This is the affordance that sync-0gl asked for: default history alone
      // tells the caller which messages have replies and how to drill in.
      type MainRow = EventRow & { reply_count: number; last_reply_event_id: number | null };
      const mainRows = ctx.db
        .query<MainRow, [number, number, number]>(
          `SELECT e.*,
                  g.name AS group_name,
                  (SELECT COUNT(*) FROM events r WHERE r.parent_event_id = e.event_id) AS reply_count,
                  (SELECT MAX(event_id) FROM events r WHERE r.parent_event_id = e.event_id) AS last_reply_event_id
           FROM events e
           LEFT JOIN groups g ON g.group_id = e.group_id
           WHERE e.group_id = ? AND e.event_id >= ? AND e.parent_event_id IS NULL
           ORDER BY e.event_id ASC
           LIMIT ?`,
        )
        .all(group.group_id, historyFrom, limit);
      return jsonResponse({ events: attachReactions(ctx.db, mainRows), next_cursor: mainRows.at(-1)?.event_id ?? cursor });
    }
    return jsonResponse({ events: attachReactions(ctx.db, rows), next_cursor: rows.at(-1)?.event_id ?? cursor });
  }

  // GET /events/:event_id — single-event lookup with visibility enforcement.
  // Asked for by bob and alice in the 2026-05-23 customer review: when a
  // channel notification carries `event_id=22`, agents have no way to re-read
  // that row to verify parent/mention/body fields without scrolling history.
  const eventGet = url.pathname.match(/^\/events\/(\d+)$/);
  if (request.method === "GET" && eventGet) {
    const eventId = Number(eventGet[1]);
    const peerId = url.searchParams.get("peer_id");
    if (!peerId) throw new HttpError(400, "invalid_request", "peer_id query parameter is required");
    const event = getVisibleEvent(ctx.db, eventId, peerId);
    return jsonResponse({ event });
  }

  const eventReactions = url.pathname.match(/^\/events\/(\d+)\/reactions$/);
  if (eventReactions) {
    const eventId = Number(eventReactions[1]);
    if (request.method === "GET") {
      const peerId = url.searchParams.get("peer_id");
      if (!peerId) throw new HttpError(400, "invalid_request", "peer_id query parameter is required");
      const event = getVisibleEvent(ctx.db, eventId, peerId);
      return jsonResponse({ event, reactions: event.reactions ?? [] });
    }
    if (request.method === "POST") {
      const body = await readBody(request);
      const peerId = requireString(body, "peer_id");
      const emoji = requireEmoji(requireString(body, "emoji"));
      const op = optionalReactionOp(body);
      const event = getVisibleEvent(ctx.db, eventId, peerId);
      ensureReactableEvent(event);
      if (event.group_id !== null) ensureActiveMember(ctx.db, event.group_id, peerId);
      const result = applyReaction(ctx.db, { eventId, peerId, emoji, op });
      const updated = getEvent(ctx.db, eventId);
      emitWebStateChanged(ctx, {
        domains: ["reactions"],
        eventId,
        groupId: updated.group_id,
        peerId: updated.group_id === null ? reactionDmPeerId(updated, peerId) : peerId,
      });
      return jsonResponse({ ...result, event: updated, reactions: updated.reactions ?? [] });
    }
  }

  if (request.method === "GET" && url.pathname === "/threads") {
    return jsonResponse({ threads: listThreadDiscoveries(ctx.db, url) });
  }

  const threadStatusGet = url.pathname.match(/^\/threads\/(\d+)\/status$/);
  if (request.method === "GET" && threadStatusGet) {
    return jsonResponse({ status: getThreadStatus(ctx.db, Number(threadStatusGet[1])) });
  }

  // GET /threads/:root/summary — cached read. Returns status="disabled" when
  // no LLM provider is configured (no OPENROUTER_API_KEY), "pending" when
  // enabled but no row yet, "ready" otherwise. `stale` flag tells the caller
  // whether new events have landed since the cached summary was written.
  const threadSummaryGet = url.pathname.match(/^\/threads\/(\d+)\/summary$/);
  if (request.method === "GET" && threadSummaryGet) {
    const rootEventId = Number(threadSummaryGet[1]);
    return jsonResponse(loadSummaryResponse(ctx.db, rootEventId, isSummarizeEnabled(), defaultStrategyFromEnv()));
  }

  // POST /threads/:root/summary — force regen. Bypasses cold-gate and
  // min-replies (worker-side guards only). 503 if disabled.
  if (request.method === "POST" && threadSummaryGet) {
    const rootEventId = Number(threadSummaryGet[1]);
    const cfg = resolveProviderConfig();
    if (!cfg) {
      throw new HttpError(503, "summarize_disabled", "thread summaries are not configured (set OPENROUTER_API_KEY)");
    }
    const body = await readBody(request).catch(() => ({}));
    const strategy = strategyFromInput({
      strategy: optionalString(body, "strategy"),
      k: optionalInteger(body, "k"),
      first_k: optionalInteger(body, "first_k"),
      last_k: optionalInteger(body, "last_k"),
    });
    await summarizeThread(ctx.db, makeProviderCaller(cfg), rootEventId, { strategy });
    return jsonResponse(loadSummaryResponse(ctx.db, rootEventId, true, strategy));
  }

  // GET /threads/:root_event_id — single-call thread state: status + events
  // and optional transcript. Kept global for v0; callers that need strict
  // per-peer visibility should continue using group history with peer_id.
  const threadGet = url.pathname.match(/^\/threads\/(\d+)$/);
  if (request.method === "GET" && threadGet) {
    const rootEventId = Number(threadGet[1]);
    const format = url.searchParams.get("format") ?? "json";
    if (format !== "json" && format !== "transcript") {
      throw new HttpError(400, "invalid_request", "format must be json or transcript");
    }
    const root = getEvent(ctx.db, rootEventId);
    if (root.group_id === null) {
      throw new HttpError(400, "thread_of_not_root", `Event ${rootEventId} is a DM, not a group thread root`);
    }
    if (root.parent_event_id !== null) {
      throw new HttpError(400, "thread_of_not_root", `Event ${rootEventId} is itself a reply; pass the root event_id`);
    }
    const peerId = url.searchParams.get("peer_id");
    if (peerId) {
      const member = ctx.db
        .query<{ history_from_event_id: number | null }, [number, string]>(
          "SELECT history_from_event_id FROM group_members WHERE group_id = ? AND peer_id = ?",
        )
        .get(root.group_id, peerId);
      if (!member) throw new HttpError(404, "thread_not_visible", `Thread ${rootEventId} is not visible to peer ${peerId}`);
      if (rootEventId < (member.history_from_event_id ?? 0)) {
        throw new HttpError(404, "thread_not_visible", `Thread ${rootEventId} is before peer's history_from boundary`);
      }
    }
    const replies = attachReactions(ctx.db, ctx.db
      .query<EventRow, [number, number]>(
        `SELECT e.*, g.name AS group_name
         FROM events e
         LEFT JOIN groups g ON g.group_id = e.group_id
         WHERE e.group_id = ? AND e.parent_event_id = ?
         ORDER BY e.event_id ASC`,
      )
      .all(root.group_id, rootEventId));
    // Participants: deduped sender peer_ids across root + replies, with their
    // current alias in the group (NULL when the peer has since left or never
    // joined under an active alias). Mirrors what a thread header UI shows.
    const senderIds = new Set<string>([root.sender_peer_id, ...replies.map((r) => r.sender_peer_id)].filter((s): s is string => s !== null));
    const participants = [...senderIds].map((senderId) => {
      const aliasRow = ctx.db
        .query<{ alias: string; active: number }, [number, string]>(
          "SELECT alias, active FROM group_members WHERE group_id = ? AND peer_id = ?",
        )
        .get(root.group_id!, senderId);
      return {
        peer_id: senderId,
        alias: aliasRow?.alias ?? null,
        active: aliasRow ? Boolean(aliasRow.active) : false,
      };
    });
    const lastEventId = replies.length > 0 ? replies[replies.length - 1]!.event_id : rootEventId;
    return jsonResponse({
      root,
      replies,
      participants,
      reply_count: replies.length,
      last_event_id: lastEventId,
      status: getThreadStatus(ctx.db, rootEventId),
      events: [root, ...replies],
      ...(format === "transcript" ? { transcript: renderThreadTranscript(ctx.db, [root, ...replies]) } : {}),
    });
  }

  const groupMedia = url.pathname.match(/^\/groups\/([^/]+)\/media$/);
  if (request.method === "POST" && groupMedia) {
    const group = getGroup(ctx.db, decodeURIComponent(groupMedia[1] ?? ""));
    const body = await readBody(request);
    const sharedByPeerId = requireString(body, "shared_by_peer_id");
    const originalPath = requireString(body, "path");
    const description = optionalString(body, "description");
    ensureActiveMember(ctx.db, group.group_id, sharedByPeerId);

    const info = await stat(originalPath).catch(() => {
      throw new HttpError(400, "media_not_found", `File does not exist: ${originalPath}`);
    });
    if (!info.isFile()) throw new HttpError(400, "media_not_file", `Path is not a file: ${originalPath}`);

    await ensureDir(group.media_dir);
    const mediaId = crypto.randomUUID();
    const safeBase = basename(originalPath).replace(/[^a-zA-Z0-9._-]/g, "_");
    const copiedPath = join(group.media_dir, `${new Date().toISOString().replace(/[:.]/g, "-")}_${sharedByPeerId}_${safeBase}`);
    await copyFile(originalPath, copiedPath);
    const sha256 = await hashFile(copiedPath);
    const contentType = guessContentType(originalPath);

    let recipients: string[] = [];
    const eventId = ctx.db.transaction(() => {
      ctx.db
        .query(
          `INSERT INTO media_items
             (media_id, group_id, original_path, copied_path, size_bytes, sha256, content_type, description, shared_by_peer_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(mediaId, group.group_id, originalPath, copiedPath, info.size, sha256, contentType, description ?? null, sharedByPeerId);
      ctx.db
        .query("INSERT INTO events (type, sender_peer_id, group_id, body, media_id) VALUES ('media_shared', ?, ?, ?, ?)")
        .run(sharedByPeerId, group.group_id, description ?? "", mediaId);
      const id = Number(ctx.db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()?.id);
      recipients = ctx.db
        .query<{ peer_id: string }, [number, string]>(
          "SELECT peer_id FROM group_members WHERE group_id = ? AND active = 1 AND peer_id != ?",
        )
        .all(group.group_id, sharedByPeerId)
        .map((recipient) => recipient.peer_id);
      const insertInbox = ctx.db.query("INSERT OR IGNORE INTO inbox (recipient_peer_id, event_id) VALUES (?, ?)");
      for (const recipient of recipients) insertInbox.run(recipient, id);
      return id;
    })();

    const media = getMedia(ctx.db, mediaId);
    await appendMediaIndex(group, media);
    await writeMediaReadme(group, ctx.db);
    const event = getEvent(ctx.db, eventId);
    log(`media shared event_id=${eventId} group=${group.name} media_id=${mediaId} sender=${sharedByPeerId} recipients=${recipients.length}`);
    emitWebStateChanged(ctx, { domains: ["events", "media", "inbox"], eventId, groupId: group.group_id, peerId: sharedByPeerId });
    void notifySubscribers(ctx, recipients, event);
    return jsonResponse({ media, event }, { status: 201 });
  }

  if (request.method === "GET" && groupMedia) {
    const group = getGroup(ctx.db, decodeURIComponent(groupMedia[1] ?? ""));
    const query = url.searchParams.get("query")?.trim();
    const limit = parseLimit(url.searchParams.get("limit"));
    const rows = query
      ? ctx.db
          .query<MediaRow, [number, string, string, string, number]>(
            `SELECT * FROM media_items
             WHERE group_id = ? AND (media_id LIKE ? OR original_path LIKE ? OR description LIKE ?)
             ORDER BY created_at DESC
             LIMIT ?`,
          )
          .all(group.group_id, `%${query}%`, `%${query}%`, `%${query}%`, limit)
      : ctx.db
          .query<MediaRow, [number, number]>(
            `SELECT * FROM media_items
             WHERE group_id = ?
             ORDER BY created_at DESC
             LIMIT ?`,
          )
          .all(group.group_id, limit);
    return jsonResponse({ media: rows });
  }

  const mediaGet = url.pathname.match(/^\/media\/([^/]+)$/);
  if (request.method === "GET" && mediaGet) {
    return jsonResponse({ media: getMedia(ctx.db, decodeURIComponent(mediaGet[1] ?? "")) });
  }

  const inboxMatch = url.pathname.match(/^\/peers\/([^/]+)\/inbox$/);
  if (request.method === "GET" && inboxMatch) {
    const peerId = decodeURIComponent(inboxMatch[1] ?? "");
    ensurePeer(ctx.db, peerId);
    const limit = parseLimit(url.searchParams.get("limit"));
    const after = parseCursor(url.searchParams.get("cursor"));
    const includeAcked = url.searchParams.get("include_acked") === "true";
    const ackClause = includeAcked ? "" : "AND i.acked_at IS NULL";
    const rows = ctx.db
      .query<InboxRow, [string, number, number]>(
        `SELECT e.*, g.name AS group_name, i.delivered_at, i.read_at, i.acked_at
         FROM inbox i
         JOIN events e ON e.event_id = i.event_id
         LEFT JOIN groups g ON g.group_id = e.group_id
         WHERE i.recipient_peer_id = ? AND e.event_id > ? ${ackClause}
         ORDER BY e.event_id ASC
         LIMIT ?`,
      )
      .all(peerId, after, limit);
    if (rows.length > 0) {
      const now = new Date().toISOString();
      ctx.db
        .query(
          `UPDATE inbox
           SET read_at = COALESCE(read_at, ?)
           WHERE recipient_peer_id = ? AND event_id IN (${rows.map(() => "?").join(",")})`,
        )
        .run(now, peerId, ...rows.map((row) => row.event_id));
      emitWebStateChanged(ctx, { domains: ["inbox"], eventId: rows[rows.length - 1]!.event_id, peerId });
    }
    return jsonResponse({ events: attachReactions(ctx.db, rows), next_cursor: rows.at(-1)?.event_id ?? after });
  }

  const inboxAck = url.pathname.match(/^\/peers\/([^/]+)\/inbox\/ack$/);
  if (request.method === "POST" && inboxAck) {
    const peerId = decodeURIComponent(inboxAck[1] ?? "");
    ensurePeer(ctx.db, peerId);
    const body = await readBody(request);
    const ids = optionalIntegerArray(body, "event_ids");
    const now = new Date().toISOString();
    let changed = 0;
    if (ids && ids.length > 0) {
      changed = ctx.db
        .query(
          `UPDATE inbox
           SET acked_at = COALESCE(acked_at, ?)
           WHERE recipient_peer_id = ? AND event_id IN (${ids.map(() => "?").join(",")})`,
        )
        .run(now, peerId, ...ids).changes;
    } else {
      changed = ctx.db
        .query(
          `UPDATE inbox
           SET acked_at = COALESCE(acked_at, ?)
           WHERE recipient_peer_id = ? AND acked_at IS NULL`,
        )
        .run(now, peerId).changes;
    }
    if (changed > 0) emitWebStateChanged(ctx, { domains: ["inbox"], peerId });
    return jsonResponse({ ok: true, acked: changed });
  }

  const eventsMatch = url.pathname.match(/^\/events\/([^/]+)$/);
  if (request.method === "GET" && eventsMatch) {
    const peerId = decodeURIComponent(eventsMatch[1] ?? "");
    ensurePeer(ctx.db, peerId);
    const limit = parseLimit(url.searchParams.get("limit"));
    const cursor = parseCursor(url.searchParams.get("cursor"));
    const rows = ctx.db
      .query<InboxRow, [string, number, number]>(
        `SELECT e.*, g.name AS group_name, i.delivered_at, i.read_at, i.acked_at
         FROM inbox i
         JOIN events e ON e.event_id = i.event_id
         LEFT JOIN groups g ON g.group_id = e.group_id
         WHERE i.recipient_peer_id = ? AND e.event_id > ?
         ORDER BY e.event_id ASC
         LIMIT ?`,
      )
      .all(peerId, cursor, limit);
    if (rows.length > 0) {
      const now = new Date().toISOString();
      ctx.db
        .query(
          `UPDATE inbox
           SET delivered_at = COALESCE(delivered_at, ?)
           WHERE recipient_peer_id = ? AND event_id IN (${rows.map(() => "?").join(",")})`,
        )
        .run(now, peerId, ...rows.map((row) => row.event_id));
      ctx.db.query("UPDATE peers SET last_cursor = ? WHERE peer_id = ?").run(rows.at(-1)!.event_id, peerId);
      emitWebStateChanged(ctx, { domains: ["inbox", "peers"], eventId: rows[rows.length - 1]!.event_id, peerId });
    }
    return jsonResponse({ events: attachReactions(ctx.db, rows), next_cursor: rows.at(-1)?.event_id ?? cursor });
  }

  throw new HttpError(404, "not_found", `${request.method} ${url.pathname} is not implemented`);
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const value = await request.json().catch(() => {
    throw new HttpError(400, "invalid_json", "Request body must be valid JSON");
  });
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "invalid_json", "Request body must be a JSON object");
  }
  return value as Record<string, unknown>;
}

function requireString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpError(400, "invalid_request", `${key} is required`);
  }
  return value.trim();
}

function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new HttpError(400, "invalid_request", `${key} must be a string`);
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function optionalInteger(body: Record<string, unknown>, key: string): number | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (!Number.isInteger(value)) {
    throw new HttpError(400, "invalid_request", `${key} must be an integer`);
  }
  return value as number;
}

function requirePositiveInteger(body: Record<string, unknown>, key: string): number {
  const value = optionalInteger(body, key);
  if (value === undefined || value < 1) {
    throw new HttpError(400, "invalid_request", `${key} must be a positive integer`);
  }
  return value;
}

type ReactionOp = "add" | "remove" | "toggle";

function optionalReactionOp(body: Record<string, unknown>): ReactionOp {
  const value = body["op"];
  if (value === undefined || value === null) return "add";
  if (value === "add" || value === "remove" || value === "toggle") return value;
  throw new HttpError(400, "invalid_request", "op must be add, remove, or toggle");
}

function requireEmoji(value: string): string {
  if (value.length > 32 || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(value)) {
    throw new HttpError(400, "invalid_emoji", "emoji must be a short emoji or emoji alias");
  }
  return value;
}

function optionalSqlParams(body: Record<string, unknown>, key: string): Array<string | number | boolean | null> | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (
    !Array.isArray(value) ||
    value.some((item) => item !== null && typeof item !== "string" && typeof item !== "number" && typeof item !== "boolean")
  ) {
    throw new HttpError(400, "invalid_request", `${key} must be an array of strings, numbers, booleans, or nulls`);
  }
  return value as Array<string | number | boolean | null>;
}

function optionalObjectJson(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "invalid_request", `${key} must be an object`);
  }
  return JSON.stringify(value);
}

function optionalIntegerArray(body: Record<string, unknown>, key: string): number[] | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((item) => !Number.isInteger(item) || item < 1)) {
    throw new HttpError(400, "invalid_request", `${key} must be an array of positive integers`);
  }
  return value as number[];
}

function requireLocalCallbackUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError(400, "invalid_callback_url", "callback_url must be a valid URL");
  }
  const localHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
  if (url.protocol !== "http:" || !localHosts.has(url.hostname)) {
    throw new HttpError(400, "invalid_callback_url", "callback_url must be an http localhost URL");
  }
  return url.toString();
}

function requireGroupName(name: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(name)) {
    throw new HttpError(
      400,
      "invalid_group_name",
      "Group name must start with a letter or number and contain only letters, numbers, dots, underscores, or hyphens",
    );
  }
  return name;
}

function requireLaunchPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed.startsWith("/")) {
    throw new HttpError(400, "invalid_group_path", "Group path must be an absolute path");
  }
  return trimmed.replace(/\/+$/, "") || "/";
}

function parseLimit(raw: string | null): number {
  if (!raw) return DEFAULT_PAGE_LIMIT;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1) {
    throw new HttpError(400, "invalid_request", "limit must be a positive integer");
  }
  return Math.min(value, MAX_PAGE_LIMIT);
}

function parseCursor(raw: string | null): number {
  if (!raw) return 0;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 0) {
    throw new HttpError(400, "invalid_request", "cursor must be a non-negative integer");
  }
  return value;
}

function parseOptionalPositiveInt(raw: string | null, label: string): number | undefined {
  if (raw === null || raw === "") return undefined;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1) {
    throw new HttpError(400, "invalid_request", `${label} must be a positive integer`);
  }
  return value;
}

// Normalize Slack-style thread parents to a single level: a reply to a reply
// collapses to the original thread root. Returns the root event_id (always
// the root, never a leaf), or throws if in_reply_to is not a visible event in
// this group.
function resolveThreadParent(db: Database, groupId: number, inReplyTo: number): number {
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

const MENTION_TOKEN_RE = /@([a-zA-Z0-9][a-zA-Z0-9._-]*)/g;
const MENTION_TRAILING_PUNCTUATION_RE = /[.,;:!?]+$/;

function normalizeMentionToken(token: string): string {
  return token.replace(MENTION_TRAILING_PUNCTUATION_RE, "");
}

// Strip backtick-fenced regions (`...` and ```...```) before mention parsing.
// Alice flagged this during the sustained-thread test: discussing proposed
// syntax like `@peer:<uuid>` in prose produced false-positive
// alias_not_in_group warnings for `@peer` / `@id` / `@alias`. Treating
// backticked spans as code-not-prose mirrors how a reader interprets them.
function stripBacktickedRegions(message: string): string {
  // Fenced (```...```) first, then single (`...`). Replace with spaces of
  // matching length so character positions don't shift (cheap correctness
  // hedge in case anything downstream cares about positions).
  const withoutFenced = message.replace(/```[\s\S]*?```/g, (m) => " ".repeat(m.length));
  return withoutFenced.replace(/`[^`]*`/g, (m) => " ".repeat(m.length));
}

// Resolve @-mentions in a message body against the active member roster of
// the group. Returns deduped resolved peer_ids and a warning per unresolved
// token (no-op tokens, e.g. "@self", still warn — the daemon does not
// special-case the sender). Send still succeeds; warnings are advisory.
function resolveMentions(
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
    if (row) peerIds.push(row.peer_id);
    else warnings.push({ token: `@${token}`, reason: "alias_not_in_group" });
  }
  return { peerIds, warnings };
}

// Members of a thread for push fanout: the root author plus every distinct
// peer who has posted into the thread so far (the new reply has not yet been
// inserted at the time this is called). Excludes the current sender; callers
// union in this-message mentions separately.
function computeThreadParticipants(db: Database, rootEventId: number, sender: string): string[] {
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
function fanoutRosterEventToInbox(db: Database, groupId: number, eventId: number, actor: string): void {
  const recipients = db
    .query<{ peer_id: string }, [number, string]>(
      "SELECT peer_id FROM group_members WHERE group_id = ? AND active = 1 AND peer_id != ?",
    )
    .all(groupId, actor);
  const insertInbox = db.query("INSERT OR IGNORE INTO inbox (recipient_peer_id, event_id) VALUES (?, ?)");
  for (const recipient of recipients) insertInbox.run(recipient.peer_id, eventId);
}

function getPeer(db: Database, peerId: string): PeerRow {
  const peer = db
    .query<PeerRow, [string]>("SELECT * FROM peers WHERE peer_id = ? AND deleted_at IS NULL")
    .get(peerId);
  if (!peer) throw new HttpError(404, "peer_not_found", `Peer not found: ${peerId}`);
  return peer;
}

function ensurePeer(db: Database, peerId: string): void {
  getPeer(db, peerId);
}

function ensureLocalWebPeer(ctx: DaemonContext): PeerRow {
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

function leaseExpiresAtForTool(tool: string): string {
  return tool === "web" ? WEB_PEER_LEASE_EXPIRES_AT : new Date(Date.now() + DEFAULT_LEASE_MS).toISOString();
}

// Presence derivation — the single rule applied wherever a peer is serialized.
// Offline if the lease has lapsed (the only reliable crash detector); else the
// reported activity_state for instrumented agents; else a generic "online" for
// uninstrumented peers (web/cli/codex). See plan-agent-ttl-presence-v0.md.
type Presence = "offline" | "online" | ActivityState;
function derivePresence(online: boolean, activityState: string | null): Presence {
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
  const cutoff = new Date(Date.now() - PEER_RETENTION_MS).toISOString();
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
    log(`sweeper soft-deleted ${swept.length} peer(s) lease-expired > ${PEER_RETENTION_MS}ms`);
    emitWebStateChanged(ctx, { domains: ["peers", "groups"] });
  }
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

function findPeerByHostSession(db: Database, hostTool: string, hostSessionId: string): string | undefined {
  return db
    .query<{ peer_id: string }, [string, string]>(
      "SELECT peer_id FROM agent_sessions WHERE host_tool = ? AND host_session_id = ?",
    )
    .get(hostTool, hostSessionId)?.peer_id;
}

function findPeerByRequiredHostSession(db: Database, hostTool: string, hostSessionId: string): string {
  const peerId = findPeerByHostSession(db, hostTool, hostSessionId);
  if (!peerId) {
    throw new HttpError(404, "agent_session_not_found", `Agent session not found: ${hostTool}/${hostSessionId}`);
  }
  return peerId;
}

function listAgentSessions(
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

function getAgentSessionByHost(db: Database, hostTool: string, hostSessionId: string): ReturnType<typeof formatAgentSession> {
  const now = new Date().toISOString();
  const row = db
    .query<AgentSessionJoinedRow, [string, string, string]>(
      `${agentSessionSelectSql()} WHERE s.host_tool = ? AND s.host_session_id = ?`,
    )
    .get(now, hostTool, hostSessionId);
  if (!row) throw new HttpError(404, "agent_session_not_found", `Agent session not found: ${hostTool}/${hostSessionId}`);
  return formatAgentSession(row);
}

function getAgentSessionByPeer(db: Database, peerId: string): ReturnType<typeof formatAgentSession> {
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

function getEvent(db: Database, eventId: number): EventRow {
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

function getVisibleEvent(db: Database, eventId: number, peerId: string): EventRow {
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

function buildReplyDestination(db: Database, directEvent: EventRow | null, createdEvent: EventRow): ReplyDestination {
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

function ensureReactableEvent(event: EventRow): void {
  if (event.type !== "group_message" && event.type !== "dm") {
    throw new HttpError(400, "reaction_target_not_message", `Cannot react to event ${event.event_id}: type is '${event.type}'`);
  }
}

function applyReaction(
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

function reactionDmPeerId(event: EventRow, actorPeerId: string): string | null {
  if (event.recipient_peer_id === null) return actorPeerId;
  return event.sender_peer_id === actorPeerId ? event.recipient_peer_id : event.sender_peer_id;
}

function attachReactions<T extends EventRow>(db: Database, events: T[]): T[] {
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

function listThreadDiscoveries(db: Database, url: URL): ThreadDiscoveryRow[] {
  const limit = parseLimit(url.searchParams.get("limit"));
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  const group = url.searchParams.get("group")?.trim();
  const startedByPeerId = url.searchParams.get("started_by_peer_id")?.trim();
  const startedBySessionName = url.searchParams.get("started_by_session_name")?.trim();
  const participatedByPeerId = url.searchParams.get("participated_by_peer_id")?.trim();
  const participatedBySessionName = url.searchParams.get("participated_by_session_name")?.trim();
  const activeSince = url.searchParams.get("active_since")?.trim();

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
       ORDER BY dt.last_activity_at DESC, dt.root_event_id DESC
       LIMIT ?`,
    )
    .all(...params, limit);
}

function getThreadStatus(db: Database, rootEventId: number): ThreadStatusRow & { participants: Array<Omit<ThreadParticipantRow, "active"> & { active: boolean }> } {
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

function renderThreadTranscript(db: Database, events: EventRow[]): string {
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

function emitWebStateChanged(
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

function openWebEvents(ctx: DaemonContext): Response {
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
  peers: Array<PeerRow & { online: boolean; aoe_session?: WebAoeSession }>;
  groups: FormattedGroup[];
  group_paths: FormattedGroupPath[];
  memberships: Array<FormattedMember & { online: boolean }>;
  room_summaries: WebRoomSummary[];
  events: WebEventRow[];
  media: MediaRow[];
}

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

function buildWebState(ctx: DaemonContext, url: URL): WebStateResponse {
  const now = new Date().toISOString();
  const limit = parseLimit(url.searchParams.get("limit"));
  const since = parseCursor(url.searchParams.get("since"));
  const room = url.searchParams.get("room");
  const webPeerId = url.searchParams.get("peer_id");
  const cursor = ctx.db.query<{ cursor: number | null }, []>("SELECT MAX(event_id) AS cursor FROM events").get()?.cursor ?? 0;
  const aoeProfile = aoeProfileName(ctx.paths.home);
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
    peers,
    groups,
    group_paths: groupPaths,
    memberships,
    room_summaries: roomSummaries,
    events,
    media,
  };
}

function launchToolStatus(): Record<"claude" | "pi", WebLaunchToolStatus> {
  return {
    claude: launchToolStatusFor("claude"),
    pi: launchToolStatusFor("pi"),
  };
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

function readWebRoomEvents(
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

async function notifySubscribers(ctx: DaemonContext, peerIds: string[], event: EventRow): Promise<void> {
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
          body: JSON.stringify({ event }),
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

function getGroup(db: Database, name: string): GroupRow {
  const group = db.query<GroupRow, [string]>("SELECT * FROM groups WHERE name = ?").get(name);
  if (!group) throw new HttpError(404, "group_not_found", `Group not found: ${name}`);
  return group;
}

function getGroupById(db: Database, groupId: number): GroupRow {
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
function joinGroupCore(
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

type FormattedGroup = Omit<GroupRow, "durable"> & { durable: boolean };
type FormattedGroupPath = Omit<GroupPathRow, "active"> & { active: boolean };
type FormattedMember = Omit<MemberRow, "active"> & { active: boolean };

function formatGroup(group: GroupRow): FormattedGroup {
  return { ...group, durable: Boolean(group.durable) };
}

function formatGroupPath(path: GroupPathRow): FormattedGroupPath {
  return { ...path, active: Boolean(path.active) };
}

function insertGroupPath(db: Database, groupId: number, path: string, label: string | null = null): void {
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

function getGroupPaths(db: Database, groupId: number): FormattedGroupPath[] {
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

function defaultGroupPath(ctx: DaemonContext): string {
  return requireLaunchPath(ctx.provenance?.source_root ?? process.cwd());
}

const MEMBER_SELECT_SQL = `gm.*, p.session_name, p.tool, p.activity_state,
  (SELECT s.host_session_id FROM agent_sessions s
   WHERE s.peer_id = gm.peer_id
   ORDER BY s.updated_at DESC, s.created_at DESC LIMIT 1) AS host_session_id`;

function getGroupMembers(db: Database, groupId: number): FormattedMember[] {
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

function deriveBackendTitleForPeer(db: Database, peerId: string): string {
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

function getGroupMember(db: Database, groupId: number, peerId: string): FormattedMember {
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

function ensureActiveMember(db: Database, groupId: number, peerId: string): MemberRow {
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

function getMedia(db: Database, mediaId: string): MediaRow {
  const media = db.query<MediaRow, [string]>("SELECT * FROM media_items WHERE media_id = ?").get(mediaId);
  if (!media) throw new HttpError(404, "media_not_found", `Media not found: ${mediaId}`);
  return media;
}

async function hashFile(path: string): Promise<string> {
  const hasher = createHash("sha256");
  const bytes = await Bun.file(path).arrayBuffer();
  hasher.update(Buffer.from(bytes));
  return hasher.digest("hex");
}

function guessContentType(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === ".json") return "application/json";
  if (ext === ".md" || ext === ".txt") return "text/plain";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".pdf") return "application/pdf";
  return "application/octet-stream";
}

async function appendMediaIndex(group: GroupRow, media: MediaRow): Promise<void> {
  await ensureDir(group.media_dir);
  await appendFile(join(group.media_dir, "index.jsonl"), `${JSON.stringify(media)}\n`, "utf8");
}

async function writeMediaReadme(group: GroupRow, db: Database): Promise<void> {
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

function mapSqliteConstraint(error: unknown, code: string, message: string): Error {
  const text = error instanceof Error ? error.message : String(error);
  if (text.includes("UNIQUE constraint failed") || text.includes("constraint failed")) {
    return new HttpError(409, code, message);
  }
  return error instanceof Error ? error : new Error(text);
}

async function main(): Promise<void> {
  const paths = getRuntimePaths();
  await ensureDir(paths.home);
  await ensureDir(paths.mediaPath);

  const { db } = await openDatabase(paths.dbPath);
  await pruneEphemeralGroups(db, async (mediaDir) => {
    try {
      await rm(mediaDir, { recursive: true, force: true });
    } catch (error) {
      log(`ephemeral media_dir cleanup failed: ${mediaDir}: ${formatError(error)}`);
    }
  });
  const startedAt = new Date().toISOString();
  const provenance = collectDaemonProvenance();
  const token = process.env[ENV_TOKEN] ?? null;
  const { host, port } = resolveBind(process.env);
  assertLanModeIsProtected(host, token);

  let ctx: DaemonContext;
  const server = Bun.serve({
    hostname: host,
    port,
    fetch(request) {
      return route(request, ctx).catch((error) => errorResponse(error));
    },
  });

  const launchService = new LaunchService({
    backend: new AoeBackend({ profile: aoeProfileName(paths.home) }),
    home: paths.home,
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
    summarizeWorker,
  };
  ensureDefaultGroupPaths(ctx);

  // Retention sweeper: run once at startup (cleans up peers that died while the
  // daemon was down) then on an interval. unref so it never blocks shutdown.
  sweepExpiredPeers(ctx);
  const sweepTimer = setInterval(() => sweepExpiredPeers(ctx), SWEEP_INTERVAL_MS);
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

const WEB_DIST = process.env["SYNCHRONIZE_WEB_DIST"] ?? new URL("../web/dist", import.meta.url).pathname;

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

async function serveWebAsset(pathname: string): Promise<Response> {
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
