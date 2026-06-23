import type { Database } from "bun:sqlite";

import { HttpError, jsonResponse } from "../../http.ts";
import { getGroup } from "../repo/groups.ts";
import { getPeer } from "../repo/peers.ts";
import { listArchivedSessions } from "../repo/archive.ts";
import {
  archiveGroupApply,
  archiveSessionApply,
  resumeGroupApply,
  resumeGroupPreview,
  resumeSessionApply,
  resumeSessionPreview,
} from "../services/archive.ts";
import { log, type DaemonContext } from "../server.ts";
import { optionalString, optionalStringArray, readBody, requireString } from "../validation.ts";

// Resolve the target peer for an archive request from either an explicit
// peer_id (validated to exist) or a host session_id (latest binding wins).
function resolveArchivePeerId(db: Database, body: Record<string, unknown>): string {
  const peerId = optionalString(body, "peer_id");
  if (peerId) {
    getPeer(db, peerId); // throws peer_not_found if missing/deleted
    return peerId;
  }
  const sessionId = optionalString(body, "session_id");
  if (sessionId) {
    const row = db
      .query<{ peer_id: string }, [string]>(
        "SELECT peer_id FROM agent_sessions WHERE host_session_id = ? ORDER BY updated_at DESC, created_at DESC LIMIT 1",
      )
      .get(sessionId);
    if (!row) throw new HttpError(404, "session_not_found", `No agent session for host_session_id: ${sessionId}`);
    return row.peer_id;
  }
  throw new HttpError(400, "invalid_archive", "archive requires peer_id or session_id");
}

function resolveResumePeerId(db: Database, body: Record<string, unknown>): string {
  const peerId = optionalString(body, "peer_id");
  if (peerId) {
    getPeer(db, peerId);
    return peerId;
  }
  const sessionId = optionalString(body, "session_id");
  if (sessionId) {
    const row = db
      .query<{ peer_id: string }, [string]>(
        "SELECT peer_id FROM agent_sessions WHERE host_session_id = ? ORDER BY updated_at DESC, created_at DESC LIMIT 1",
      )
      .get(sessionId);
    if (!row) throw new HttpError(404, "session_not_found", `No agent session for host_session_id: ${sessionId}`);
    return row.peer_id;
  }
  throw new HttpError(400, "invalid_resume", "resume requires peer_id or session_id");
}

export async function tryHandleArchiveRoute(request: Request, ctx: DaemonContext, url: URL): Promise<Response | null> {
  if (request.method === "POST" && url.pathname === "/archive/session") {
    const body = await readBody(request);
    const peerId = resolveArchivePeerId(ctx.db, body);
    const reason = optionalString(body, "reason") ?? null;
    const dryRun = body.dry_run === true;
    const result = await archiveSessionApply(ctx, peerId, { reason, dryRun, source: "manual" });
    log(`archive session peer_id=${peerId} action=${result.action}${dryRun ? " (dry-run)" : ""}`);
    return jsonResponse(result);
  }

  if (request.method === "POST" && url.pathname === "/archive/group") {
    const body = await readBody(request);
    const group = getGroup(ctx.db, requireString(body, "group"));
    const reason = optionalString(body, "reason") ?? null;
    const dryRun = body.dry_run === true;
    const members = await archiveGroupApply(ctx, group.group_id, { reason, dryRun });
    log(`archive group name=${group.name} members=${members.length}${dryRun ? " (dry-run)" : ""}`);
    return jsonResponse({ group: group.name, dry_run: dryRun, members });
  }

  if (request.method === "GET" && url.pathname === "/archive/sessions") {
    return jsonResponse({ sessions: listArchivedSessions(ctx.db) });
  }

  if (request.method === "POST" && url.pathname === "/resume/session") {
    const body = await readBody(request);
    const peerId = resolveResumePeerId(ctx.db, body);
    const requestedMode = optionalString(body, "mode");
    if (requestedMode && !["launch", "spawn", "foreground", "print"].includes(requestedMode)) {
      throw new HttpError(400, "invalid_resume_mode", `Unknown resume mode: ${requestedMode}`);
    }
    const mode =
      body.print === true || requestedMode === "print"
        ? "print"
        : requestedMode === "foreground"
          ? "foreground"
          : "launch";
    const force = body.force === true;
    if (body.dry_run === true) {
      const result = await resumeSessionPreview(ctx, peerId, { mode, force });
      return jsonResponse({ ...result, dry_run: true });
    }
    const result = await resumeSessionApply(ctx, peerId, { mode, force });
    return jsonResponse(result);
  }

  if (request.method === "POST" && url.pathname === "/resume/group") {
    const body = await readBody(request);
    const group = getGroup(ctx.db, requireString(body, "group"));
    const mode = body.print === true ? "print" : "launch";
    const force = body.force === true;
    const only = optionalStringArray(body, "only");
    const exclude = optionalStringArray(body, "exclude");
    if (body.dry_run === true) {
      const members = await resumeGroupPreview(ctx, group.group_id, {
        mode,
        force,
        ...(only ? { only } : {}),
        ...(exclude ? { exclude } : {}),
      });
      return jsonResponse({ group: group.name, mode, dry_run: true, members });
    }
    const members = await resumeGroupApply(ctx, group.group_id, {
      mode,
      force,
      ...(only ? { only } : {}),
      ...(exclude ? { exclude } : {}),
    });
    log(`resume group name=${group.name} members=${members.length} mode=${mode}`);
    return jsonResponse({ group: group.name, mode, members });
  }

  return null;
}
