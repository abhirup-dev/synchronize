import { Database } from "bun:sqlite";

import { eventForRecipient, type EventRow } from "../repo/events.ts";

export interface EventSubscriber {
  peer_id: string;
  callback_url: string;
  token: string;
  created_at: string;
}

function log(message: string): void {
  console.error(`[synchronize-daemon] ${message}`);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function notifySubscribers(
  ctx: { db: Database; subscribers: Map<string, EventSubscriber> },
  peerIds: string[],
  event: EventRow,
): Promise<void> {
  await Promise.all(
    peerIds.map(async (peerId) => {
      const subscriber = ctx.subscribers.get(peerId);
      if (!subscriber) {
        log(`notification pending event_id=${event.event_id} peer_id=${peerId}: no active subscriber; durable inbox fallback only`);
        return;
      }
      try {
        log(`notification callback start event_id=${event.event_id} peer_id=${peerId} callback_url=${subscriber.callback_url}`);
        const response = await fetch(subscriber.callback_url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-synchronize-subscription-token": subscriber.token,
          },
          body: JSON.stringify({ event: eventForRecipient(event, peerId) }),
        });
        if (!response.ok) {
          ctx.subscribers.delete(peerId);
          log(`notification callback failed event_id=${event.event_id} peer_id=${peerId} status=${response.status}; subscriber removed`);
          return;
        }
        const now = new Date().toISOString();
        ctx.db
          .query(
            `UPDATE inbox
             SET delivered_at = COALESCE(delivered_at, ?)
             WHERE recipient_peer_id = ? AND event_id = ?`,
          )
          .run(now, peerId, event.event_id);
        ctx.db.query("UPDATE peers SET last_cursor = ? WHERE peer_id = ?").run(event.event_id, peerId);
        log(`notification callback delivered event_id=${event.event_id} peer_id=${peerId} delivered_at=${now}`);
      } catch (error) {
        ctx.subscribers.delete(peerId);
        log(`notification callback error event_id=${event.event_id} peer_id=${peerId}: ${formatError(error)}; subscriber removed`);
      }
    }),
  );
}
