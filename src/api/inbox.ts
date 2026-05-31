import { requestJson, type ClientConfig } from "../client.ts";
import type { Event } from "./types.ts";

export function readInbox(client: ClientConfig, peerId: string): Promise<{ events: Event[]; next_cursor: number }> {
  return requestJson<{ events: Event[]; next_cursor: number }>(client, `/peers/${encodeURIComponent(peerId)}/inbox`);
}

export function ackInbox(client: ClientConfig, peerId: string, eventIds?: number[]): Promise<{ ok: boolean; acked: number }> {
  return requestJson<{ ok: boolean; acked: number }>(client, `/peers/${encodeURIComponent(peerId)}/inbox/ack`, {
    method: "POST",
    body: JSON.stringify(eventIds ? { event_ids: eventIds } : {}),
  });
}

export function sendDm(
  client: ClientConfig,
  input: { senderPeerId: string; recipientPeerId: string; message: string },
): Promise<{ event: Event }> {
  return requestJson<{ event: Event }>(client, "/dm", {
    method: "POST",
    body: JSON.stringify({
      sender_peer_id: input.senderPeerId,
      recipient_peer_id: input.recipientPeerId,
      message: input.message,
    }),
  });
}
