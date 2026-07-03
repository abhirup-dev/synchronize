// v0 annotation query layer. An engine-neutral AnnotationQuery spec compiled to
// SQLite. The query contract is the foundation: when a content/vector index
// arrives, only the "hits" selection changes; the window expansion and the spec
// stay identical. See session-tracker/plan-unified-session-annotation-v0.md.

import type { Database } from "bun:sqlite";

// Columns a `where` clause may target. This allowlist is the injection boundary
// — `field` is interpolated into SQL, so it MUST be validated against this set;
// values are always bound as parameters.
export const ALLOWED_FIELDS = new Set([
  "category", "kind", "record_type", "role", "uuid", "parent_uuid",
  "tool", "normalized_tool", "tool_call_id", "tool_server", "source",
  "is_error", "summary", "text", "seq", "turn_index", "ts_ms",
  "line_number", "content_index",
]);

export interface WhereClause {
  field: string;
  op: "eq" | "like";
  value: string | number;
}

export interface AnnotationQuery {
  session?: string; // session_id | alias | binding_id
  where?: WhereClause[];
  window?: number; // ±N rows (by seq) around each match
  limit?: number;
}

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 5000;

export interface AnnotationRow extends Record<string, unknown> {
  binding_id: string;
  seq: number;
  hit_seq?: number;
}

export interface AnnotationQueryResult {
  rows: AnnotationRow[];
  windowed: boolean;
}

// Resolve a session selector to a binding_id. Accepts a binding_id, a
// host_session_id, or a peer session_name (alias). Returns null if unresolved.
export function resolveBinding(db: Database, selector: string): string | null {
  const direct = db
    .query<{ binding_id: string }, [string]>(
      "SELECT binding_id FROM agent_sessions WHERE binding_id = ?1 OR host_session_id = ?1 LIMIT 1",
    )
    .get(selector);
  if (direct) return direct.binding_id;
  const byName = db
    .query<{ binding_id: string }, [string]>(
      `SELECT a.binding_id FROM agent_sessions a
       JOIN peers p ON p.peer_id = a.peer_id
       WHERE p.session_name = ?1
       ORDER BY a.last_seen_at DESC LIMIT 1`,
    )
    .get(selector);
  return byName?.binding_id ?? null;
}

class QueryError extends Error {}
export { QueryError };

function buildPredicate(spec: AnnotationQuery, db: Database): { sql: string; params: Array<string | number> } {
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  if (spec.session) {
    const binding = resolveBinding(db, spec.session);
    if (!binding) throw new QueryError(`session not found: ${spec.session}`);
    clauses.push("binding_id = ?");
    params.push(binding);
  }

  for (const w of spec.where ?? []) {
    if (!ALLOWED_FIELDS.has(w.field)) throw new QueryError(`field not allowed: ${w.field}`);
    if (w.op === "eq") {
      clauses.push(`${w.field} = ?`);
      params.push(w.value);
    } else if (w.op === "like") {
      clauses.push(`${w.field} LIKE ?`);
      params.push(String(w.value));
    } else {
      throw new QueryError(`op not allowed: ${(w as WhereClause).op}`);
    }
  }

  const sql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return { sql, params };
}

export function runAnnotationQuery(db: Database, spec: AnnotationQuery): AnnotationQueryResult {
  const limit = Math.min(Math.max(spec.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const { sql: where, params } = buildPredicate(spec, db);

  if (spec.window === undefined || spec.window === null) {
    const rows = db
      .query<AnnotationRow, (string | number)[]>(
        `SELECT * FROM session_annotations ${where} ORDER BY binding_id, seq LIMIT ?`,
      )
      .all(...params, limit) as AnnotationRow[];
    return { rows, windowed: false };
  }

  const n = spec.window;
  if (!Number.isInteger(n) || n < 0 || n > 1000) throw new QueryError("window must be an integer in [0,1000]");
  // Hits are capped by `limit`; each hit expands to up to 2N+1 rows. hit_seq
  // marks the matched centre so callers can group windows.
  const rows = db
    .query<AnnotationRow, (string | number)[]>(
      `WITH hits AS (
         SELECT binding_id, seq FROM session_annotations ${where}
         ORDER BY binding_id, seq LIMIT ?
       )
       SELECT a.*, h.seq AS hit_seq
       FROM hits h
       JOIN session_annotations a
         ON a.binding_id = h.binding_id AND a.seq BETWEEN h.seq - ? AND h.seq + ?
       ORDER BY h.binding_id, h.seq, a.seq`,
    )
    .all(...params, limit, n, n) as AnnotationRow[];
  return { rows, windowed: true };
}
