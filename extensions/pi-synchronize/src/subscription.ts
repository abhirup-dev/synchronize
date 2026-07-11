import type { Server } from "node:http";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { readEvents, subscribeToEvents, type Event, type PiSyncClient } from "./client.ts";
import { formatError, log } from "./log.ts";

export interface PiEventSubscriptionOptions {
  peerId: string;
  client: PiSyncClient;
  onEvent: (event: Event) => Promise<void> | void;
  bufferLimit?: number;
}

export class PiEventSubscription {
  private server: Server | null = null;
  private poller: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  private cursor = 0;
  private readonly token = crypto.randomUUID();
  private callbackUrl: string | null = null;
  readonly buffer: Event[] = [];

  constructor(private options: PiEventSubscriptionOptions) {}

  setClient(client: PiSyncClient): void {
    this.options = { ...this.options, client };
  }

  async start(): Promise<void> {
    if (this.options.client.remote) {
      this.startPolling();
      return;
    }
    if (!this.server) {
      this.server = createServer((req, res) => {
        void this.handle(req, res);
      });
      await new Promise<void>((resolve) => {
        this.server!.listen(0, "127.0.0.1", () => resolve());
      });
      const address = this.server.address() as AddressInfo;
      this.callbackUrl = `http://127.0.0.1:${address.port}/events`;
      log(`callback server listening peer_id=${this.options.peerId} url=${this.callbackUrl}`);
    }
    await this.subscribe();
  }

  async subscribe(): Promise<void> {
    if (!this.callbackUrl) throw new Error("callback server is not running");
    await subscribeToEvents(this.options.client, {
      peerId: this.options.peerId,
      callbackUrl: this.callbackUrl,
      token: this.token,
    });
    log(`subscribed peer_id=${this.options.peerId} url=${this.callbackUrl}`);
  }

  stop(): void {
    if (this.callbackUrl) log(`stopping callback server peer_id=${this.options.peerId}`);
    this.server?.close();
    this.server = null;
    this.callbackUrl = null;
    if (this.poller) log(`stopping poll subscription peer_id=${this.options.peerId}`);
    if (this.poller) clearInterval(this.poller);
    this.poller = null;
    this.polling = false;
  }

  isActive(): boolean {
    return Boolean((this.server && this.callbackUrl) || this.poller);
  }

  private startPolling(): void {
    if (this.poller) return;
    const intervalMs = pollingIntervalMs();
    log(`poll subscription starting peer_id=${this.options.peerId} interval_ms=${intervalMs}`);
    this.poller = setInterval(() => {
      void this.pollOnce();
    }, intervalMs);
    void this.pollOnce();
  }

  private async pollOnce(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const response = await readEvents(this.options.client, this.options.peerId, { cursor: this.cursor, limit: 100 });
      this.cursor = response.next_cursor;
      for (const event of response.events) {
        await this.dispatchEvent(event);
      }
    } catch (error) {
      log(`poll subscription failed peer_id=${this.options.peerId}: ${formatError(error)}`);
    } finally {
      this.polling = false;
    }
  }

  private async handle(
    req: import("node:http").IncomingMessage,
    res: import("node:http").ServerResponse,
  ): Promise<void> {
    if (req.method !== "POST") {
      res.writeHead(404).end("not found");
      return;
    }
    if (req.headers["x-synchronize-subscription-token"] !== this.token) {
      res.writeHead(401).end("unauthorized");
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    let body: { event?: Event } | null;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { event?: Event };
    } catch {
      res.writeHead(400).end("invalid json");
      return;
    }
    if (!body?.event) {
      res.writeHead(400).end("invalid event");
      return;
    }
    const limit = this.options.bufferLimit ?? 100;
    try {
      await this.dispatchEvent(body.event, limit);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (error) {
      log(`onEvent failed event_id=${body.event.event_id}: ${formatError(error)}`);
      res.writeHead(502).end("dispatch failed");
    }
  }

  private async dispatchEvent(event: Event, limit = this.options.bufferLimit ?? 100): Promise<void> {
    this.buffer.push(event);
    if (this.buffer.length > limit) this.buffer.splice(0, this.buffer.length - limit);
    log(`dispatching event_id=${event.event_id} type=${event.type}`);
    await this.options.onEvent(event);
  }
}

function pollingIntervalMs(): number {
  const raw = Number(process.env.SYNCHRONIZE_PI_POLL_MS);
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 1000;
}
