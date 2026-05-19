import { subscribeToEvents } from "../api/events.ts";
import type { Event } from "../api/types.ts";
import type { ClientConfig } from "../client.ts";
import { DEFAULT_NOTIFICATION_BUFFER } from "../constants.ts";
import type { NotifyMode } from "./state.ts";
import { formatError, log } from "./util.ts";

export interface EventSubscriptionOptions {
  peerId: string;
  mode: NotifyMode;
  client: ClientConfig;
  emit: (mode: NotifyMode, event: Event) => Promise<void>;
  limit?: number;
}

export class EventSubscription {
  private server: Bun.Server<unknown> | null = null;
  private readonly token = crypto.randomUUID();
  private callbackUrl: string | null = null;
  readonly buffer: Event[] = [];

  constructor(private options: EventSubscriptionOptions) {}

  setClient(client: ClientConfig): void {
    this.options = { ...this.options, client };
  }

  async start(): Promise<void> {
    if (!this.server) {
      this.server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch: (request) => this.handle(request),
      });
      this.callbackUrl = `http://${this.server.hostname}:${this.server.port}/events`;
      log(`started Claude callback server peer_id=${this.options.peerId} callback_url=${this.callbackUrl}`);
    }
    await this.subscribe();
  }

  async subscribe(): Promise<void> {
    if (!this.callbackUrl) throw new Error("event subscription callback server is not running");
    await subscribeToEvents(this.options.client, {
      peerId: this.options.peerId,
      callbackUrl: this.callbackUrl,
      token: this.token,
    });
    log(`subscribed Claude channel callback for peer ${this.options.peerId} at ${this.callbackUrl}`);
  }

  stop(): void {
    if (this.callbackUrl) log(`stopping Claude callback server peer_id=${this.options.peerId} callback_url=${this.callbackUrl}`);
    this.server?.stop(true);
    this.server = null;
    this.callbackUrl = null;
  }

  isActive(): boolean {
    return Boolean(this.server && this.callbackUrl);
  }

  private async handle(request: Request): Promise<Response> {
    if (request.method !== "POST") return new Response("not found", { status: 404 });
    if (request.headers.get("x-synchronize-subscription-token") !== this.token) {
      return new Response("unauthorized", { status: 401 });
    }
    const body = (await request.json().catch(() => null)) as { event?: Event } | null;
    if (!body?.event) return new Response("invalid event", { status: 400 });
    const limit = this.options.limit ?? DEFAULT_NOTIFICATION_BUFFER;
    this.buffer.push(body.event);
    if (this.buffer.length > limit) this.buffer.splice(0, this.buffer.length - limit);
    try {
      log(`emitting ${this.options.mode} notification for event ${body.event.event_id}`);
      await this.options.emit(this.options.mode, body.event);
      log(`emitted ${this.options.mode} notification for event ${body.event.event_id}`);
    } catch (error) {
      log(`failed to emit ${this.options.mode} notification for event ${body.event.event_id}: ${formatError(error)}`);
      return new Response("notification emit failed", { status: 502 });
    }
    return Response.json({ ok: true });
  }
}
