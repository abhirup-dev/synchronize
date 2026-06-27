import { rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { ensureDir } from "../../fs.ts";
import { HttpError, jsonResponse } from "../../http.ts";
import { requireAuth } from "../auth.ts";
import {
  attachmentExtension,
  guessContentType,
  resolveStagedAttachmentPath,
  safePathSegment,
  webAttachmentRoot,
} from "../repo/media.ts";
import { resolveWebDeepLink } from "../repo/events.ts";
import { ensureLocalWebPeer } from "../repo/peers.ts";
import { emitWebStateChanged, openWebEvents } from "../services/web-events.ts";
import {
  buildWebAgents,
  buildWebState,
  log,
  serveWebAsset,
  type DaemonContext,
} from "../server.ts";
import { optionalFormString, readBody, requireString } from "../validation.ts";

export async function tryHandleWebRoute(request: Request, ctx: DaemonContext, url: URL): Promise<Response | null> {
  const agentsMatch = url.pathname.match(/^\/web\/agents(?:\/([^/]+))?$/);
  if (request.method === "GET" && agentsMatch) {
    requireAuth(request, ctx);
    return jsonResponse(buildWebAgents(ctx, url), { headers: { "cache-control": "no-cache" } });
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
      ...state.agent_runtime_details.map(
        (details) =>
          `${details.peer_id}:${details.binding_id ?? ""}:${details.launch_id ?? ""}:${details.profile_name ?? ""}:${
            details.model ?? ""
          }:${details.thinking ?? ""}:${details.host_session_id ?? ""}:${details.cwd ?? ""}:${details.git_branch ?? ""}:${
            details.git_dirty ?? ""
          }:${details.launch_state ?? ""}:${details.updated_at ?? ""}`,
      ),
      ...state.agents.map(
        (agent) =>
          `${agent.peer_id}:${agent.work_state?.phase ?? ""}:${agent.work_state?.summary ?? ""}:${agent.work_state?.task ?? ""}:${
            agent.work_state?.expires_at ?? ""
          }:${agent.work_state_status.state}:${agent.runtime_details?.updated_at ?? ""}:${agent.launch_lifecycle?.state ?? ""}`,
      ),
      ...state.skill_catalog.map((skill) => `${skill.name}:${skill.runtimes.join(",")}:${skill.description}:${skill.source_path ?? ""}`),
      ...state.peers.map(
        (p) =>
          `${p.peer_id}:${presenceOf(p)}:${p.lifecycle_state}:${p.archived_at ?? ""}:${p.archived_reason ?? ""}:${p.archive_source ?? ""}:${p.aoe_session?.profile ?? ""}:${p.aoe_session?.title ?? ""}:${
            p.aoe_session?.attach_command ?? ""
          }:${p.work_state?.phase ?? ""}:${p.work_state_status.state}`,
      ),
      ...state.memberships.map((m) => `${m.peer_id}@${m.group_id}:${m.member_state}:${presenceOf(m)}`),
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

  if (request.method === "GET" && url.pathname === "/web/resolve") {
    requireAuth(request, ctx);
    const eventId = Number(url.searchParams.get("event_id"));
    if (!Number.isInteger(eventId) || eventId < 1) {
      throw new HttpError(400, "invalid_request", "event_id query parameter is required");
    }
    const peerId = url.searchParams.get("peer_id");
    if (!peerId) throw new HttpError(400, "invalid_request", "peer_id query parameter is required");
    return jsonResponse(resolveWebDeepLink(ctx.db, eventId, peerId));
  }

  if (request.method === "GET" && (url.pathname === "/web" || url.pathname === "/web/" || url.pathname.startsWith("/web/"))) {
    return serveWebAsset(url.pathname);
  }

  return null;
}
