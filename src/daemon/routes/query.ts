import { jsonResponse } from "../../http.ts";
import { runEventQuery } from "../../query/events.ts";
import type { DaemonContext } from "../server.ts";
import { optionalInteger, optionalSqlParams, readBody, requireString } from "../validation.ts";

export async function tryHandleQueryRoute(request: Request, ctx: DaemonContext, url: URL): Promise<Response | null> {
  if (request.method === "POST" && url.pathname === "/query/events") {
    const body = await readBody(request);
    const sql = requireString(body, "sql");
    const params = optionalSqlParams(body, "params");
    const limit = optionalInteger(body, "limit");
    return jsonResponse(runEventQuery(ctx.db, { sql, ...(params ? { params } : {}), ...(limit !== undefined ? { limit } : {}) }));
  }

  return null;
}
