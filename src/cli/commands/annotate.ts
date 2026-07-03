import { annotateSession, queryAnnotations } from "../../api/annotations.ts";
import type { AnnotationQuery, WhereClause } from "../../annotate/query.ts";
import { ensureDaemon } from "../../client.ts";
import { parseFlags } from "../flags.ts";
import { table } from "../render/table.ts";

// synchronize annotate <session>            → ingest a transcript into the lake
// synchronize annotate query [predicates]   → query the lake
//   predicates are tokens: field=value (exact) or field~value (LIKE substring)
//   flags: --session <sel> --window <N> --limit <N> --format json|table
export async function run(argv: string[]): Promise<void> {
  if (argv[0] === "query") {
    await runQuery(argv.slice(1));
    return;
  }
  const session = argv.find((a) => !a.startsWith("--"));
  if (!session) throw new Error("usage: synchronize annotate <session> | synchronize annotate query …");
  const client = await ensureDaemon();
  const result = await annotateSession(client, { session });
  console.log(
    `annotated ${result.bindingId} (${result.hostTool}): ${result.annotationCount} annotations from ` +
      `${result.parsedLines} lines, ${result.diagnosticsCount} diagnostics`,
  );
  console.log(`  by category: ${JSON.stringify(result.byCategory)}`);
  console.log(`  top tools:   ${JSON.stringify(result.byTool)}`);
}

async function runQuery(argv: string[]): Promise<void> {
  const args = parseFlags(argv);
  const where: WhereClause[] = [];
  for (const token of args.rest) {
    const tilde = token.indexOf("~");
    const eq = token.indexOf("=");
    if (tilde >= 0 && (eq < 0 || tilde < eq)) {
      where.push({ field: token.slice(0, tilde), op: "like", value: token.slice(tilde + 1) });
    } else if (eq >= 0) {
      where.push({ field: token.slice(0, eq), op: "eq", value: token.slice(eq + 1) });
    } else {
      throw new Error(`predicate must be field=value or field~value, got: ${token}`);
    }
  }

  const spec: AnnotationQuery = {};
  if (args.flags.session) spec.session = args.flags.session;
  if (where.length) spec.where = where;
  if (args.flags.window !== undefined) {
    const n = Number.parseInt(args.flags.window, 10);
    if (!Number.isInteger(n) || n < 0) throw new Error("--window must be a non-negative integer");
    spec.window = n;
  }
  if (args.flags.limit !== undefined) {
    const n = Number.parseInt(args.flags.limit, 10);
    if (!Number.isInteger(n) || n < 1) throw new Error("--limit must be a positive integer");
    spec.limit = n;
  }

  const format = args.flags.format ?? "table";
  if (format !== "json" && format !== "table") throw new Error("--format must be json or table");

  const client = await ensureDaemon();
  const result = await queryAnnotations(client, spec);

  if (format === "json") {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (result.rows.length === 0) {
    console.log("(no matches)");
    return;
  }
  const cols = result.windowed
    ? ["hit_seq", "seq", "turn_index", "category", "kind", "tool", "normalized_tool", "summary"]
    : ["seq", "turn_index", "category", "kind", "tool", "normalized_tool", "summary"];
  const rows = result.rows.map((row) => cols.map((c) => formatCell(row[c])));
  console.log(table(cols, rows));
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
