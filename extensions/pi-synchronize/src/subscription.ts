import type { Server } from "node:http";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { subscribeToEvents, type Event, type PiSyncClient } from "./client.ts";
import { formatError, log } from "./log.ts";

export interface PiEventSubscriptionOptions {
  peerId: string;
  client: PiSyncClient;
  onEvent: (event: Event) => Promise<void> | void;
  bufferLimit?: number;
}

export class PiEventSubscription {
  private server: Server | null = null;
  private readonly token = crypto.randomUUID();
  private callbackUrl: string | null = null;
  readonly buffer: Event[] = [];

  constructor(private options: PiEventSubscriptionOptions) {}

  setClient(client: PiSyncClient): void {
    this.options = { ...this.options, client };
  }

  async start(): Promise<void> {
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
  }

  isActive(): boolean {
    return Boolean(this.server && this.callbackUrl);
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
    this.buffer.push(body.event);
    if (this.buffer.length > limit) this.buffer.splice(0, this.buffer.length - limit);
    try {
      log(`dispatching event_id=${body.event.event_id} type=${body.event.type}`);
      await this.options.onEvent(body.event);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (error) {
      log(`onEvent failed event_id=${body.event.event_id}: ${formatError(error)}`);
      res.writeHead(502).end("dispatch failed");
    }
  }
}
