import { queryEvents } from "../../api/query.ts";
import type { SqlParam } from "../../api/types.ts";
import { ensureDaemon } from "../../client.ts";
import { parseFlags } from "../flags.ts";
import { table } from "../render/table.ts";

export async function run(argv: string[]): Promise<void> {
  const args = parseFlags(argv);
  const sql = args.rest.join(" ").trim();
  if (!sql) throw new Error("query requires SQL");
  const format = args.flags.format ?? "json";
  if (format !== "json" && format !== "table" && format !== "csv") {
    throw new Error("--format must be json, table, or csv");
  }
  const limit = args.flags.limit ? Number.parseInt(args.flags.limit, 10) : undefined;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error("--limit must be a positive integer");
  }
  const params = args.flags.params ? parseParams(args.flags.params) : undefined;
  const client = await ensureDaemon();
  const response = await queryEvents(client, { sql, ...(params ? { params } : {}), ...(limit ? { limit } : {}) });
  if (format === "json") {
    console.log(JSON.stringify(response, null, 2));
    return;
  }
  const rows = response.rows.map((row) => response.columns.map((column) => formatCell(row[column])));
  if (format === "table") {
    console.log(table(response.columns, rows));
    return;
  }
  console.log([response.columns.map(csvCell).join(","), ...rows.map((row) => row.map(csvCell).join(","))].join("\n"));
}

function parseParams(raw: string): SqlParam[] {
  const parsed = JSON.parse(raw) as unknown;
  if (
    !Array.isArray(parsed) ||
    parsed.some((item) => item !== null && typeof item !== "string" && typeof item !== "number" && typeof item !== "boolean")
  ) {
    throw new Error("--params must be a JSON array of strings, numbers, booleans, or nulls");
  }
  return parsed as SqlParam[];
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function csvCell(value: string): string {
  if (!/[",\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}
