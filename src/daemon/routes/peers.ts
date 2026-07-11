import { hostname } from "node:os";

import { ACTIVITY_STATES } from "../../constants.ts";
import { HttpError, jsonResponse } from "../../http.ts";
import { getGroup, MEMBER_SELECT_SQL, type MemberRow } from "../repo/groups.ts";
import {
  derivePresence,
  ensurePeer,
  findPeerByHostSession,
  getPeer,
  leaseExpiresAtForTool,
  softDeletePeerIfPresent,
  upsertPeer,
  type PeerRow,
} from "../repo/peers.ts";
import { emitWebStateChanged } from "../services/web-events.ts";
import { log, type DaemonContext } from "../server.ts";
import { optionalString, readBody, requireString } from "../validation.ts";

export async function tryHandlePeersRoute(request: Request, ctx: DaemonContext, url: URL): Promise<Response | null> {
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

  return null;
}
