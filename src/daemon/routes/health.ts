import { API_VERSION } from "../../constants.ts";
import { jsonResponse } from "../../http.ts";
import type { DaemonContext } from "../server.ts";

export function tryHandleHealthRoute(request: Request, ctx: DaemonContext, url: URL): Response | null {
  if (request.method === "GET" && url.pathname === "/health") {
    return jsonResponse({
      ok: true,
      service: "synchronize",
      api_version: API_VERSION,
      capabilities: [
        "peers",
        "dm",
        "inbox",
        "groups",
        "events",
        "event_subscriptions",
        "media",
        "summary",
        "skill_catalog",
      ],
      pid: process.pid,
      started_at: ctx.startedAt,
      provenance: ctx.provenance,
    });
  }

  return null;
}
