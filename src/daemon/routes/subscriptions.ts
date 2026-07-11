import { HttpError, jsonResponse } from "../../http.ts";
import { isPeerArchived } from "../repo/archive.ts";
import { ensurePeer } from "../repo/peers.ts";
import { log, type DaemonContext } from "../server.ts";
import { readBody, requireLocalCallbackUrl, requireString } from "../validation.ts";

export async function tryHandleSubscriptionsRoute(request: Request, ctx: DaemonContext, url: URL): Promise<Response | null> {
  if (request.method === "POST" && url.pathname === "/subscriptions") {
    const body = await readBody(request);
    const peerId = requireString(body, "peer_id");
    const callbackUrl = requireLocalCallbackUrl(requireString(body, "callback_url"));
    const token = requireString(body, "token");
    ensurePeer(ctx.db, peerId);
    if (isPeerArchived(ctx.db, peerId)) {
      throw new HttpError(409, "must_reregister", "This identity is archived. Re-register before subscribing.");
    }
    const subscriber = {
      peer_id: peerId,
      callback_url: callbackUrl,
      token,
      created_at: new Date().toISOString(),
    };
    ctx.subscribers.set(peerId, subscriber);
    log(`subscription registered peer_id=${peerId} callback_url=${callbackUrl}`);
    return jsonResponse({ subscription: subscriber }, { status: 201 });
  }

  return null;
}
