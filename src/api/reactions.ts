import { requestJson, type ClientConfig } from "../client.ts";
import type { Event, ReactionSummary } from "./types.ts";

export type ReactionOp = "add" | "remove" | "toggle";

export interface ReactToEventResponse {
  event: Event;
  reactions: ReactionSummary[];
  changed: boolean;
  active: boolean;
}

export function reactToEvent(
  client: ClientConfig,
  input: { eventId: number; peerId: string; emoji: string; op?: ReactionOp },
): Promise<ReactToEventResponse> {
  return requestJson<ReactToEventResponse>(client, `/events/${input.eventId}/reactions`, {
    method: "POST",
    body: JSON.stringify({
      peer_id: input.peerId,
      emoji: input.emoji,
      ...(input.op ? { op: input.op } : {}),
    }),
  });
}

export function listEventReactions(
  client: ClientConfig,
  input: { eventId: number; peerId: string },
): Promise<{ event: Event; reactions: ReactionSummary[] }> {
  const params = new URLSearchParams({ peer_id: input.peerId });
  return requestJson<{ event: Event; reactions: ReactionSummary[] }>(
    client,
    `/events/${input.eventId}/reactions?${params.toString()}`,
  );
}
