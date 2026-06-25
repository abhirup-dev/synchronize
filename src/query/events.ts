import type { Database } from "bun:sqlite";
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "../constants.ts";
import { HttpError } from "../http.ts";
import type { EventQueryResponse, SqlParam } from "../api/types.ts";

const FORBIDDEN_TOKENS = [
  "insert",
  "update",
  "delete",
  "drop",
  "alter",
  "create",
  "replace",
  "pragma",
  "attach",
  "detach",
  "vacuum",
  "reindex",
];

export interface RunEventQueryInput {
  sql: string;
  params?: SqlParam[];
  limit?: number;
}

export function runEventQuery(db: Database, input: RunEventQueryInput): EventQueryResponse {
  const sql = normalizeReadOnlySql(input.sql);
  const params = input.params ?? [];
  const limit = parseQueryLimit(input.limit);
  const started = performance.now();
  const statement = db.query<Record<string, unknown>, SqlParam[]>(
    `SELECT * FROM (${sql}) AS synchronize_query LIMIT ?`,
  );
  const rows = statement.all(...params, limit + 1);
  const elapsedMs = Math.round((performance.now() - started) * 1000) / 1000;
  const truncated = rows.length > limit;
  return {
    columns: statement.columnNames,
    rows: truncated ? rows.slice(0, limit) : rows,
    row_count: Math.min(rows.length, limit),
    truncated,
    elapsed_ms: elapsedMs,
  };
}

function parseQueryLimit(raw: number | undefined): number {
  if (raw === undefined) return DEFAULT_PAGE_LIMIT;
  if (!Number.isInteger(raw) || raw < 1) {
    throw new HttpError(400, "invalid_request", "limit must be a positive integer");
  }
  return Math.min(raw, MAX_PAGE_LIMIT);
}

function normalizeReadOnlySql(raw: string): string {
  const sql = raw.trim();
  if (sql.length === 0) {
    throw new HttpError(400, "invalid_sql", "sql must not be empty");
  }
  const scrubbed = scrubSql(sql);
  const withoutTrailingSemicolons = scrubbed.replace(/;\s*$/g, "");
  if (withoutTrailingSemicolons.includes(";")) {
    throw new HttpError(400, "invalid_sql", "multiple SQL statements are not allowed");
  }
  const lowered = withoutTrailingSemicolons.trim().toLowerCase();
  if (!/^(select|with)\b/.test(lowered)) {
    throw new HttpError(400, "invalid_sql", "only SELECT and WITH queries are allowed");
  }
  for (const token of FORBIDDEN_TOKENS) {
    if (new RegExp(`\\b${token}\\b`, "i").test(lowered)) {
      throw new HttpError(400, "invalid_sql", `${token.toUpperCase()} is not allowed in event queries`);
    }
  }
  return sql.replace(/;\s*$/g, "");
}

function scrubSql(sql: string): string {
  let out = "";
  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    const next = sql[i + 1];
    if (char === "'" || char === '"') {
      const quote = char;
      out += " ";
      i += 1;
      while (i < sql.length) {
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) {
            i += 2;
            continue;
          }
          break;
        }
        i += 1;
      }
      out += " ";
      continue;
    }
    if (char === "-" && next === "-") {
      out += " ";
      i += 2;
      while (i < sql.length && sql[i] !== "\n") i += 1;
      out += " ";
      continue;
    }
    if (char === "/" && next === "*") {
      out += " ";
      i += 2;
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) i += 1;
      i += 1;
      out += " ";
      continue;
    }
    out += char;
  }
  return out;
}
