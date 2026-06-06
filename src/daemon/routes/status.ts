import { hostname } from "node:os";

import { jsonResponse } from "../../http.ts";
import { derivePresence } from "../repo/peers.ts";
import type { DaemonContext, SummaryGroupRow, SummaryPeerRow } from "../server.ts";

export function tryHandleStatusRoute(request: Request, ctx: DaemonContext, url: URL): Response | null {
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

  return null;
}
