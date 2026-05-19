import { readEvents } from "../api/events.ts";
import type { Event } from "../api/types.ts";
import type { ClientConfig } from "../client.ts";
import { DEFAULT_NOTIFICATION_BUFFER, NOTIFIER_ACTIVE_MS, NOTIFIER_IDLE_MS } from "../constants.ts";
import type { NotifyMode } from "./state.ts";
import { formatError, log } from "./util.ts";

export interface NotificationBridgeOptions {
  peerId: string;
  mode: NotifyMode;
  client: ClientConfig;
  emit: (mode: NotifyMode, event: Event) => Promise<void>;
  limit?: number;
  activeMs?: number;
  idleMs?: number;
}

export class NotificationBridge {
  private cursor = 0;
  private stopped = false;
  private running = false;
  readonly buffer: Event[] = [];

  constructor(private readonly options: NotificationBridgeOptions) {}

  start(): void {
    if (this.running) return;
    log(`starting Codex polling notifier peer_id=${this.options.peerId} limit=${this.options.limit ?? DEFAULT_NOTIFICATION_BUFFER}`);
    this.running = true;
    void this.loop();
  }

  stop(): void {
    this.stopped = true;
  }

  private async loop(): Promise<void> {
    const activeMs = this.options.activeMs ?? NOTIFIER_ACTIVE_MS;
    const idleMs = this.options.idleMs ?? NOTIFIER_IDLE_MS;
    const limit = this.options.limit ?? DEFAULT_NOTIFICATION_BUFFER;

    while (!this.stopped) {
      let sleepMs = idleMs;
      try {
        const result = await readEvents(this.options.client, this.options.peerId, { cursor: this.cursor, limit });
        if (result.events.length > 0) {
          sleepMs = activeMs;
          for (const event of result.events) {
            log(`Codex notifier received event_id=${event.event_id} peer_id=${this.options.peerId}`);
            this.cursor = Math.max(this.cursor, event.event_id);
            this.buffer.push(event);
            if (this.buffer.length > limit) this.buffer.splice(0, this.buffer.length - limit);
            await this.options.emit(this.options.mode, event);
          }
        }
      } catch (error) {
        log(`Codex notifier poll failed peer_id=${this.options.peerId}: ${formatError(error)}`);
        sleepMs = idleMs;
      }
      await Bun.sleep(sleepMs);
    }
    this.running = false;
  }
}
