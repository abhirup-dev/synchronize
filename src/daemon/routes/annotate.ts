import { jsonResponse } from "../../http.ts";
import { annotateSession } from "../../annotate/index.ts";
import { resolveBinding } from "../../annotate/query.ts";
import { HttpError } from "../../http.ts";
import type { DaemonContext } from "../server.ts";
import { readBody, requireString } from "../validation.ts";

// POST /annotate { session } → (re)parse the session transcript into the lake.
// `session` is a binding_id, host_session_id, or peer alias.
export async function tryHandleAnnotateRoute(
  request: Request,
  ctx: DaemonContext,
  url: URL,
): Promise<Response | null> {
  if (request.method === "POST" && url.pathname === "/annotate") {
    const body = await readBody(request);
    const selector = requireString(body, "session");
    const binding = resolveBinding(ctx.db, selector) ?? selector;
    try {
      const result = await annotateSession(ctx.db, binding);
      return jsonResponse(result, { status: 201 });
    } catch (err) {
      throw new HttpError(400, "annotate_failed", err instanceof Error ? err.message : String(err));
    }
  }
  return null;
}
