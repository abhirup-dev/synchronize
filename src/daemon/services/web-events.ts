import { Database } from "bun:sqlite";

export interface WebStateClient {
  id: string;
  send(change: WebStateChange): void;
}

interface WebStateChange {
  cursor: number;
  type: "connected" | "state_changed";
  domains: string[];
  event_id?: number;
  group_id?: number | null;
  peer_id?: string | null;
}

export function emitWebStateChanged(
  ctx: { db: Database; webStateClients: Set<WebStateClient>; stateVersion: number },
  input: { domains: string[]; eventId?: number; groupId?: number | null; peerId?: string | null },
): void {
  ctx.stateVersion += 1;
  const change: WebStateChange = {
    cursor: input.eventId ?? ctx.db.query<{ cursor: number | null }, []>("SELECT MAX(event_id) AS cursor FROM events").get()?.cursor ?? ctx.stateVersion,
    type: "state_changed",
    domains: input.domains,
    ...(input.eventId !== undefined ? { event_id: input.eventId } : {}),
    ...(input.groupId !== undefined ? { group_id: input.groupId } : {}),
    ...(input.peerId !== undefined ? { peer_id: input.peerId } : {}),
  };
  for (const client of [...ctx.webStateClients]) client.send(change);
}

export function openWebEvents(ctx: { webStateClients: Set<WebStateClient>; stateVersion: number }): Response {
  const encoder = new TextEncoder();
  const id = crypto.randomUUID();
  let cleanup: (() => void) | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string) => controller.enqueue(encoder.encode(chunk));
      const client: WebStateClient = {
        id,
        send(change) {
          try {
            write(formatSse(change));
          } catch {
            ctx.webStateClients.delete(client);
          }
        },
      };
      const heartbeat = setInterval(() => {
        try {
          write(`: heartbeat ${new Date().toISOString()}\n\n`);
        } catch {
          ctx.webStateClients.delete(client);
          clearInterval(heartbeat);
        }
      }, 15_000);
      cleanup = () => {
        clearInterval(heartbeat);
        ctx.webStateClients.delete(client);
      };
      ctx.webStateClients.add(client);
      client.send({ cursor: ctx.stateVersion, type: "connected", domains: [] });
    },
    cancel() {
      cleanup?.();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}

function formatSse(change: WebStateChange): string {
  return [
    `id: ${change.cursor}`,
    `event: ${change.type}`,
    `data: ${JSON.stringify(change)}`,
    "",
    "",
  ].join("\n");
}
