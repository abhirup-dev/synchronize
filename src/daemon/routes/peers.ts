import { hostname } from "node:os";

import { ACTIVITY_STATES, WORK_PHASES } from "../../constants.ts";
import { HttpError, jsonResponse } from "../../http.ts";
import type { PeerWorkState, PeerWorkStateHistoryEntry, WorkScope } from "../../api/types.ts";
import { getGroup, MEMBER_SELECT_SQL, type MemberRow } from "../repo/groups.ts";
import {
  derivePeerWorkState,
  ensurePeer,
  findPeerByHostSession,
  formatPeer,
  getPeer,
  leaseExpiresAtForTool,
  softDeletePeerIfPresent,
  upsertPeer,
  type PeerRow,
} from "../repo/peers.ts";
import { emitWebStateChanged } from "../services/web-events.ts";
import { buildWebAgent, log, type DaemonContext } from "../server.ts";
import { optionalInteger, optionalString, readBody, requireString } from "../validation.ts";

const DEFAULT_WORK_STATE_TTL_MINUTES = 15;
const MAX_WORK_STATE_TTL_MINUTES = 8 * 60;
const DEFAULT_WORK_STATE_HISTORY_LIMIT = 100;
const MAX_WORK_STATE_HISTORY_LIMIT = 500;
const WORK_STATE_INFERENCE_WINDOW_MS = 10 * 60_000;
const WORK_STATE_SOURCE_VALUES = ["api", "mcp", "hook"] as const;
const WORK_SCOPE_KIND_VALUES = ["group", "dm", "issue", "file", "repo", "branch", "url", "custom"] as const;
const WORK_STATE_CORRELATION_VALUES = ["explicit", "none", "timestamp_inferred"] as const;

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
    return jsonResponse({ peer: formatPeerForRoute(ctx, peerId) }, { status: 201 });
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
    emitWebStateChanged(ctx, { domains: ["peer_presence"], peerId, agent: buildWebAgent(ctx, peerId) });
    return jsonResponse({ peer: formatPeerForRoute(ctx, peerId) });
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
    emitWebStateChanged(ctx, { domains: ["peer_presence"], peerId, agent: buildWebAgent(ctx, peerId) });
    return jsonResponse({ peer: formatPeerForRoute(ctx, peerId) });
  }

  if (request.method === "POST" && url.pathname === "/peers/work-state") {
    const body = await readBody(request);
    const peerId = resolvePeerIdFromBody(ctx, body);
    const peer = getPeer(ctx.db, peerId);
    const now = new Date().toISOString();
    const clear = body.clear === true;
    const source = parseWorkSource(body);
    const triggerEventId = optionalPositiveInteger(body, "trigger_event_id");
    if (triggerEventId !== undefined) ensureEventExists(ctx, triggerEventId);

    if (clear) {
      const hadStoredState = hasStoredWorkState(peer);
      const prior = {
        phase: peer.work_phase ?? null,
        summary: peer.work_summary ?? null,
        scopeJson: peer.work_scope_json ?? null,
        task: peer.work_task ?? null,
        triggerEventId: peer.work_trigger_event_id ?? triggerEventId ?? null,
        source: peer.work_source ?? source,
        startedAt: peer.work_started_at ?? null,
        updatedAt: peer.work_updated_at ?? now,
        expiresAt: peer.work_expires_at ?? null,
      };
      if (hadStoredState) {
        ctx.db.transaction(() => {
          clearPeerWorkState(ctx, peerId, now);
          insertWorkStateHistory(ctx, {
            peerId,
            phase: prior.phase,
            summary: prior.summary,
            scopeJson: prior.scopeJson,
            task: prior.task,
            triggerEventId: prior.triggerEventId,
            correlationMethod: prior.triggerEventId ? "explicit" : "none",
            source: prior.source,
            startedAt: prior.startedAt,
            updatedAt: now,
            expiresAt: prior.expiresAt,
            clearedAt: now,
          });
        })();
        emitWebStateChanged(ctx, { domains: ["work_state"], peerId, agent: buildWebAgent(ctx, peerId) });
      }
      const formatted = formatPeerForRoute(ctx, peerId);
      return jsonResponse({ peer: formatted, work_state: null, ttl_minutes: null, expires_at: null });
    }

    if (body.clear !== undefined) {
      throw new HttpError(400, "invalid_request", "clear must be true when provided");
    }
    if (peer.lifecycle_state === "archived") {
      throw new HttpError(409, "peer_archived", "Archived peers cannot set active work state");
    }

    const phase = parseWorkPhase(body);
    const summary = boundedString(requireString(body, "summary"), "summary", 500);
    const scopeJson = parseWorkScopeJson(body);
    const task = optionalBoundedString(body, "task", 240) ?? null;
    const ttlMinutes = parseTtlMinutes(body);
    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
    const priorCurrent = derivePeerWorkState(peer, now);
    const sameVisibleState =
      priorCurrent !== null &&
      peer.work_phase === phase &&
      peer.work_summary === summary &&
      normalizedNullable(peer.work_scope_json) === normalizedNullable(scopeJson) &&
      normalizedNullable(peer.work_task) === normalizedNullable(task) &&
      (peer.work_trigger_event_id ?? null) === (triggerEventId ?? null) &&
      peer.work_source === source;
    const startedAt = sameVisibleState && peer.work_started_at ? peer.work_started_at : now;

    ctx.db.transaction(() => {
      const leaseExpiresAt = leaseExpiresAtForTool(peer.tool, ctx.config.daemon.leaseMs);
      ctx.db
        .query(
          `UPDATE peers
           SET work_phase = ?, work_summary = ?, work_scope_json = ?, work_task = ?,
               work_trigger_event_id = ?, work_started_at = ?, work_updated_at = ?,
               work_expires_at = ?, work_source = ?,
               activity_state = 'working',
               last_activity_at = ?,
               lease_expires_at = ?,
               updated_at = ?
           WHERE peer_id = ?`,
        )
        .run(phase, summary, scopeJson, task, triggerEventId ?? null, startedAt, now, expiresAt, source, now, leaseExpiresAt, now, peerId);
      if (!sameVisibleState) {
        insertWorkStateHistory(ctx, {
          peerId,
          phase,
          summary,
          scopeJson,
          task,
          triggerEventId: triggerEventId ?? null,
          correlationMethod: triggerEventId ? "explicit" : "none",
          source,
          startedAt,
          updatedAt: now,
          expiresAt,
          clearedAt: null,
        });
      }
    })();
    log(`peer work-state peer_id=${peerId} phase=${phase} ttl_minutes=${ttlMinutes}`);
    if (!sameVisibleState) emitWebStateChanged(ctx, { domains: ["work_state"], peerId, agent: buildWebAgent(ctx, peerId) });
    const formatted = formatPeerForRoute(ctx, peerId);
    return jsonResponse({ peer: formatted, work_state: formatted.work_state, ttl_minutes: ttlMinutes, expires_at: expiresAt });
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
        peers: rows.map((row) => ({ ...formatPeer(row, now), active: Boolean(row.active) })),
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
      peers: rows.map((row) => formatPeer(row, now)),
    });
  }

  const workStateHistory = url.pathname.match(/^\/peers\/([^/]+)\/work-state-history$/);
  if (request.method === "GET" && workStateHistory) {
    const peerId = decodeURIComponent(workStateHistory[1] ?? "");
    ensurePeer(ctx.db, peerId);
    const limit = parseHistoryLimit(url.searchParams.get("limit"));
    const from = parseIsoQueryParam(url.searchParams.get("from"), "from");
    const to = parseIsoQueryParam(url.searchParams.get("to"), "to");
    const phase = parseOptionalHistoryPhase(url.searchParams.get("phase"));
    const taskContains = url.searchParams.get("task_contains")?.trim() || null;
    const scopeKind = parseOptionalScopeKind(url.searchParams.get("scope_kind"));
    const scopeValue = url.searchParams.get("scope_value")?.trim() || null;
    const eventId = parsePositiveIntQueryParam(url.searchParams.get("event_id"), "event_id");
    const correlation = parseOptionalCorrelation(url.searchParams.get("correlation"));

    const filters: string[] = ["peer_id = ?"];
    const params: Array<string | number> = [peerId];
    if (from) {
      filters.push("updated_at >= ?");
      params.push(from);
    }
    if (to) {
      filters.push("updated_at <= ?");
      params.push(to);
    }
    if (phase) {
      filters.push("phase = ?");
      params.push(phase);
    }
    if (taskContains) {
      filters.push("task LIKE ?");
      params.push(`%${taskContains}%`);
    }

    const rows = ctx.db
      .query<WorkStateHistoryRow, Array<string | number>>(
        `SELECT *
         FROM peer_work_state_history
         WHERE ${filters.join(" AND ")}
         ORDER BY updated_at DESC, history_id DESC
         LIMIT ?`,
      )
      .all(...params, MAX_WORK_STATE_HISTORY_LIMIT + 1);
    const filtered = rows
      .map((row) => formatWorkStateHistoryRow(ctx, row))
      .filter((entry) => {
        if (scopeKind && entry.scope?.kind !== scopeKind) return false;
        if (scopeValue && entry.scope?.value !== scopeValue) return false;
        if (eventId !== undefined && entry.trigger_event_id !== eventId && entry.inferred_event_id !== eventId) return false;
        if (correlation && entry.correlation_method !== correlation) return false;
        return true;
      });
    return jsonResponse({ history: filtered.slice(0, limit), truncated: filtered.length > limit || rows.length > MAX_WORK_STATE_HISTORY_LIMIT });
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

function formatPeerForRoute(ctx: DaemonContext, peerId: string) {
  const now = new Date().toISOString();
  const row = getPeer(ctx.db, peerId);
  return formatPeer({ ...row, online: row.lease_expires_at > now }, now);
}

function resolvePeerIdFromBody(ctx: DaemonContext, body: Record<string, unknown>): string {
  const peerId = optionalString(body, "peer_id");
  if (peerId) return peerId;
  const hostTool = optionalString(body, "host_tool");
  const hostSessionId = optionalString(body, "host_session_id");
  if (!hostTool || !hostSessionId) {
    throw new HttpError(400, "invalid_request", "peer_id or host_tool+host_session_id is required");
  }
  const resolved = findPeerByHostSession(ctx.db, hostTool, hostSessionId);
  if (!resolved) throw new HttpError(404, "peer_not_found", `No peer for ${hostTool} session ${hostSessionId}`);
  return resolved;
}

function parseWorkPhase(body: Record<string, unknown>): PeerWorkState["phase"] {
  const phase = requireString(body, "phase");
  if (!(WORK_PHASES as readonly string[]).includes(phase)) {
    throw new HttpError(400, "invalid_work_phase", `Unknown work phase: ${phase}`);
  }
  return phase as PeerWorkState["phase"];
}

function parseWorkSource(body: Record<string, unknown>): PeerWorkState["source"] {
  const source = optionalString(body, "source") ?? "api";
  if (!(WORK_STATE_SOURCE_VALUES as readonly string[]).includes(source)) {
    throw new HttpError(400, "invalid_work_source", "source must be api, mcp, or hook");
  }
  return source as PeerWorkState["source"];
}

function parseTtlMinutes(body: Record<string, unknown>): number {
  const value = optionalInteger(body, "ttl_minutes");
  if (value === undefined) return DEFAULT_WORK_STATE_TTL_MINUTES;
  if (value < 1) throw new HttpError(400, "invalid_ttl_minutes", "ttl_minutes must be at least 1");
  return Math.min(value, MAX_WORK_STATE_TTL_MINUTES);
}

function parseWorkScopeJson(body: Record<string, unknown>): string | null {
  const value = body.scope;
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "invalid_work_scope", "scope must be an object");
  }
  const raw = value as Record<string, unknown>;
  const kind = typeof raw.kind === "string" ? raw.kind.trim() : "";
  if (!(WORK_SCOPE_KIND_VALUES as readonly string[]).includes(kind)) {
    throw new HttpError(400, "invalid_work_scope", "scope.kind is invalid");
  }
  const scopeValue = typeof raw.value === "string" ? raw.value.trim() : "";
  if (!scopeValue) throw new HttpError(400, "invalid_work_scope", "scope.value is required");
  const label = raw.label === undefined || raw.label === null ? undefined : typeof raw.label === "string" ? raw.label.trim() : null;
  if (label === null) throw new HttpError(400, "invalid_work_scope", "scope.label must be a string");
  const scope: WorkScope = {
    kind: kind as WorkScope["kind"],
    value: boundedString(scopeValue, "scope.value", 500),
    ...(label ? { label: boundedString(label, "scope.label", 200) } : {}),
  };
  return JSON.stringify(scope);
}

function optionalPositiveInteger(body: Record<string, unknown>, key: string): number | undefined {
  const value = optionalInteger(body, key);
  if (value === undefined) return undefined;
  if (value < 1) throw new HttpError(400, "invalid_request", `${key} must be a positive integer`);
  return value;
}

function ensureEventExists(ctx: DaemonContext, eventId: number): void {
  const found = ctx.db.query<{ event_id: number }, [number]>("SELECT event_id FROM events WHERE event_id = ?").get(eventId);
  if (!found) throw new HttpError(404, "event_not_found", `Event not found: ${eventId}`);
}

function optionalBoundedString(body: Record<string, unknown>, key: string, max: number): string | undefined {
  const value = optionalString(body, key);
  return value === undefined ? undefined : boundedString(value, key, max);
}

function boundedString(value: string, key: string, max: number): string {
  if (value.length > max) throw new HttpError(400, "invalid_request", `${key} must be at most ${max} characters`);
  return value;
}

function normalizedNullable(value: string | null | undefined): string | null {
  return value ?? null;
}

function hasStoredWorkState(peer: PeerRow): boolean {
  return Boolean(
    peer.work_phase ||
      peer.work_summary ||
      peer.work_scope_json ||
      peer.work_task ||
      peer.work_trigger_event_id ||
      peer.work_started_at ||
      peer.work_updated_at ||
      peer.work_expires_at ||
      peer.work_source,
  );
}

function clearPeerWorkState(ctx: DaemonContext, peerId: string, now: string): void {
  ctx.db
    .query(
      `UPDATE peers
       SET work_phase = NULL,
           work_summary = NULL,
           work_scope_json = NULL,
           work_task = NULL,
           work_trigger_event_id = NULL,
           work_started_at = NULL,
           work_updated_at = NULL,
           work_expires_at = NULL,
           work_source = NULL,
           updated_at = ?
       WHERE peer_id = ?`,
    )
    .run(now, peerId);
}

function insertWorkStateHistory(
  ctx: DaemonContext,
  input: {
    peerId: string;
    phase: string | null;
    summary: string | null;
    scopeJson: string | null;
    task: string | null;
    triggerEventId: number | null;
    correlationMethod: "explicit" | "none";
    source: string;
    startedAt: string | null;
    updatedAt: string;
    expiresAt: string | null;
    clearedAt: string | null;
  },
): void {
  ctx.db
    .query(
      `INSERT INTO peer_work_state_history (
         peer_id, phase, summary, scope_json, task, trigger_event_id, correlation_method,
         source, started_at, updated_at, expires_at, cleared_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.peerId,
      input.phase,
      input.summary,
      input.scopeJson,
      input.task,
      input.triggerEventId,
      input.correlationMethod,
      input.source,
      input.startedAt,
      input.updatedAt,
      input.expiresAt,
      input.clearedAt,
    );
}

interface WorkStateHistoryRow {
  history_id: number;
  peer_id: string;
  phase: string | null;
  summary: string | null;
  scope_json: string | null;
  task: string | null;
  trigger_event_id: number | null;
  correlation_method: string;
  source: string;
  started_at: string | null;
  updated_at: string;
  expires_at: string | null;
  cleared_at: string | null;
  created_at: string;
}

function formatWorkStateHistoryRow(ctx: DaemonContext, row: WorkStateHistoryRow): PeerWorkStateHistoryEntry {
  const inferredEventId = row.trigger_event_id ? null : inferWorkStateEventId(ctx, row);
  const source = (WORK_STATE_SOURCE_VALUES as readonly string[]).includes(row.source)
    ? row.source as PeerWorkStateHistoryEntry["source"]
    : "api";
  const correlationMethod: PeerWorkStateHistoryEntry["correlation_method"] = row.trigger_event_id
    ? "explicit"
    : inferredEventId
    ? "timestamp_inferred"
    : "none";
  const scope = parseStoredWorkScope(row.scope_json);
  return {
    history_id: row.history_id,
    peer_id: row.peer_id,
    phase: (row.phase && (WORK_PHASES as readonly string[]).includes(row.phase) ? row.phase : null) as PeerWorkStateHistoryEntry["phase"],
    summary: row.summary,
    ...(scope ? { scope } : {}),
    ...(row.task ? { task: row.task } : {}),
    ...(row.trigger_event_id ? { trigger_event_id: row.trigger_event_id } : {}),
    ...(inferredEventId ? { inferred_event_id: inferredEventId } : {}),
    correlation_method: correlationMethod,
    source,
    started_at: row.started_at,
    updated_at: row.updated_at,
    expires_at: row.expires_at,
    cleared_at: row.cleared_at,
    created_at: row.created_at,
  };
}

function inferWorkStateEventId(ctx: DaemonContext, row: WorkStateHistoryRow): number | null {
  const updatedAtMs = Date.parse(row.updated_at);
  if (!Number.isFinite(updatedAtMs)) return null;
  const from = new Date(updatedAtMs - WORK_STATE_INFERENCE_WINDOW_MS).toISOString();
  const event = ctx.db
    .query<{ event_id: number }, [string, string, string, string]>(
      `SELECT event_id
       FROM events
       WHERE (sender_peer_id = ? OR recipient_peer_id = ?)
         AND created_at <= ?
         AND created_at >= ?
       ORDER BY created_at DESC, event_id DESC
       LIMIT 1`,
    )
    .get(row.peer_id, row.peer_id, row.updated_at, from);
  return event?.event_id ?? null;
}

function parseStoredWorkScope(value: string | null): WorkScope | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<WorkScope>;
    if (!parsed || typeof parsed !== "object") return undefined;
    if (!(WORK_SCOPE_KIND_VALUES as readonly string[]).includes(String(parsed.kind))) return undefined;
    if (typeof parsed.value !== "string" || parsed.value.trim() === "") return undefined;
    if (parsed.label !== undefined && typeof parsed.label !== "string") return undefined;
    return {
      kind: parsed.kind as WorkScope["kind"],
      value: parsed.value,
      ...(parsed.label ? { label: parsed.label } : {}),
    };
  } catch {
    return undefined;
  }
}

function parseHistoryLimit(raw: string | null): number {
  if (!raw) return DEFAULT_WORK_STATE_HISTORY_LIMIT;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1) throw new HttpError(400, "invalid_request", "limit must be a positive integer");
  return Math.min(value, MAX_WORK_STATE_HISTORY_LIMIT);
}

function parseIsoQueryParam(raw: string | null, key: string): string | null {
  if (!raw || raw.trim() === "") return null;
  const value = raw.trim();
  if (!Number.isFinite(Date.parse(value))) throw new HttpError(400, "invalid_request", `${key} must be an ISO timestamp`);
  return value;
}

function parseOptionalHistoryPhase(raw: string | null): PeerWorkStateHistoryEntry["phase"] | null {
  if (!raw || raw.trim() === "") return null;
  const phase = raw.trim();
  if (!(WORK_PHASES as readonly string[]).includes(phase)) throw new HttpError(400, "invalid_work_phase", `Unknown work phase: ${phase}`);
  return phase as PeerWorkStateHistoryEntry["phase"];
}

function parseOptionalScopeKind(raw: string | null): WorkScope["kind"] | null {
  if (!raw || raw.trim() === "") return null;
  const kind = raw.trim();
  if (!(WORK_SCOPE_KIND_VALUES as readonly string[]).includes(kind)) throw new HttpError(400, "invalid_work_scope", "scope_kind is invalid");
  return kind as WorkScope["kind"];
}

function parsePositiveIntQueryParam(raw: string | null, key: string): number | undefined {
  if (!raw || raw.trim() === "") return undefined;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1) throw new HttpError(400, "invalid_request", `${key} must be a positive integer`);
  return value;
}

function parseOptionalCorrelation(raw: string | null): PeerWorkStateHistoryEntry["correlation_method"] | null {
  if (!raw || raw.trim() === "") return null;
  const value = raw.trim();
  if (!(WORK_STATE_CORRELATION_VALUES as readonly string[]).includes(value)) {
    throw new HttpError(400, "invalid_request", "correlation must be explicit, none, or timestamp_inferred");
  }
  return value as PeerWorkStateHistoryEntry["correlation_method"];
}
