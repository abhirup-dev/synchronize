import { hostname } from "node:os";

import { collectGitContext } from "../../provenance.ts";
import { HttpError, jsonResponse } from "../../http.ts";
import { LaunchValidationError, validateLaunchRequest } from "../../launch/service.ts";
import type { LaunchIntentRow } from "../../launch/store.ts";
import {
  getAgentSessionByHost,
  getAgentSessionByPeer,
  listAgentSessions,
} from "../repo/agent-sessions.ts";
import { deriveBackendTitleForPeer } from "../repo/groups.ts";
import { applyLaunchTransition } from "../repo/launch.ts";
import {
  deactivateStoppedLaunchPeer,
  ensurePeer,
  findPeerByHostSession,
  findPeerByRequiredHostSession,
  leaseExpiresAtForTool,
  upsertPeer,
} from "../repo/peers.ts";
import { emitWebStateChanged } from "../services/web-events.ts";
import {
  log,
  reconcileLaunch,
  type DaemonContext,
} from "../server.ts";
import { optionalInteger, optionalObjectJson, optionalString, readBody, requireString } from "../validation.ts";

export async function tryHandleAgentSessionsRoute(request: Request, ctx: DaemonContext, url: URL): Promise<Response | null> {
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

  return null;
}
