import { requestJson, type ClientConfig } from "../client.ts";
import type { Event, EventSubscriptionRegistration } from "./types.ts";

export function getEvent(
  client: ClientConfig,
  input: { eventId: number; peerId: string },
): Promise<{ event: Event }> {
  const params = new URLSearchParams({ peer_id: input.peerId });
  return requestJson<{ event: Event }>(client, `/events/${input.eventId}?${params.toString()}`);
}

export function readEvents(
  client: ClientConfig,
  peerId: string,
  input: { cursor?: number; limit?: number } = {},
): Promise<{ events: Event[]; next_cursor: number }> {
  const params = new URLSearchParams();
  if (input.cursor !== undefined) params.set("cursor", String(input.cursor));
  if (input.limit !== undefined) params.set("limit", String(input.limit));
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return requestJson<{ events: Event[]; next_cursor: number }>(client, `/events/${encodeURIComponent(peerId)}${query}`);
}

export function subscribeToEvents(
  client: ClientConfig,
  input: { peerId: string; callbackUrl: string; token: string },
): Promise<{ subscription: EventSubscriptionRegistration }> {
  return requestJson<{ subscription: EventSubscriptionRegistration }>(client, "/subscriptions", {
    method: "POST",
    body: JSON.stringify({
      peer_id: input.peerId,
      callback_url: input.callbackUrl,
      token: input.token,
    }),
  });
}
