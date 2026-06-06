import { HttpError, jsonResponse } from "../../http.ts";
import { resolveProviderConfig } from "../../llm/index.ts";
import {
  defaultStrategyFromEnv,
  isEnabled as isSummarizeEnabled,
  loadSummaryResponse,
  makeProviderCaller,
  strategyFromInput,
  summarizeThread,
} from "../../summarize/index.ts";
import { parseSelectorsFromUrl, selectThreadEvents } from "../selectors.ts";
import {
  attachReactions,
  getEvent,
  getThreadStatus,
  listThreadDiscoveries,
  loadThreadSummaryProjection,
  renderThreadTranscript,
  type DaemonContext,
  type EventRow,
} from "../server.ts";
import { optionalInteger, optionalString, parseThreadFormat, readBody } from "../validation.ts";

export async function tryHandleThreadsRoute(request: Request, ctx: DaemonContext, url: URL): Promise<Response | null> {
  if (request.method === "GET" && url.pathname === "/threads") {
    return jsonResponse({ threads: listThreadDiscoveries(ctx.db, url) });
  }

  const threadStatusGet = url.pathname.match(/^\/threads\/(\d+)\/status$/);
  if (request.method === "GET" && threadStatusGet) {
    return jsonResponse({ status: getThreadStatus(ctx.db, Number(threadStatusGet[1])) });
  }

  // GET /threads/:root/summary — cached read. Returns status="disabled" when
  // no LLM provider is configured (no OPENROUTER_API_KEY), "pending" when
  // enabled but no row yet, "ready" otherwise. `stale` flag tells the caller
  // whether new events have landed since the cached summary was written.
  const threadSummaryGet = url.pathname.match(/^\/threads\/(\d+)\/summary$/);
  if (request.method === "GET" && threadSummaryGet) {
    const rootEventId = Number(threadSummaryGet[1]);
    return jsonResponse(loadSummaryResponse(ctx.db, rootEventId, isSummarizeEnabled(), defaultStrategyFromEnv()));
  }

  // POST /threads/:root/summary — force regen. Bypasses cold-gate and
  // min-replies (worker-side guards only). 503 if disabled.
  if (request.method === "POST" && threadSummaryGet) {
    const rootEventId = Number(threadSummaryGet[1]);
    const cfg = resolveProviderConfig();
    if (!cfg) {
      throw new HttpError(503, "summarize_disabled", "thread summaries are not configured (set OPENROUTER_API_KEY)");
    }
    const body = await readBody(request).catch(() => ({}));
    const strategy = strategyFromInput({
      strategy: optionalString(body, "strategy"),
      k: optionalInteger(body, "k"),
      first_k: optionalInteger(body, "first_k"),
      last_k: optionalInteger(body, "last_k"),
    });
    await summarizeThread(ctx.db, makeProviderCaller(cfg), rootEventId, { strategy });
    return jsonResponse(loadSummaryResponse(ctx.db, rootEventId, true, strategy));
  }

  // GET /threads/:root_event_id — canonical one-thread reader. Projection is
  // selected by `format`; event-bearing formats are bounded by selectors so
  // the default path stays context-light.
  const threadGet = url.pathname.match(/^\/threads\/(\d+)$/);
  if (request.method === "GET" && threadGet) {
    const rootEventId = Number(threadGet[1]);
    const format = parseThreadFormat(url.searchParams.get("format"));
    const selectors = parseSelectorsFromUrl(url);
    if (format === "summary") {
      return jsonResponse(await loadThreadSummaryProjection(ctx, rootEventId, selectors));
    }
    const root = getEvent(ctx.db, rootEventId);
    if (root.group_id === null) {
      throw new HttpError(400, "thread_of_not_root", `Event ${rootEventId} is a DM, not a group thread root`);
    }
    if (root.parent_event_id !== null) {
      throw new HttpError(400, "thread_of_not_root", `Event ${rootEventId} is itself a reply; pass the root event_id`);
    }
    const peerId = url.searchParams.get("peer_id");
    if (peerId) {
      const member = ctx.db
        .query<{ history_from_event_id: number | null }, [number, string]>(
          "SELECT history_from_event_id FROM group_members WHERE group_id = ? AND peer_id = ?",
        )
        .get(root.group_id, peerId);
      if (!member) throw new HttpError(404, "thread_not_visible", `Thread ${rootEventId} is not visible to peer ${peerId}`);
      if (rootEventId < (member.history_from_event_id ?? 0)) {
        throw new HttpError(404, "thread_not_visible", `Thread ${rootEventId} is before peer's history_from boundary`);
      }
    }
    const replies = attachReactions(ctx.db, ctx.db
      .query<EventRow, [number, number]>(
        `SELECT e.*, g.name AS group_name
         FROM events e
         LEFT JOIN groups g ON g.group_id = e.group_id
         WHERE e.group_id = ? AND e.parent_event_id = ?
         ORDER BY e.event_id ASC`,
      )
      .all(root.group_id, rootEventId));
    const events = [root, ...replies];
    const status = getThreadStatus(ctx.db, rootEventId);
    if (format === "status") {
      return jsonResponse({ format, status });
    }
    const selected = selectThreadEvents(events, selectors);
    const base = {
      format,
      selectors,
      status,
      selected_event_count: selected.events.length,
      total_event_count: events.length,
      truncated: selected.truncated,
    };
    if (format === "events") {
      return jsonResponse({ ...base, events: selected.events });
    }
    return jsonResponse({
      ...base,
      transcript: renderThreadTranscript(ctx.db, selected.events),
    });
  }

  return null;
}
