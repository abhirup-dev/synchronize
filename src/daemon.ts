import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { appendFile, copyFile, rm, stat, writeFile } from "node:fs/promises";
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
import { openDatabase, pruneEphemeralGroups } from "./db.ts";
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
  parent_event_id: number | null;
  mentions_json: string | null;
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
  host_session_id: string | null;
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
          `SELECT ${MEMBER_SELECT_SQL}, p.lease_expires_at > ? AS online
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
         WHERE deleted_at IS NULL
         ORDER BY updated_at DESC, session_name ASC`,
      )
      .all(now);
    return jsonResponse({ peers: rows.map((row) => ({ ...row, online: Boolean(row.online) })) });
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
      ctx.db
        .query("INSERT INTO events (type, sender_peer_id, group_id, body) VALUES ('group_created', ?, ?, ?)")
        .run(creatorPeerId ?? null, id, JSON.stringify({ name, durable: Boolean(durable) }));
      return id;
    })();

    return jsonResponse({ group: formatGroup(getGroupById(ctx.db, groupId)) }, { status: 201 });
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

    let reclaimed: { previous_peer_id: string; event_id: number } | null = null;
    const joinEventId = ctx.db.transaction(() => {
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
      if (previousHolder && previousHolder.peer_id !== peerId) {
        ctx.db
          .query(
            `INSERT INTO events (type, sender_peer_id, group_id, body)
             VALUES ('group_member_alias_reclaimed', ?, ?, ?)`,
          )
          .run(
            peerId,
            group.group_id,
            JSON.stringify({ alias, previous_peer_id: previousHolder.peer_id }),
          );
        const reclaimEventId = Number(
          ctx.db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()?.id,
        );
        fanoutRosterEventToInbox(ctx.db, group.group_id, reclaimEventId, peerId);
        reclaimed = { previous_peer_id: previousHolder.peer_id, event_id: reclaimEventId };
      }
      ctx.db
        .query("INSERT INTO events (type, sender_peer_id, group_id, body) VALUES ('group_joined', ?, ?, ?)")
        .run(peerId, group.group_id, JSON.stringify({ alias, fresh }));
      const eventId = Number(ctx.db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()?.id);
      fanoutRosterEventToInbox(ctx.db, group.group_id, eventId, peerId);
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
          "INSERT INTO events (type, sender_peer_id, group_id, body, parent_event_id, mentions_json) VALUES ('group_message', ?, ?, ?, ?, ?)",
        )
        .run(senderPeerId, group.group_id, message, parentEventId, mentionsJson);
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
    void notifySubscribers(ctx, pushTargets, event);

    // Always return `warnings` (and `delivery`) so consumers can destructure
    // without optional-chaining. Default-undefined fields are a trap for
    // LLM agents that may not write defensive code.
    const delivery = {
      pushed_to: pushTargets,
      inbox_only: allRecipients.filter((peerId) => !pushTargets.includes(peerId)),
    };
    return jsonResponse({ event, warnings, delivery }, { status: 201 });
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
        .query<EventRow, [number, number]>("SELECT * FROM events WHERE event_id = ? AND group_id = ?")
        .get(threadOf, group.group_id);
      if (!root) throw new HttpError(404, "thread_root_not_found", `No such event in group: ${threadOf}`);
      if (root.parent_event_id !== null) {
        throw new HttpError(400, "thread_of_not_root", `thread_of must reference a thread root (event ${threadOf} is itself a reply)`);
      }
      rows = ctx.db
        .query<EventRow, [number, number, number, number, number]>(
          `SELECT * FROM events
           WHERE group_id = ? AND event_id >= ? AND (event_id = ? OR parent_event_id = ?)
           ORDER BY event_id ASC
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
                  (SELECT COUNT(*) FROM events r WHERE r.parent_event_id = e.event_id) AS reply_count,
                  (SELECT MAX(event_id) FROM events r WHERE r.parent_event_id = e.event_id) AS last_reply_event_id
           FROM events e
           WHERE e.group_id = ? AND e.event_id >= ? AND e.parent_event_id IS NULL
           ORDER BY e.event_id ASC
           LIMIT ?`,
        )
        .all(group.group_id, historyFrom, limit);
      return jsonResponse({ events: mainRows, next_cursor: mainRows.at(-1)?.event_id ?? cursor });
    }
    return jsonResponse({ events: rows, next_cursor: rows.at(-1)?.event_id ?? cursor });
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
    const event = getEvent(ctx.db, eventId);
    if (event.group_id !== null) {
      // Group event: caller must be (or have been) a member of that group.
      // Match the history endpoint's visibility model: history_from_event_id
      // cuts off events the joiner shouldn't see.
      const member = ctx.db
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
    return jsonResponse({ event });
  }

  // GET /threads/:root_event_id — single-call thread state: root + replies +
  // participant alias list + last_event_id. Closes the gap alice flagged in
  // the sustained-thread test ("I'd have to call group_history twice to pick
  // up a stale thread"). Combines what bridge_group_history(thread_of=)
  // returns with a derived participants list so callers can render a thread
  // header without an extra roster call.
  const threadGet = url.pathname.match(/^\/threads\/(\d+)$/);
  if (request.method === "GET" && threadGet) {
    const rootEventId = Number(threadGet[1]);
    const peerId = url.searchParams.get("peer_id");
    if (!peerId) throw new HttpError(400, "invalid_request", "peer_id query parameter is required");
    const root = getEvent(ctx.db, rootEventId);
    if (root.group_id === null) {
      throw new HttpError(400, "thread_of_not_root", `Event ${rootEventId} is a DM, not a group thread root`);
    }
    if (root.parent_event_id !== null) {
      throw new HttpError(400, "thread_of_not_root", `Event ${rootEventId} is itself a reply; pass the root event_id`);
    }
    const member = ctx.db
      .query<{ history_from_event_id: number | null }, [number, string]>(
        "SELECT history_from_event_id FROM group_members WHERE group_id = ? AND peer_id = ?",
      )
      .get(root.group_id, peerId);
    if (!member) throw new HttpError(404, "thread_not_visible", `Thread ${rootEventId} is not visible to peer ${peerId}`);
    if (rootEventId < (member.history_from_event_id ?? 0)) {
      throw new HttpError(404, "thread_not_visible", `Thread ${rootEventId} is before peer's history_from boundary`);
    }
    const replies = ctx.db
      .query<EventRow, [number, number]>(
        `SELECT * FROM events
         WHERE group_id = ? AND parent_event_id = ?
         ORDER BY event_id ASC`,
      )
      .all(root.group_id, rootEventId);
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
    if (match[1]) tokens.add(match[1]);
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
  // ON CONFLICT path also clears deleted_at — re-registering with a known
  // peer_id resurrects a soft-deleted peer. The companion fixup below
  // re-activates any group_members rows the peer still owns so a returning
  // peer rejoins their old groups rather than having to re-issue join calls
  // (which would fail with alias-taken if anyone reclaimed in the interim —
  // resurrection is symmetric with the deletion that preceded it).
  db.query(
    `INSERT INTO peers (peer_id, tool, session_name, purpose, machine_id, lease_expires_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(peer_id) DO UPDATE SET
       tool = excluded.tool,
       session_name = excluded.session_name,
       purpose = excluded.purpose,
       machine_id = excluded.machine_id,
       lease_expires_at = excluded.lease_expires_at,
       deleted_at = NULL,
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

const MEMBER_SELECT_SQL = `gm.*, p.session_name, p.tool,
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
  return new Response(file, { headers: { "content-type": contentType, "cache-control": "no-cache" } });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
