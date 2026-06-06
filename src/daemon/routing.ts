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

import {
  MEMBER_SELECT_SQL,
  ackInboxEvents,
  appendMediaIndex,
  applyLaunchTransition,
  applyReaction,
  attachReactions,
  attachmentExtension,
  buildReplyDestination,
  buildWebState,
  computeThreadParticipants,
  deactivateStoppedLaunchPeer,
  defaultGroupPath,
  deriveBackendTitleForPeer,
  derivePresence,
  emitWebStateChanged,
  ensureActiveMember,
  ensureLocalWebPeer,
  ensurePeer,
  ensureReactableEvent,
  eventForRecipient,
  fanoutRosterEventToInbox,
  findPeerByHostSession,
  findPeerByRequiredHostSession,
  formatGroup,
  getAgentSessionByHost,
  getAgentSessionByPeer,
  getEvent,
  getGroup,
  getGroupById,
  getGroupMember,
  getGroupMembers,
  getGroupPaths,
  getMedia,
  getPeer,
  getThreadStatus,
  getVisibleEvent,
  guessContentType,
  hashFile,
  insertGroupPath,
  joinGroupCore,
  leaseExpiresAtForTool,
  listAgentSessions,
  listGroupHistoryFlat,
  listGroupHistoryThreads,
  listThreadDiscoveries,
  loadThreadSummaryProjection,
  log,
  notifySubscribers,
  openWebEvents,
  reactionDmPeerId,
  readWebRoomEvents,
  reconcileLaunch,
  renderThreadTranscript,
  resolveMentions,
  resolveStagedAttachmentPath,
  resolveThreadParent,
  safePathSegment,
  serveWebAsset,
  softDeletePeerIfPresent,
  upsertPeer,
  webAttachmentRoot,
  writeMediaReadme
} from "./server.ts";
import type {
  ActivityRow,
  DaemonContext,
  EventRow,
  GroupRow,
  InboxRow,
  MediaRow,
  MemberRow,
  PeerRow,
  SummaryGroupRow,
  SummaryPeerRow
} from "./server.ts";

export async function route(request: Request, ctx: DaemonContext): Promise<Response> {
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
        "skill_catalog",
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
      ...state.launch_lifecycle.map(
        (launch) =>
          `${launch.launch_id}:${launch.peer_id}:${launch.state}:${launch.target_group ?? ""}:${launch.backend_title}:${
            launch.failure_code ?? ""
          }:${launch.updated_at}`,
      ),
      ...state.skill_catalog.map((skill) => `${skill.name}:${skill.runtimes.join(",")}:${skill.description}:${skill.source_path ?? ""}`),
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

  if (request.method === "POST" && url.pathname === "/web/attachments") {
    requireAuth(request, ctx);
    const form = await request.formData().catch(() => {
      throw new HttpError(400, "invalid_form", "Request body must be multipart form data");
    });
    const id = optionalFormString(form, "id") ?? crypto.randomUUID();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new HttpError(400, "invalid_request", "file is required");
    }
    const safeDraftId = safePathSegment(id, "attachment");
    const safeBase = safePathSegment(file.name || "attachment", "attachment");
    const dir = join(webAttachmentRoot(ctx.paths), safeDraftId);
    await ensureDir(dir);
    const path = join(dir, safeBase);
    await writeFile(path, new Uint8Array(await file.arrayBuffer()));
    return jsonResponse({
      attachment: {
        id,
        source: "staged",
        name: file.name || safeBase,
        mimeType: file.type || guessContentType(safeBase),
        size: file.size,
        extension: attachmentExtension(file.name || safeBase, file.type),
        path,
      },
    }, { status: 201 });
  }

  if (request.method === "DELETE" && url.pathname === "/web/attachments") {
    requireAuth(request, ctx);
    const body = await readBody(request);
    const stagedPath = requireString(body, "path");
    const path = resolveStagedAttachmentPath(ctx.paths, stagedPath);
    await rm(path, { force: true });
    await rm(dirname(path), { force: true }).catch(() => undefined);
    return jsonResponse({ ok: true });
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
    const leaseExpiresAt = leaseExpiresAtForTool(tool, ctx.config.daemon.leaseMs);
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
    const stoppedLaunch = ctx.db
      .query<LaunchIntentRow, [string]>("SELECT * FROM launch_intents WHERE backend_title = ? ORDER BY created_at DESC LIMIT 1")
      .get(title);
    if (stoppedLaunch) {
      applyLaunchTransition(ctx, stoppedLaunch, { type: "stopped", reason: "operator_stop" });
      const deactivated = deactivateStoppedLaunchPeer(ctx, stoppedLaunch.peer_id);
      emitWebStateChanged(ctx, {
        domains: deactivated ? ["peers", "groups", "agent_sessions"] : ["agent_sessions"],
        peerId: stoppedLaunch.peer_id,
      });
    }
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
    const leaseExpiresAt = leaseExpiresAtForTool(tool, ctx.config.daemon.leaseMs);

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
    const leaseExpiresAt = leaseExpiresAtForTool(peer.tool, ctx.config.daemon.leaseMs);
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
    const leaseExpiresAt = leaseExpiresAtForTool(peer.tool, ctx.config.daemon.leaseMs);
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
    softDeletePeerIfPresent(ctx, peerId);
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
    // Thread root: if the target is already a thread reply, inherit its root;
    // if the target is a top-level message, the target itself becomes the root.
    // Must match resolveThreadParent so bridge_reply and bridge_send_group(in_reply_to)
    // thread identically (a top-level reply target was previously left parentless).
    const parentEventId = target.parent_event_id ?? target.event_id;
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
    const skillDirectives = optionalStringArray(body, "skill_directives") ?? [];
    const skillDirectivesJson = skillDirectives.length > 0 ? JSON.stringify(skillDirectives) : null;
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
          "INSERT INTO events (type, sender_peer_id, group_id, body, parent_event_id, reply_to_event_id, mentions_json, skill_directives_json) VALUES ('group_message', ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(senderPeerId, group.group_id, message, parentEventId, directReplyTarget?.event_id ?? null, mentionsJson, skillDirectivesJson);
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
    // Replying in a thread counts as engaging with the parent (and the directly
    // replied-to event), so clear them from the sender's awaiting set.
    if (parentEventId !== null) {
      ackInboxEvents(ctx.db, senderPeerId, [parentEventId, directReplyTarget?.event_id ?? NaN]);
    }
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
    const cursor = parseCursor(url.searchParams.get("cursor"));
    if (url.searchParams.has("thread_of")) {
      throw new HttpError(400, "invalid_request", "thread_of was removed from group history; use bridge_get_thread(root_event_id: ...)");
    }
    const view = parseGroupHistoryView(url.searchParams.get("view"), url.searchParams.has("event_ids"));
    const selectors = parseSelectorsFromUrl(url);
    const historyFrom = Math.max(member.history_from_event_id ?? 0, cursor + 1);
    if (view === "events") {
      const eventIds = parseEventIdsParam(url.searchParams.get("event_ids"));
      const rows = eventIds.map((eventId) => {
        const event = getVisibleEvent(ctx.db, eventId, peerId);
        if (event.group_id !== group.group_id) {
          throw new HttpError(404, "event_not_found", `Event ${eventId} is not visible in group ${group.name}`);
        }
        if (event.parent_event_id !== null) {
          throw new HttpError(
            400,
            "event_is_thread_reply",
            `Event ${eventId} is a thread reply; use bridge_get_thread(root_event_id: ${event.parent_event_id})`,
          );
        }
        return event;
      });
      return jsonResponse({ view, events: rows, truncated: false });
    }
    if (view === "threads") {
      const threads = listGroupHistoryThreads(ctx.db, group.name, url, selectors);
      return jsonResponse({ view, threads: threads.rows, truncated: threads.truncated });
    }

    // Main-channel view augments each row with reply_count + last_reply_event_id
    // so agents can discover threads without an extra per-event probe.
    // It remains top-level-only: thread replies are read through /threads/:id.
    const mainRows = listGroupHistoryFlat(ctx.db, group.group_id, historyFrom, selectors);
    const items = attachReactions(ctx.db, mainRows.rows);
    return jsonResponse({
      view,
      items,
      events: items,
      next_cursor: items.at(-1)?.event_id ?? cursor,
      truncated: mainRows.truncated,
    });
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
      if (result.active) ackInboxEvents(ctx.db, peerId, [eventId]);
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

  // GET /threads/:root_event_id — canonical one-thread reader. Projection is
  // selected by `format`; event-bearing formats are bounded by selectors so
  // the default path stays context-light.
  const threadGet = url.pathname.match(/^\/threads\/(\d+)$/);
  if (request.method === "GET" && threadGet) {
    const rootEventId = Number(threadGet[1]);
    const format = parseThreadFormat(url.searchParams.get("format"));
    const selectors = parseSelectorsFromUrl(url);
    if (format === "summary") {
      return jsonResponse(await loadThreadSummaryProjection(ctx, rootEventId, selectors));
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
    const events = [root, ...replies];
    const status = getThreadStatus(ctx.db, rootEventId);
    if (format === "status") {
      return jsonResponse({ format, status });
    }
    const selected = selectThreadEvents(events, selectors);
    const base = {
      format,
      selectors,
      status,
      selected_event_count: selected.events.length,
      total_event_count: events.length,
      truncated: selected.truncated,
    };
    if (format === "events") {
      return jsonResponse({ ...base, events: selected.events });
    }
    return jsonResponse({
      ...base,
      transcript: renderThreadTranscript(ctx.db, selected.events),
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
    return jsonResponse({
      events: attachReactions(ctx.db, rows.map((row) => eventForRecipient(row, peerId))),
      next_cursor: rows.at(-1)?.event_id ?? after,
    });
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

  // Read-only global Activity feed for the web UI. The web user is an OBSERVER:
  // it sees every group's events (mirroring readWebRoomEvents' group visibility)
  // but only its OWN DMs — private agent↔agent DMs must not leak. The durable
  // per-peer inbox is layered on as an LEFT JOIN "awaiting" overlay rather than
  // the feed's spine, because the observer is a member only of rooms it has
  // posted in (its inbox would otherwise be near-empty). `awaiting` is computed
  // in SQL (inbox row present AND un-acked) — never inferred from a null
  // acked_at, which the LEFT JOIN makes ambiguous. Own sends are excluded.
  //
  // Unlike GET /peers/:id/inbox and GET /events/:id, this endpoint has NO side
  // effects: it never advances delivery/read state or the peer's last_cursor.
  // That keeps the shared single web peer (all of a human's browsers resolve to
  // web:local-human) free of cross-device cursor contention. Newest-first with a
  // `before` cursor for load-older; `filter=awaiting` keeps only un-acked items.
  const activityMatch = url.pathname.match(/^\/activity\/([^/]+)$/);
  if (request.method === "GET" && activityMatch) {
    const peerId = decodeURIComponent(activityMatch[1] ?? "");
    ensurePeer(ctx.db, peerId);
    const limit = parseLimit(url.searchParams.get("limit"));
    const beforeRaw = url.searchParams.get("before");
    const before = beforeRaw === null || beforeRaw === "" ? Number.MAX_SAFE_INTEGER : Number(beforeRaw);
    if (!Number.isFinite(before)) throw new HttpError(400, "invalid_cursor", "before must be a number");
    const awaitingOnly = url.searchParams.get("filter") === "awaiting";
    const awaitingClause = awaitingOnly ? "AND i.event_id IS NOT NULL AND i.acked_at IS NULL" : "";
    const rows = ctx.db
      .query<ActivityRow, [string, number, string, string, string, number]>(
        `SELECT e.*, g.name AS group_name, i.acked_at AS acked_at,
                (i.event_id IS NOT NULL AND i.acked_at IS NULL) AS awaiting,
                (SELECT COUNT(*) FROM events r WHERE r.parent_event_id = e.event_id) AS reply_count
         FROM events e
         LEFT JOIN groups g ON g.group_id = e.group_id
         LEFT JOIN inbox i ON i.event_id = e.event_id AND i.recipient_peer_id = ?
         WHERE e.event_id < ?
           AND e.type IN ('group_message', 'dm')
           AND e.sender_peer_id != ?
           AND (e.group_id IS NOT NULL
                OR (e.type = 'dm' AND (e.sender_peer_id = ? OR e.recipient_peer_id = ?)))
           ${awaitingClause}
         ORDER BY e.event_id DESC
         LIMIT ?`,
      )
      .all(peerId, before, peerId, peerId, peerId, limit);
    const awaitingCount =
      ctx.db
        .query<{ n: number }, [string]>(
          "SELECT COUNT(*) AS n FROM inbox WHERE recipient_peer_id = ? AND acked_at IS NULL",
        )
        .get(peerId)?.n ?? 0;
    const peerIds = new Set<string>();
    for (const row of rows) {
      if (row.sender_peer_id) peerIds.add(row.sender_peer_id);
      if (row.recipient_peer_id) peerIds.add(row.recipient_peer_id);
    }
    const now = new Date().toISOString();
    const ids = [...peerIds];
    // Activity can page into durable history after the live roster has dropped a
    // lease-expired peer. Return just the authors referenced by this bounded
    // Activity page so the client can render old rows without widening the main
    // /web/state roster query or doing per-row identity lookups.
    const peers = ids.length === 0
      ? []
      : ctx.db
        .query<PeerRow & { online: number }, [string, ...string[]]>(
          `SELECT peer_id, tool, session_name, purpose, machine_id, lease_expires_at,
                  activity_state, last_activity_at, last_cursor, created_at, updated_at,
                  lease_expires_at > ? AS online
           FROM peers
           WHERE peer_id IN (${ids.map(() => "?").join(",")})`,
        )
        .all(now, ...ids)
        .map((peer) => ({
          ...peer,
          online: Boolean(peer.online),
          presence: derivePresence(Boolean(peer.online), peer.activity_state),
        }));
    return jsonResponse({
      events: attachReactions(ctx.db, rows.map((row) => eventForRecipient(row, peerId))),
      peers,
      next_cursor: rows.at(-1)?.event_id ?? null,
      awaiting_count: awaitingCount,
    });
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
    return jsonResponse({
      events: attachReactions(ctx.db, rows.map((row) => eventForRecipient(row, peerId))),
      next_cursor: rows.at(-1)?.event_id ?? cursor,
    });
  }

  throw new HttpError(404, "not_found", `${request.method} ${url.pathname} is not implemented`);
}

