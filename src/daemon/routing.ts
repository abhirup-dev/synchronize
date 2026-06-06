import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { appendFile, copyFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import {
  type ActivityState,
  MAX_PAGE_LIMIT,
} from "../constants.ts";
import { loadRuntimeConfig, type RuntimeConfig } from "../config.ts";
import { openDatabase, pruneEphemeralGroups } from "../db.ts";
import { applyDaemonEnvFiles } from "../env-files.ts";
import { ensureDir, writeJson } from "../fs.ts";
import { errorResponse, HttpError, jsonResponse } from "../http.ts";
import { getRuntimePaths, type RuntimePaths } from "../paths.ts";
import { collectDaemonProvenance, type DaemonProvenance } from "../provenance.ts";
import { AoeBackend } from "../launch/backend.ts";
import { LaunchService, aoeAttachCommand, aoeProfileName, aoeTitle } from "../launch/service.ts";
import { isLaunchTool } from "../launch/build.ts";
import { transitionLaunch, type LaunchLifecycleEvent } from "../launch/lifecycle.ts";
import {
  appendLaunchEvent,
  claimNextLaunchWork,
  completeLaunchWork,
  failLaunchWork,
  getLaunchIntent,
  updateLaunchState,
} from "../launch/store.ts";
import { loadSkillCatalog } from "../skill-catalog.ts";
import {
  getCachedSummary,
  startSummarizeWorker,
  type WorkerHandle,
} from "../summarize/index.ts";
import type { ReactionSummary, ReplyDestination, SkillCatalogEntry } from "../api/types.ts";
import { assertLanModeIsProtected, requireAuth, resolveBind } from "./auth.ts";
import {
  selectorLimit,
  selectorToSummaryStrategy,
  type NormalizedSelectors,
} from "./selectors.ts";
import {
  optionalFormString,
  optionalString,
  parseCursor,
  parseLimit,
  readBody,
  requireString,
  type ReactionOp,
} from "./validation.ts";

import {
  appendMediaIndex,
  attachmentExtension,
  buildWebState,
  emitWebStateChanged,
  ensureActiveMember,
  ensureLocalWebPeer,
  ensurePeer,
  getEvent,
  getGroup,
  getMedia,
  guessContentType,
  hashFile,
  log,
  notifySubscribers,
  openWebEvents,
  readWebRoomEvents,
  resolveStagedAttachmentPath,
  safePathSegment,
  serveWebAsset,
  webAttachmentRoot,
  writeMediaReadme
} from "./server.ts";
import type {
  DaemonContext,
  MediaRow,
} from "./server.ts";
import { tryHandleActivityRoute } from "./routes/activity.ts";
import { tryHandleAgentSessionsRoute } from "./routes/agent-sessions.ts";
import { tryHandleEventLookupRoute, tryHandleEventPullRoute } from "./routes/events.ts";
import { tryHandleGroupsRoute } from "./routes/groups.ts";
import { tryHandleHealthRoute } from "./routes/health.ts";
import { tryHandleInboxRoute } from "./routes/inbox.ts";
import { tryHandleMessagingRoute } from "./routes/messaging.ts";
import { tryHandlePeersRoute } from "./routes/peers.ts";
import { tryHandleQueryRoute } from "./routes/query.ts";
import { tryHandleReactionsRoute } from "./routes/reactions.ts";
import { tryHandleStatusRoute } from "./routes/status.ts";
import { tryHandleSubscriptionsRoute } from "./routes/subscriptions.ts";
import { tryHandleThreadsRoute } from "./routes/threads.ts";

export async function route(request: Request, ctx: DaemonContext): Promise<Response> {
  const url = new URL(request.url);
  const healthResponse = tryHandleHealthRoute(request, ctx, url);
  if (healthResponse) return healthResponse;

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

  const statusResponse = tryHandleStatusRoute(request, ctx, url);
  if (statusResponse) return statusResponse;

  const agentSessionsResponse = await tryHandleAgentSessionsRoute(request, ctx, url);
  if (agentSessionsResponse) return agentSessionsResponse;

  const peersResponse = await tryHandlePeersRoute(request, ctx, url);
  if (peersResponse) return peersResponse;

  const subscriptionsResponse = await tryHandleSubscriptionsRoute(request, ctx, url);
  if (subscriptionsResponse) return subscriptionsResponse;

  const queryResponse = await tryHandleQueryRoute(request, ctx, url);
  if (queryResponse) return queryResponse;

  const messagingResponse = await tryHandleMessagingRoute(request, ctx, url);
  if (messagingResponse) return messagingResponse;

  const groupsResponse = await tryHandleGroupsRoute(request, ctx, url);
  if (groupsResponse) return groupsResponse;

  const eventLookupResponse = tryHandleEventLookupRoute(request, ctx, url);
  if (eventLookupResponse) return eventLookupResponse;

  const reactionsResponse = await tryHandleReactionsRoute(request, ctx, url);
  if (reactionsResponse) return reactionsResponse;

  const threadsResponse = await tryHandleThreadsRoute(request, ctx, url);
  if (threadsResponse) return threadsResponse;

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

  const inboxResponse = await tryHandleInboxRoute(request, ctx, url);
  if (inboxResponse) return inboxResponse;

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
  const activityResponse = tryHandleActivityRoute(request, ctx, url);
  if (activityResponse) return activityResponse;

  const eventPullResponse = tryHandleEventPullRoute(request, ctx, url);
  if (eventPullResponse) return eventPullResponse;

  throw new HttpError(404, "not_found", `${request.method} ${url.pathname} is not implemented`);
}
