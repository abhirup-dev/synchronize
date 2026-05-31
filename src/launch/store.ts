import type { Database } from "bun:sqlite";
import type { LaunchTool } from "./build.ts";
import type { LaunchState, LaunchWorkKind } from "./lifecycle.ts";

export type LaunchWorkStatus = "queued" | "running" | "done" | "failed";

export interface LaunchIntentRow {
  launch_id: string;
  peer_id: string;
  tool: LaunchTool;
  session_name: string;
  alias: string;
  cwd: string;
  target_group: string | null;
  model: string | null;
  thinking: string | null;
  args_json: string | null;
  backend: string;
  backend_profile: string | null;
  backend_title: string;
  state: LaunchState;
  failure_code: string | null;
  failure_message: string | null;
  created_at: string;
  updated_at: string;
  accepted_at: string | null;
  spawned_at: string | null;
  prompt_seen_at: string | null;
  prompt_accepted_at: string | null;
  registered_at: string | null;
  reconciled_at: string | null;
  joined_at: string | null;
  stale_at: string | null;
  failed_at: string | null;
  stopped_at: string | null;
}

export interface LaunchEventRow {
  event_id: number;
  launch_id: string;
  kind: string;
  from_state: LaunchState | null;
  to_state: LaunchState | null;
  payload_json: string | null;
  created_at: string;
}

export interface LaunchWorkRow {
  work_id: number;
  launch_id: string;
  kind: LaunchWorkKind;
  status: LaunchWorkStatus;
  idempotency_key: string;
  claimed_by: string | null;
  lease_expires_at: string | null;
  attempts: number;
  max_attempts: number;
  next_run_at: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateLaunchIntentInput {
  launchId: string;
  peerId: string;
  tool: LaunchTool;
  sessionName: string;
  alias: string;
  cwd: string;
  backend: string;
  backendTitle: string;
  targetGroup?: string | null;
  model?: string | null;
  thinking?: string | null;
  args?: string[] | null;
  backendProfile?: string | null;
  state?: LaunchState;
  now?: string;
}

export interface AppendLaunchEventInput {
  launchId: string;
  kind: string;
  fromState?: LaunchState | null;
  toState?: LaunchState | null;
  payload?: Record<string, unknown> | null;
  createdAt?: string;
}

export interface UpdateLaunchStateInput {
  launchId: string;
  state: LaunchState;
  fromState?: LaunchState | null;
  eventKind: string;
  payload?: Record<string, unknown> | null;
  failureCode?: string | null;
  failureMessage?: string | null;
  now: string;
}

export interface EnqueueLaunchWorkInput {
  launchId: string;
  kind: LaunchWorkKind;
  idempotencyKey: string;
  nextRunAt: string;
  maxAttempts?: number;
}

export interface ClaimLaunchWorkInput {
  workerId: string;
  now: string;
  leaseExpiresAt: string;
}

const TIMESTAMP_COLUMNS: Partial<Record<LaunchState, keyof LaunchIntentRow>> = {
  accepted: "accepted_at",
  spawned: "spawned_at",
  prompt_waiting: "prompt_seen_at",
  prompt_accepted: "prompt_accepted_at",
  registered: "registered_at",
  reconciling: "reconciled_at",
  joined: "joined_at",
  stale: "stale_at",
  failed: "failed_at",
  stopped: "stopped_at",
};

export function createLaunchIntent(db: Database, input: CreateLaunchIntentInput): LaunchIntentRow {
  const now = input.now ?? currentTimestamp();
  db
    .query(
      `INSERT INTO launch_intents (
         launch_id, peer_id, tool, session_name, alias, cwd, target_group,
         model, thinking, args_json, backend, backend_profile, backend_title,
         state, created_at, updated_at, accepted_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.launchId,
      input.peerId,
      input.tool,
      input.sessionName,
      input.alias,
      input.cwd,
      input.targetGroup ?? null,
      input.model ?? null,
      input.thinking ?? null,
      input.args ? JSON.stringify(input.args) : null,
      input.backend,
      input.backendProfile ?? null,
      input.backendTitle,
      input.state ?? "accepted",
      now,
      now,
      input.state === undefined || input.state === "accepted" ? now : null,
    );
  return getLaunchIntent(db, input.launchId)!;
}

export function getLaunchIntent(db: Database, launchId: string): LaunchIntentRow | null {
  return db.query<LaunchIntentRow, [string]>("SELECT * FROM launch_intents WHERE launch_id = ?").get(launchId) ?? null;
}

export function getLaunchIntentByPeer(db: Database, peerId: string): LaunchIntentRow | null {
  return db
    .query<LaunchIntentRow, [string]>(
      `SELECT *
       FROM launch_intents
       WHERE peer_id = ?
       ORDER BY updated_at DESC, created_at DESC
       LIMIT 1`,
    )
    .get(peerId) ?? null;
}

export function appendLaunchEvent(db: Database, input: AppendLaunchEventInput): LaunchEventRow {
  db
    .query(
      `INSERT INTO launch_events (launch_id, kind, from_state, to_state, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.launchId,
      input.kind,
      input.fromState ?? null,
      input.toState ?? null,
      input.payload ? JSON.stringify(input.payload) : null,
      input.createdAt ?? currentTimestamp(),
    );
  const id = Number(db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()?.id);
  return db.query<LaunchEventRow, [number]>("SELECT * FROM launch_events WHERE event_id = ?").get(id)!;
}

export function listLaunchEvents(db: Database, launchId: string): LaunchEventRow[] {
  return db
    .query<LaunchEventRow, [string]>("SELECT * FROM launch_events WHERE launch_id = ? ORDER BY event_id ASC")
    .all(launchId);
}

export function updateLaunchState(db: Database, input: UpdateLaunchStateInput): LaunchIntentRow {
  const timestampColumn = TIMESTAMP_COLUMNS[input.state];
  db.transaction(() => {
    if (input.state === "prompt_waiting") {
      db
        .query(
          `UPDATE launch_intents
           SET state = ?,
               updated_at = ?,
               spawned_at = COALESCE(spawned_at, ?),
               prompt_seen_at = COALESCE(prompt_seen_at, ?),
               failure_code = ?,
               failure_message = ?
           WHERE launch_id = ?`,
        )
        .run(input.state, input.now, input.now, input.now, input.failureCode ?? null, input.failureMessage ?? null, input.launchId);
    } else if (timestampColumn) {
      db
        .query(
          `UPDATE launch_intents
           SET state = ?,
               updated_at = ?,
               ${timestampColumn} = COALESCE(${timestampColumn}, ?),
               failure_code = ?,
               failure_message = ?
           WHERE launch_id = ?`,
        )
        .run(input.state, input.now, input.now, input.failureCode ?? null, input.failureMessage ?? null, input.launchId);
    } else {
      db
        .query(
          `UPDATE launch_intents
           SET state = ?, updated_at = ?, failure_code = ?, failure_message = ?
           WHERE launch_id = ?`,
        )
        .run(input.state, input.now, input.failureCode ?? null, input.failureMessage ?? null, input.launchId);
    }
    appendLaunchEvent(db, {
      launchId: input.launchId,
      kind: input.eventKind,
      fromState: input.fromState ?? null,
      toState: input.state,
      payload: input.payload ?? null,
      createdAt: input.now,
    });
  })();
  return getLaunchIntent(db, input.launchId)!;
}

export function enqueueLaunchWork(db: Database, input: EnqueueLaunchWorkInput): LaunchWorkRow {
  db
    .query(
      `INSERT INTO launch_work (launch_id, kind, status, idempotency_key, max_attempts, next_run_at)
       VALUES (?, ?, 'queued', ?, ?, ?)
       ON CONFLICT(idempotency_key) DO UPDATE SET
         next_run_at = MIN(next_run_at, excluded.next_run_at),
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    )
    .run(input.launchId, input.kind, input.idempotencyKey, input.maxAttempts ?? 3, input.nextRunAt);
  return getLaunchWorkByIdempotencyKey(db, input.idempotencyKey)!;
}

export function getLaunchWorkByIdempotencyKey(db: Database, idempotencyKey: string): LaunchWorkRow | null {
  return db
    .query<LaunchWorkRow, [string]>("SELECT * FROM launch_work WHERE idempotency_key = ?")
    .get(idempotencyKey) ?? null;
}

export function claimNextLaunchWork(db: Database, input: ClaimLaunchWorkInput): LaunchWorkRow | null {
  return db.transaction(() => {
    const work = db
      .query<LaunchWorkRow, [string, string]>(
        `SELECT *
         FROM launch_work
         WHERE (
           status = 'queued'
           OR (status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?)
         )
           AND next_run_at <= ?
           AND attempts < max_attempts
         ORDER BY next_run_at ASC, work_id ASC
         LIMIT 1`,
      )
      .get(input.now, input.now);
    if (!work) return null;
    db
      .query(
        `UPDATE launch_work
         SET status = 'running',
             claimed_by = ?,
             lease_expires_at = ?,
             attempts = attempts + 1,
             updated_at = ?
         WHERE work_id = ?`,
      )
      .run(input.workerId, input.leaseExpiresAt, input.now, work.work_id);
    return getLaunchWorkById(db, work.work_id);
  })();
}

export function completeLaunchWork(db: Database, workId: number, now: string): LaunchWorkRow {
  db
    .query(
      `UPDATE launch_work
       SET status = 'done',
           claimed_by = NULL,
           lease_expires_at = NULL,
           last_error = NULL,
           updated_at = ?
       WHERE work_id = ?`,
    )
    .run(now, workId);
  return getLaunchWorkById(db, workId)!;
}

export function failLaunchWork(db: Database, workId: number, input: { error: string; nextRunAt?: string | null; now: string }): LaunchWorkRow {
  db
    .query(
      `UPDATE launch_work
       SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
           claimed_by = NULL,
           lease_expires_at = NULL,
           last_error = ?,
           next_run_at = COALESCE(?, next_run_at),
           updated_at = ?
       WHERE work_id = ?`,
    )
    .run(input.error, input.nextRunAt ?? null, input.now, workId);
  return getLaunchWorkById(db, workId)!;
}

export function getLaunchWorkById(db: Database, workId: number): LaunchWorkRow | null {
  return db.query<LaunchWorkRow, [number]>("SELECT * FROM launch_work WHERE work_id = ?").get(workId) ?? null;
}

export function listLaunchWork(db: Database, launchId: string): LaunchWorkRow[] {
  return db
    .query<LaunchWorkRow, [string]>("SELECT * FROM launch_work WHERE launch_id = ? ORDER BY work_id ASC")
    .all(launchId);
}

function currentTimestamp(): string {
  return new Date().toISOString();
}
