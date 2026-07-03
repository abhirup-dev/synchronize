import { HttpError, jsonResponse } from "../../http.ts";
import { runEventQuery } from "../../query/events.ts";
import { QueryError, runAnnotationQuery, type AnnotationQuery, type WhereClause } from "../../annotate/query.ts";
import type { DaemonContext } from "../server.ts";
import { optionalInteger, optionalSqlParams, optionalString, readBody, requireString } from "../validation.ts";

export async function tryHandleQueryRoute(request: Request, ctx: DaemonContext, url: URL): Promise<Response | null> {
  if (request.method === "POST" && url.pathname === "/query/events") {
    const body = await readBody(request);
    const sql = requireString(body, "sql");
    const params = optionalSqlParams(body, "params");
    const limit = optionalInteger(body, "limit");
    return jsonResponse(runEventQuery(ctx.db, { sql, ...(params ? { params } : {}), ...(limit !== undefined ? { limit } : {}) }));
  }

  if (request.method === "POST" && url.pathname === "/query/annotations") {
    const body = await readBody(request);
    const spec = parseAnnotationQuery(body);
    try {
      return jsonResponse(runAnnotationQuery(ctx.db, spec));
    } catch (err) {
      if (err instanceof QueryError) throw new HttpError(400, "invalid_query", err.message);
      throw err;
    }
  }

  return null;
}

function parseAnnotationQuery(body: Record<string, unknown>): AnnotationQuery {
  const spec: AnnotationQuery = {};
  const session = optionalString(body, "session");
  if (session) spec.session = session;
  const window = optionalInteger(body, "window");
  if (window !== undefined) spec.window = window;
  const limit = optionalInteger(body, "limit");
  if (limit !== undefined) spec.limit = limit;

  const where = body["where"];
  if (where !== undefined && where !== null) {
    if (!Array.isArray(where)) throw new HttpError(400, "invalid_request", "where must be an array");
    spec.where = where.map((item, i): WhereClause => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new HttpError(400, "invalid_request", `where[${i}] must be an object`);
      }
      const o = item as Record<string, unknown>;
      const field = o["field"];
      const op = o["op"];
      const value = o["value"];
      if (typeof field !== "string") throw new HttpError(400, "invalid_request", `where[${i}].field must be a string`);
      if (op !== "eq" && op !== "like") throw new HttpError(400, "invalid_request", `where[${i}].op must be eq or like`);
      if (typeof value !== "string" && typeof value !== "number") {
        throw new HttpError(400, "invalid_request", `where[${i}].value must be a string or number`);
      }
      return { field, op, value };
    });
  }
  return spec;
}
