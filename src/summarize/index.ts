// Thread summarization core (sync-b8q).
//
// All cache reads/writes + the cold-thread worker loop live here. The worker
// is wired into the daemon lifecycle via startSummarizeWorker / stop().
//
// Direct SQL via the shared Database handle — no HTTP self-calls.

import { Database } from "bun:sqlite";
import {
  PROMPT_VERSION,
  resolveProviderConfig,
  summarizeTranscript,
  type ProviderConfig,
} from "../llm/index.ts";

// ─── Strategies ───────────────────────────────────────────────────────────

export type Strategy = "all" | "first_k" | "last_k" | "first_last";

export interface StrategyParams {
  k?: number;
  first_k?: number;
  last_k?: number;
}

export interface ResolvedStrategy {
  strategy: Strategy;
  params: StrategyParams;
}

const ALL_FALLBACK_BYTES = 50_000;

export function defaultStrategyFromEnv(env: NodeJS.ProcessEnv = process.env): ResolvedStrategy {
  const raw = (env.SYNCHRONIZE_SUMMARY_STRATEGY ?? "first_k").toLowerCase() as Strategy;
  if (raw === "all") return { strategy: "all", params: {} };
  if (raw === "first_last") {
    return {
      strategy: "first_last",
      params: {
        first_k: positiveInt(env.SYNCHRONIZE_SUMMARY_FIRST_K, 5),
        last_k: positiveInt(env.SYNCHRONIZE_SUMMARY_LAST_K, 10),
      },
    };
  }
  if (raw === "last_k") {
    return { strategy: "last_k", params: { k: positiveInt(env.SYNCHRONIZE_SUMMARY_K, 3) } };
  }
  return { strategy: "first_k", params: { k: positiveInt(env.SYNCHRONIZE_SUMMARY_K, 3) } };
}

function positiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

// ─── Types ────────────────────────────────────────────────────────────────

interface ThreadEventRow {
  event_id: number;
  sender_peer_id: string | null;
  body: string | null;
  parent_event_id: number | null;
  created_at: string;
}

interface DiscoverableThreadRow {
  root_event_id: number;
  group_name: string;
  reply_count: number;
  last_event_id: number;
  last_activity_at: string;
}

export interface ThreadSummaryRow {
  root_event_id: number;
  summary: string;
  model: string;
  strategy: string;
  strategy_params_json: string;
  prompt_version: number;
  covered_last_event_id: number;
  covered_event_count: number;
  created_at: string;
  updated_at: string;
}

export interface ThreadSummaryResponse {
  summary: string | null;
  model: string | null;
  strategy: Strategy | null;
  strategy_params: StrategyParams | null;
  prompt_version: number | null;
  covered_last_event_id: number | null;
  covered_event_count: number | null;
  updated_at: string | null;
  stale: boolean;
  status: "ready" | "pending" | "disabled";
}

// ─── Reads ────────────────────────────────────────────────────────────────

export function getCachedSummary(db: Database, rootEventId: number): ThreadSummaryRow | null {
  return (
    db
      .query<ThreadSummaryRow, [number]>(
        "SELECT * FROM thread_summaries WHERE root_event_id = ?",
      )
      .get(rootEventId) ?? null
  );
}

export function loadSummaryResponse(
  db: Database,
  rootEventId: number,
  enabled: boolean,
): ThreadSummaryResponse {
  if (!enabled) {
    return emptyResponse("disabled");
  }
  const row = getCachedSummary(db, rootEventId);
  if (!row) return emptyResponse("pending");
  // Staleness: a new event has landed since this row was written, or the prompt
  // template has been bumped in code.
  const head = db
    .query<{ last_event_id: number } | null, [number]>(
      "SELECT last_event_id FROM discoverable_threads WHERE root_event_id = ?",
    )
    .get(rootEventId);
  const headLast = head?.last_event_id ?? row.covered_last_event_id;
  const stale = row.prompt_version < PROMPT_VERSION || row.covered_last_event_id < headLast;
  return {
    summary: row.summary,
    model: row.model,
    strategy: row.strategy as Strategy,
    strategy_params: JSON.parse(row.strategy_params_json) as StrategyParams,
    prompt_version: row.prompt_version,
    covered_last_event_id: row.covered_last_event_id,
    covered_event_count: row.covered_event_count,
    updated_at: row.updated_at,
    stale,
    status: "ready",
  };
}

function emptyResponse(status: ThreadSummaryResponse["status"]): ThreadSummaryResponse {
  return {
    summary: null,
    model: null,
    strategy: null,
    strategy_params: null,
    prompt_version: null,
    covered_last_event_id: null,
    covered_event_count: null,
    updated_at: null,
    stale: false,
    status,
  };
}

// ─── Selection + transcript ───────────────────────────────────────────────

function loadThreadEvents(db: Database, rootEventId: number): ThreadEventRow[] {
  const root = db
    .query<ThreadEventRow, [number]>(
      `SELECT event_id, sender_peer_id, body, parent_event_id, created_at
       FROM events
       WHERE event_id = ? AND type = 'group_message' AND parent_event_id IS NULL`,
    )
    .get(rootEventId);
  if (!root) return [];
  const replies = db
    .query<ThreadEventRow, [number]>(
      `SELECT event_id, sender_peer_id, body, parent_event_id, created_at
       FROM events
       WHERE parent_event_id = ? AND type = 'group_message'
       ORDER BY event_id ASC`,
    )
    .all(rootEventId);
  return [root, ...replies];
}

export function selectEvents(
  events: ThreadEventRow[],
  resolved: ResolvedStrategy,
): ThreadEventRow[] {
  if (events.length === 0) return [];
  const root = events[0]!;
  const replies = events.slice(1);
  const { strategy, params } = resolved;

  if (strategy === "all") return events;

  if (strategy === "first_k") {
    const k = params.k ?? 3;
    return [root, ...replies.slice(0, k)];
  }
  if (strategy === "last_k") {
    const k = params.k ?? 3;
    return [root, ...replies.slice(Math.max(0, replies.length - k))];
  }
  // first_last: root + first first_k replies + last last_k replies (deduped)
  const firstK = params.first_k ?? 5;
  const lastK = params.last_k ?? 10;
  const seen = new Set<number>();
  const out: ThreadEventRow[] = [];
  for (const e of replies.slice(0, firstK)) {
    if (!seen.has(e.event_id)) {
      seen.add(e.event_id);
      out.push(e);
    }
  }
  for (const e of replies.slice(Math.max(0, replies.length - lastK))) {
    if (!seen.has(e.event_id)) {
      seen.add(e.event_id);
      out.push(e);
    }
  }
  out.sort((a, b) => a.event_id - b.event_id);
  return [root, ...out];
}

function renderTranscript(
  db: Database,
  events: ThreadEventRow[],
  rootEventId: number,
): string {
  // Cheap inline alias lookup (handful of distinct senders per thread).
  const lines: string[] = [];
  for (const e of events) {
    const who = e.sender_peer_id
      ? db
          .query<{ session_name: string | null }, [string]>(
            "SELECT session_name FROM peers WHERE peer_id = ?",
          )
          .get(e.sender_peer_id)?.session_name ?? e.sender_peer_id
      : "(system)";
    const tag = e.event_id === rootEventId ? "ROOT" : "reply";
    lines.push(`[${tag}] ${who} @ ${e.created_at}`);
    lines.push((e.body ?? "").trim());
    lines.push("");
  }
  return lines.join("\n");
}

// ─── Summarize (single thread) ────────────────────────────────────────────

export interface SummarizeOptions {
  strategy?: ResolvedStrategy;
}

/**
 * Run the LLM, upsert the cache row, and return it. Caller is responsible for
 * enforcing the cold-gate / min-replies / disabled checks — this is the raw
 * "do it now" entry point used by both POST and worker.
 */
export async function summarizeThread(
  db: Database,
  cfg: ProviderConfig,
  rootEventId: number,
  opts: SummarizeOptions = {},
): Promise<ThreadSummaryRow> {
  const events = loadThreadEvents(db, rootEventId);
  if (events.length === 0) {
    throw new Error(`no thread root event_id=${rootEventId}`);
  }
  let resolved = opts.strategy ?? defaultStrategyFromEnv();
  let selected = selectEvents(events, resolved);
  let transcript = renderTranscript(db, selected, rootEventId);
  if (resolved.strategy === "all" && transcript.length > ALL_FALLBACK_BYTES) {
    resolved = { strategy: "first_last", params: { first_k: 5, last_k: 10 } };
    selected = selectEvents(events, resolved);
    transcript = renderTranscript(db, selected, rootEventId);
  }

  const result = await summarizeTranscript(cfg, transcript);
  if (!result.text) {
    throw new Error("LLM returned empty summary");
  }

  const last = events[events.length - 1]!;
  const paramsJson = JSON.stringify(resolved.params);
  db.query(
    `INSERT INTO thread_summaries (
        root_event_id, summary, model, strategy, strategy_params_json,
        prompt_version, covered_last_event_id, covered_event_count,
        created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?,
             strftime('%Y-%m-%dT%H:%M:%fZ','now'),
             strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(root_event_id) DO UPDATE SET
       summary = excluded.summary,
       model = excluded.model,
       strategy = excluded.strategy,
       strategy_params_json = excluded.strategy_params_json,
       prompt_version = excluded.prompt_version,
       covered_last_event_id = excluded.covered_last_event_id,
       covered_event_count = excluded.covered_event_count,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
  ).run(
    rootEventId,
    result.text,
    result.model,
    resolved.strategy,
    paramsJson,
    PROMPT_VERSION,
    last.event_id,
    events.length,
  );
  return getCachedSummary(db, rootEventId)!;
}

// ─── Worker ───────────────────────────────────────────────────────────────

interface WorkerConfig {
  pollIntervalMs: number;
  coldAfterMs: number;
  minReplies: number;
  batchSize: number;
}

function workerConfigFromEnv(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return {
    pollIntervalMs: positiveInt(env.SYNCHRONIZE_SUMMARY_POLL_INTERVAL_MS, 15 * 60 * 1000),
    coldAfterMs: positiveInt(env.SYNCHRONIZE_SUMMARY_COLD_AFTER_MS, 30 * 60 * 1000),
    minReplies: positiveInt(env.SYNCHRONIZE_SUMMARY_MIN_REPLIES, 3),
    batchSize: positiveInt(env.SYNCHRONIZE_SUMMARY_BATCH_SIZE, 10),
  };
}

export interface WorkerHandle {
  stop(): void;
  /** Run one tick synchronously (test/dev helper). */
  tick(): Promise<{ summarized: number; skipped: number; errors: number }>;
}

const ERROR_BACKOFF_MS = 30 * 60 * 1000;

function pickEligible(
  db: Database,
  wcfg: WorkerConfig,
  now: number,
  inFlight: Set<number>,
  errorBackoff: Map<number, number>,
): DiscoverableThreadRow[] {
  const cutoffIso = new Date(now - wcfg.coldAfterMs).toISOString();
  const rows = db
    .query<DiscoverableThreadRow, [string, number, number, number]>(
      `SELECT dt.root_event_id, dt.group_name, dt.reply_count, dt.last_event_id, dt.last_activity_at
       FROM discoverable_threads dt
       LEFT JOIN thread_summaries ts ON ts.root_event_id = dt.root_event_id
       WHERE dt.last_activity_at <= ?
         AND dt.reply_count >= ?
         AND (
           ts.root_event_id IS NULL
           OR ts.covered_last_event_id < dt.last_event_id
           OR ts.prompt_version < ?
         )
       ORDER BY dt.last_activity_at DESC
       LIMIT ?`,
    )
    .all(cutoffIso, wcfg.minReplies, PROMPT_VERSION, wcfg.batchSize * 4);
  // Filter in-memory state out — keeps the SQL portable across SQLite versions
  // and is cheap given the small batch fanout.
  const out: DiscoverableThreadRow[] = [];
  for (const r of rows) {
    if (inFlight.has(r.root_event_id)) continue;
    const backoffUntil = errorBackoff.get(r.root_event_id);
    if (backoffUntil && backoffUntil > now) continue;
    out.push(r);
    if (out.length >= wcfg.batchSize) break;
  }
  return out;
}

export function startSummarizeWorker(db: Database, env: NodeJS.ProcessEnv = process.env): WorkerHandle {
  const wcfg = workerConfigFromEnv(env);
  const inFlight = new Set<number>();
  const errorBackoff = new Map<number, number>();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function runTick(): Promise<{ summarized: number; skipped: number; errors: number }> {
    const cfg = resolveProviderConfig(env);
    if (!cfg) return { summarized: 0, skipped: 0, errors: 0 };
    const now = Date.now();
    const eligible = pickEligible(db, wcfg, now, inFlight, errorBackoff);
    let summarized = 0;
    let errors = 0;
    for (const t of eligible) {
      if (stopped) break;
      inFlight.add(t.root_event_id);
      try {
        await summarizeThread(db, cfg, t.root_event_id);
        summarized++;
        errorBackoff.delete(t.root_event_id);
        console.error(
          `[summarize] root=${t.root_event_id} group=${t.group_name} replies=${t.reply_count} ok`,
        );
      } catch (err) {
        errors++;
        errorBackoff.set(t.root_event_id, Date.now() + ERROR_BACKOFF_MS);
        console.error(
          `[summarize] root=${t.root_event_id} error: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        inFlight.delete(t.root_event_id);
      }
    }
    return { summarized, skipped: 0, errors };
  }

  function schedule(): void {
    if (stopped) return;
    timer = setTimeout(async () => {
      try {
        await runTick();
      } catch (err) {
        console.error(`[summarize] worker tick crashed: ${err instanceof Error ? err.message : String(err)}`);
      }
      schedule();
    }, wcfg.pollIntervalMs);
    // Don't keep the event loop alive just to summarize — the daemon's HTTP
    // server is the foreground process.
    (timer as { unref?: () => void }).unref?.();
  }

  schedule();

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
    tick: runTick,
  };
}

// ─── Public helpers for routes ────────────────────────────────────────────

export function isEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveProviderConfig(env) !== null;
}

export function strategyFromInput(input: {
  strategy?: string | undefined;
  k?: number | undefined;
  first_k?: number | undefined;
  last_k?: number | undefined;
}): ResolvedStrategy {
  const s = (input.strategy ?? "first_k").toLowerCase() as Strategy;
  if (s === "all") return { strategy: "all", params: {} };
  if (s === "first_last") {
    return { strategy: "first_last", params: { first_k: input.first_k ?? 5, last_k: input.last_k ?? 10 } };
  }
  if (s === "last_k") return { strategy: "last_k", params: { k: input.k ?? 3 } };
  return { strategy: "first_k", params: { k: input.k ?? 3 } };
}
