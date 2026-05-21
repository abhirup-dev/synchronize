import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { appendFile, copyFile, stat, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { basename, extname, join } from "node:path";
import {
  DEFAULT_BIND_HOST,
  DEFAULT_LEASE_MS,
  DEFAULT_PAGE_LIMIT,
  DEFAULT_PORT,
  ENV_BIND,
  ENV_PORT,
  ENV_TOKEN,
  MAX_MESSAGE_CHARS,
  MAX_PAGE_LIMIT,
  API_VERSION,
} from "./constants.ts";
import { openDatabase } from "./db.ts";
import { ensureDir, writeJson } from "./fs.ts";
import { errorResponse, HttpError, jsonResponse } from "./http.ts";
import { getRuntimePaths, type RuntimePaths } from "./paths.ts";

interface DaemonContext {
  paths: RuntimePaths;
  db: Database;
  startedAt: string;
  token: string | null;
  server: Bun.Server<unknown>;
  subscribers: Map<string, EventSubscriber>;
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
}

interface PeerRow {
  peer_id: string;
  tool: string;
  session_name: string;
  purpose: string | null;
  machine_id: string;
  lease_expires_at: string;
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
}

interface EventRow {
  event_id: number;
  type: string;
  sender_peer_id: string | null;
  recipient_peer_id: string | null;
  group_id: number | null;
  body: string | null;
  media_id: string | null;
  created_at: string;
}

interface EventSubscriber {
  peer_id: string;
  callback_url: string;
  token: string;
  created_at: string;
}

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
}

interface SummaryPeerRow {
  peer_id: string;
  session_name: string;
  tool: string;
  purpose: string | null;
  online: number;
  pending_inbox: number;
  groups: number;
  updated_at: string;
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
    });
  }

  requireAuth(request, ctx);

  if (request.method === "GET" && url.pathname === "/status") {
    const peerCount = ctx.db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM peers").get()?.count ?? 0;
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
          "SELECT COUNT(*) AS total, SUM(CASE WHEN lease_expires_at > ? THEN 1 ELSE 0 END) AS online FROM peers",
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
           COUNT(DISTINCT CASE WHEN i.acked_at IS NULL THEN i.event_id END) AS pending_inbox,
           COUNT(DISTINCT CASE WHEN gm.active = 1 THEN gm.group_id END) AS groups,
           p.updated_at
         FROM peers p
         LEFT JOIN inbox i ON i.recipient_peer_id = p.peer_id
         LEFT JOIN group_members gm ON gm.peer_id = p.peer_id
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
      peers: peers.map((peer) => ({ ...peer, online: Boolean(peer.online) })),
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
    const leaseExpiresAt = new Date(Date.now() + DEFAULT_LEASE_MS).toISOString();
    const metadata = optionalObjectJson(body, "metadata");
    const bindingId = `${hostTool}:${hostSessionId}`;

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
             binding_id, peer_id, host_tool, host_session_id, host_session_file, cwd, pid,
             source, model, agent_type, metadata_json, launch_id, last_seen_at
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
           ON CONFLICT(host_tool, host_session_id) DO UPDATE SET
             peer_id = excluded.peer_id,
             host_session_file = excluded.host_session_file,
             cwd = excluded.cwd,
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
          optionalString(body, "cwd") ?? null,
          optionalInteger(body, "pid") ?? null,
          optionalString(body, "source") ?? null,
          optionalString(body, "model") ?? null,
          optionalString(body, "agent_type") ?? null,
          metadata,
          optionalString(body, "launch_id") ?? null,
        );
    })();

    log(`agent session registered host_tool=${hostTool} host_session_id=${hostSessionId} peer_id=${peerId}`);
    return jsonResponse({ binding: getAgentSessionByPeer(ctx.db, peerId) }, { status: 201 });
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
    return jsonResponse({ binding: getAgentSessionByPeer(ctx.db, peerId) });
  }

  if (request.method === "POST" && url.pathname === "/peers/register") {
    const body = await readBody(request);
    const sessionName = requireString(body, "session_name");
    const tool = optionalString(body, "tool") ?? "cli";
    const purpose = optionalString(body, "purpose");
    const peerId = optionalString(body, "peer_id") ?? crypto.randomUUID();
    const machineId = optionalString(body, "machine_id") ?? hostname();
    const leaseExpiresAt = new Date(Date.now() + DEFAULT_LEASE_MS).toISOString();

    upsertPeer(ctx.db, {
      peerId,
      tool,
      sessionName,
      purpose: purpose ?? null,
      machineId,
      leaseExpiresAt,
    });

    log(`peer registered peer_id=${peerId} session_name=${sessionName} tool=${tool} lease_expires_at=${leaseExpiresAt}`);
    return jsonResponse({ peer: getPeer(ctx.db, peerId) }, { status: 201 });
  }

  const peerHeartbeat = url.pathname.match(/^\/peers\/([^/]+)\/heartbeat$/);
  if (request.method === "PATCH" && peerHeartbeat) {
    const peerId = decodeURIComponent(peerHeartbeat[1] ?? "");
    ensurePeer(ctx.db, peerId);
    const leaseExpiresAt = new Date(Date.now() + DEFAULT_LEASE_MS).toISOString();
    ctx.db
      .query(
        `UPDATE peers
         SET lease_expires_at = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE peer_id = ?`,
      )
      .run(leaseExpiresAt, peerId);
    log(`peer heartbeat peer_id=${peerId} lease_expires_at=${leaseExpiresAt}`);
    return jsonResponse({ peer: getPeer(ctx.db, peerId) });
  }

  if (request.method === "GET" && url.pathname === "/peers") {
    const now = new Date().toISOString();
    const groupName = url.searchParams.get("group");
    if (groupName) {
      const group = getGroup(ctx.db, groupName);
      const rows = ctx.db
        .query<MemberRow & { online: number }, [string, number]>(
          `SELECT gm.*, p.session_name, p.tool, p.lease_expires_at > ? AS online
           FROM group_members gm
           JOIN peers p ON p.peer_id = gm.peer_id
           WHERE gm.group_id = ? AND gm.active = 1
           ORDER BY gm.alias ASC`,
        )
        .all(now, group.group_id);
      return jsonResponse({ peers: rows.map((row) => ({ ...row, active: Boolean(row.active), online: Boolean(row.online) })) });
    }
    const rows = ctx.db
      .query<PeerRow & { online: number }, [string]>(
        `SELECT *, lease_expires_at > ? AS online
         FROM peers
         ORDER BY updated_at DESC, session_name ASC`,
      )
      .all(now);
    return jsonResponse({ peers: rows.map((row) => ({ ...row, online: Boolean(row.online) })) });
  }

  const peerDelete = url.pathname.match(/^\/peers\/([^/]+)$/);
  if (request.method === "DELETE" && peerDelete) {
    const peerId = decodeURIComponent(peerDelete[1] ?? "");
    ensurePeer(ctx.db, peerId);
    ctx.db.query("DELETE FROM peers WHERE peer_id = ?").run(peerId);
    ctx.subscribers.delete(peerId);
    log(`peer deleted peer_id=${peerId}; removed any in-memory subscriber`);
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
    void notifySubscribers(ctx, [recipientPeerId], event);

    return jsonResponse({ event }, { status: 201 });
  }

  if (request.method === "POST" && url.pathname === "/groups") {
    const body = await readBody(request);
    const name = requireGroupName(requireString(body, "name"));
    const creatorPeerId = optionalString(body, "creator_peer_id");
    const durable = body.ephemeral === true ? 0 : 1;
    if (creatorPeerId) ensurePeer(ctx.db, creatorPeerId);
    const mediaDir = `${ctx.paths.mediaPath}/${name}`;

    const groupId = ctx.db.transaction(() => {
      try {
        ctx.db
          .query("INSERT INTO groups (name, durable, media_dir, creator_peer_id) VALUES (?, ?, ?, ?)")
          .run(name, durable, mediaDir, creatorPeerId ?? null);
      } catch (error) {
        throw mapSqliteConstraint(error, "group_exists", `Group already exists: ${name}`);
      }
      const id = Number(ctx.db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()?.id);
      ctx.db
        .query("INSERT INTO events (type, sender_peer_id, group_id, body) VALUES ('group_created', ?, ?, ?)")
        .run(creatorPeerId ?? null, id, JSON.stringify({ name, durable: Boolean(durable) }));
      return id;
    })();

    return jsonResponse({ group: getGroupById(ctx.db, groupId) }, { status: 201 });
  }

  if (request.method === "GET" && url.pathname === "/groups") {
    const rows = ctx.db.query<GroupRow, []>("SELECT * FROM groups ORDER BY name ASC").all();
    return jsonResponse({ groups: rows.map(formatGroup) });
  }

  const groupMatch = url.pathname.match(/^\/groups\/([^/]+)$/);
  if (request.method === "GET" && groupMatch) {
    const group = getGroup(ctx.db, decodeURIComponent(groupMatch[1] ?? ""));
    return jsonResponse({ group: formatGroup(group), members: getGroupMembers(ctx.db, group.group_id) });
  }

  const groupJoin = url.pathname.match(/^\/groups\/([^/]+)\/join$/);
  if (request.method === "POST" && groupJoin) {
    const group = getGroup(ctx.db, decodeURIComponent(groupJoin[1] ?? ""));
    const body = await readBody(request);
    const peerId = requireString(body, "peer_id");
    const peer = getPeer(ctx.db, peerId);
    const alias = optionalString(body, "alias") ?? peer.session_name;
    const fresh = body.fresh === true;

    const joinEventId = ctx.db.transaction(() => {
      ctx.db
        .query("INSERT INTO events (type, sender_peer_id, group_id, body) VALUES ('group_joined', ?, ?, ?)")
        .run(peerId, group.group_id, JSON.stringify({ alias, fresh }));
      const eventId = Number(ctx.db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()?.id);
      const firstEventId =
        ctx.db.query<{ event_id: number }, [number]>("SELECT MIN(event_id) AS event_id FROM events WHERE group_id = ?").get(group.group_id)
          ?.event_id ?? eventId;
      const historyFrom = fresh ? eventId : firstEventId;
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
          .run(group.group_id, peerId, alias, eventId, historyFrom, peer.purpose);
      } catch (error) {
        throw mapSqliteConstraint(
          error,
          "alias_collision",
          `Alias '${alias}' is already active in group '${group.name}'. Provide a unique alias to join this group.`,
        );
      }
      return eventId;
    })();

    return jsonResponse({ member: getGroupMember(ctx.db, group.group_id, peerId), event: getEvent(ctx.db, joinEventId) });
  }

  const groupLeave = url.pathname.match(/^\/groups\/([^/]+)\/leave$/);
  if (request.method === "POST" && groupLeave) {
    const group = getGroup(ctx.db, decodeURIComponent(groupLeave[1] ?? ""));
    const body = await readBody(request);
    const peerId = requireString(body, "peer_id");
    ensureActiveMember(ctx.db, group.group_id, peerId);
    const eventId = ctx.db.transaction(() => {
      ctx.db
        .query(
          `UPDATE group_members
           SET active = 0, left_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
           WHERE group_id = ? AND peer_id = ?`,
        )
        .run(group.group_id, peerId);
      ctx.db.query("INSERT INTO events (type, sender_peer_id, group_id) VALUES ('group_left', ?, ?)").run(peerId, group.group_id);
      return Number(ctx.db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()?.id);
    })();
    return jsonResponse({ ok: true, event: getEvent(ctx.db, eventId) });
  }

  const groupMessages = url.pathname.match(/^\/groups\/([^/]+)\/messages$/);
  if (request.method === "POST" && groupMessages) {
    const group = getGroup(ctx.db, decodeURIComponent(groupMessages[1] ?? ""));
    const body = await readBody(request);
    const senderPeerId = requireString(body, "sender_peer_id");
    const message = requireString(body, "message");
    if (message.length > MAX_MESSAGE_CHARS) {
      throw new HttpError(413, "message_too_large", `Message exceeds ${MAX_MESSAGE_CHARS} characters`);
    }
    ensureActiveMember(ctx.db, group.group_id, senderPeerId);

    let recipients: string[] = [];
    const eventId = ctx.db.transaction(() => {
      ctx.db
        .query("INSERT INTO events (type, sender_peer_id, group_id, body) VALUES ('group_message', ?, ?, ?)")
        .run(senderPeerId, group.group_id, message);
      const id = Number(ctx.db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()?.id);
      recipients = ctx.db
        .query<{ peer_id: string }, [number, string]>(
          "SELECT peer_id FROM group_members WHERE group_id = ? AND active = 1 AND peer_id != ?",
        )
        .all(group.group_id, senderPeerId)
        .map((recipient) => recipient.peer_id);
      const insertInbox = ctx.db.query("INSERT OR IGNORE INTO inbox (recipient_peer_id, event_id) VALUES (?, ?)");
      for (const recipient of recipients) insertInbox.run(recipient, id);
      return id;
    })();
    const event = getEvent(ctx.db, eventId);
    log(`group message stored event_id=${eventId} group=${group.name} sender=${senderPeerId} recipients=${recipients.length}`);
    void notifySubscribers(ctx, recipients, event);

    return jsonResponse({ event }, { status: 201 });
  }

  const groupHistory = url.pathname.match(/^\/groups\/([^/]+)\/history$/);
  if (request.method === "GET" && groupHistory) {
    const group = getGroup(ctx.db, decodeURIComponent(groupHistory[1] ?? ""));
    const peerId = url.searchParams.get("peer_id");
    if (!peerId) throw new HttpError(400, "invalid_request", "peer_id query parameter is required");
    const member = ensureActiveMember(ctx.db, group.group_id, peerId);
    const limit = parseLimit(url.searchParams.get("limit"));
    const cursor = parseCursor(url.searchParams.get("cursor"));
    const historyFrom = Math.max(member.history_from_event_id ?? 0, cursor + 1);
    const rows = ctx.db
      .query<EventRow, [number, number, number]>(
        `SELECT * FROM events
         WHERE group_id = ? AND event_id >= ?
         ORDER BY event_id ASC
         LIMIT ?`,
      )
      .all(group.group_id, historyFrom, limit);
    return jsonResponse({ events: rows, next_cursor: rows.at(-1)?.event_id ?? cursor });
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
        `SELECT e.*, i.delivered_at, i.read_at, i.acked_at
         FROM inbox i
         JOIN events e ON e.event_id = i.event_id
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
    }
    return jsonResponse({ events: rows, next_cursor: rows.at(-1)?.event_id ?? after });
  }

  const inboxAck = url.pathname.match(/^\/peers\/([^/]+)\/inbox\/ack$/);
  if (request.method === "POST" && inboxAck) {
    const peerId = decodeURIComponent(inboxAck[1] ?? "");
    ensurePeer(ctx.db, peerId);
    const body = await readBody(request);
    const ids = optionalNumberArray(body, "event_ids");
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
        `SELECT e.*, i.delivered_at, i.read_at, i.acked_at
         FROM inbox i
         JOIN events e ON e.event_id = i.event_id
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
    }
    return jsonResponse({ events: rows, next_cursor: rows.at(-1)?.event_id ?? cursor });
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

function optionalObjectJson(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "invalid_request", `${key} must be an object`);
  }
  return JSON.stringify(value);
}

function optionalNumberArray(body: Record<string, unknown>, key: string): number[] | undefined {
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

function getPeer(db: Database, peerId: string): PeerRow {
  const peer = db.query<PeerRow, [string]>("SELECT * FROM peers WHERE peer_id = ?").get(peerId);
  if (!peer) throw new HttpError(404, "peer_not_found", `Peer not found: ${peerId}`);
  return peer;
}

function ensurePeer(db: Database, peerId: string): void {
  getPeer(db, peerId);
}

function upsertPeer(
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
  db.query(
    `INSERT INTO peers (peer_id, tool, session_name, purpose, machine_id, lease_expires_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(peer_id) DO UPDATE SET
       tool = excluded.tool,
       session_name = excluded.session_name,
       purpose = excluded.purpose,
       machine_id = excluded.machine_id,
       lease_expires_at = excluded.lease_expires_at,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
  ).run(input.peerId, input.tool, input.sessionName, input.purpose, input.machineId, input.leaseExpiresAt);
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
      p.lease_expires_at > ? AS peer_online
    FROM agent_sessions s
    JOIN peers p ON p.peer_id = s.peer_id`;
}

function formatAgentSession(row: AgentSessionJoinedRow): AgentSessionRow & { peer: PeerRow & { online: boolean } } {
  return {
    binding_id: row.binding_id,
    peer_id: row.peer_id,
    host_tool: row.host_tool,
    host_session_id: row.host_session_id,
    host_session_file: row.host_session_file,
    cwd: row.cwd,
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
      last_cursor: 0,
      created_at: "",
      updated_at: "",
      online: Boolean(row.peer_online),
    },
  };
}

function getEvent(db: Database, eventId: number): EventRow {
  const event = db.query<EventRow, [number]>("SELECT * FROM events WHERE event_id = ?").get(eventId);
  if (!event) throw new HttpError(404, "event_not_found", `Event not found: ${eventId}`);
  return event;
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

type FormattedGroup = Omit<GroupRow, "durable"> & { durable: boolean };
type FormattedMember = Omit<MemberRow, "active"> & { active: boolean };

function formatGroup(group: GroupRow): FormattedGroup {
  return { ...group, durable: Boolean(group.durable) };
}

function getGroupMembers(db: Database, groupId: number): FormattedMember[] {
  return db
    .query<MemberRow, [number]>(
      `SELECT gm.*, p.session_name, p.tool
       FROM group_members gm
       JOIN peers p ON p.peer_id = gm.peer_id
       WHERE gm.group_id = ?
       ORDER BY gm.active DESC, gm.alias ASC`,
    )
    .all(groupId)
    .map((member) => ({ ...member, active: Boolean(member.active) }));
}

function getGroupMember(db: Database, groupId: number, peerId: string): FormattedMember {
  const member = db
    .query<MemberRow, [number, string]>(
      `SELECT gm.*, p.session_name, p.tool
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
      `SELECT gm.*, p.session_name, p.tool
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
  const startedAt = new Date().toISOString();
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

  ctx = { paths, db, startedAt, token, server, subscribers: new Map() };

  const discovery: DiscoveryFile = {
    pid: process.pid,
    host: server.hostname ?? host,
    port: server.port ?? port,
    baseUrl: `http://${server.hostname ?? host}:${server.port ?? port}`,
    tokenRequired: Boolean(token),
    dbPath: paths.dbPath,
    mediaPath: paths.mediaPath,
    startedAt,
  };
  await writeJson(paths.discoveryPath, discovery);

  console.error(`synchronize daemon listening on ${discovery.baseUrl}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
