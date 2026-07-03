import { HttpError } from "../http.ts";
import { requireAuth } from "./auth.ts";
import type { DaemonContext } from "./server.ts";
import { tryHandleActivityRoute } from "./routes/activity.ts";
import { tryHandleAgentSessionsRoute } from "./routes/agent-sessions.ts";
import { tryHandleAnnotateRoute } from "./routes/annotate.ts";
import { tryHandleArchiveRoute } from "./routes/archive.ts";
import { tryHandleEventLookupRoute, tryHandleEventPullRoute } from "./routes/events.ts";
import { tryHandleGroupsRoute } from "./routes/groups.ts";
import { tryHandleHealthRoute } from "./routes/health.ts";
import { tryHandleInboxRoute } from "./routes/inbox.ts";
import { tryHandleMediaRoute } from "./routes/media.ts";
import { tryHandleMessagingRoute } from "./routes/messaging.ts";
import { tryHandlePeersRoute } from "./routes/peers.ts";
import { tryHandleQueryRoute } from "./routes/query.ts";
import { tryHandleReactionsRoute } from "./routes/reactions.ts";
import { tryHandleStatusRoute } from "./routes/status.ts";
import { tryHandleSubscriptionsRoute } from "./routes/subscriptions.ts";
import { tryHandleThreadsRoute } from "./routes/threads.ts";
import { tryHandleWebRoute } from "./routes/web.ts";

export async function route(request: Request, ctx: DaemonContext): Promise<Response> {
  const url = new URL(request.url);
  const healthResponse = tryHandleHealthRoute(request, ctx, url);
  if (healthResponse) return healthResponse;

  const webResponse = await tryHandleWebRoute(request, ctx, url);
  if (webResponse) return webResponse;

  requireAuth(request, ctx);

  const statusResponse = tryHandleStatusRoute(request, ctx, url);
  if (statusResponse) return statusResponse;

  const agentSessionsResponse = await tryHandleAgentSessionsRoute(request, ctx, url);
  if (agentSessionsResponse) return agentSessionsResponse;

  const archiveResponse = await tryHandleArchiveRoute(request, ctx, url);
  if (archiveResponse) return archiveResponse;

  const peersResponse = await tryHandlePeersRoute(request, ctx, url);
  if (peersResponse) return peersResponse;

  const subscriptionsResponse = await tryHandleSubscriptionsRoute(request, ctx, url);
  if (subscriptionsResponse) return subscriptionsResponse;

  const queryResponse = await tryHandleQueryRoute(request, ctx, url);
  if (queryResponse) return queryResponse;

  const annotateResponse = await tryHandleAnnotateRoute(request, ctx, url);
  if (annotateResponse) return annotateResponse;

  const messagingResponse = await tryHandleMessagingRoute(request, ctx, url);
  if (messagingResponse) return messagingResponse;

  const groupsResponse = await tryHandleGroupsRoute(request, ctx, url);
  if (groupsResponse) return groupsResponse;

  const eventLookupResponse = tryHandleEventLookupRoute(request, ctx, url);
  if (eventLookupResponse) return eventLookupResponse;

  const reactionsResponse = await tryHandleReactionsRoute(request, ctx, url);
  if (reactionsResponse) return reactionsResponse;

  const threadsResponse = await tryHandleThreadsRoute(request, ctx, url);
  if (threadsResponse) return threadsResponse;

  const mediaResponse = await tryHandleMediaRoute(request, ctx, url);
  if (mediaResponse) return mediaResponse;

  const inboxResponse = await tryHandleInboxRoute(request, ctx, url);
  if (inboxResponse) return inboxResponse;

  // Read-only global Activity feed for the web UI. The web user is an OBSERVER:
  // it sees every group's events (mirroring readWebRoomEvents' group visibility)
  // but only its OWN DMs — private agent↔agent DMs must not leak. Awaiting is a
  // thread-interaction projection: agent-authored group messages after the
  // observer's last reply/reaction/handled marker in that thread. Durable inbox
  // rows remain the notification fallback, not the Activity feed's spine.
  //
  // Unlike GET /peers/:id/inbox and GET /events/:id, this endpoint has NO side
  // effects: it never advances delivery/read state or the peer's last_cursor.
  // That keeps the shared single web peer (all of a human's browsers resolve to
  // web:local-human) free of cross-device cursor contention. Newest-first with a
  // `before` cursor for load-older; `filter=awaiting` keeps only projected
  // awaiting items.
  const activityResponse = tryHandleActivityRoute(request, ctx, url);
  if (activityResponse) return activityResponse;

  const eventPullResponse = tryHandleEventPullRoute(request, ctx, url);
  if (eventPullResponse) return eventPullResponse;

  throw new HttpError(404, "not_found", `${request.method} ${url.pathname} is not implemented`);
}
