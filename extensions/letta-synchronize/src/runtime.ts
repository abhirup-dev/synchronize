import type { ActivityState } from "../../../src/constants.ts";
import type { Event } from "../../../src/api/types.ts";

export type LettaDeliveryMode = "steer" | "interrupt";

export interface LettaInit {
  agentId: string;
  sessionId: string;
  conversationId: string;
  model: string;
  tools?: string[];
}

export interface LettaStreamMessage {
  type: string;
  content?: string;
  result?: string;
  success?: boolean;
  error?: string;
  message?: string;
}

export interface LettaSession {
  initialize(): Promise<LettaInit>;
  send(message: string): Promise<void>;
  stream(): AsyncIterable<LettaStreamMessage>;
  abort(): Promise<void>;
  close(): void;
}

export interface SynchronizeRegistration {
  peerId: string;
  sessionName: string;
}

export interface SynchronizeBus {
  register(input: {
    peerId?: string;
    sessionName: string;
    purpose: string;
    launchId?: string;
    model?: string;
    metadata?: Record<string, unknown>;
  }): Promise<SynchronizeRegistration>;
  heartbeat(peerId: string): Promise<void>;
  setActivity(peerId: string, state: ActivityState): Promise<void>;
  readInbox(peerId: string): Promise<Event[]>;
  ack(peerId: string, eventIds: number[]): Promise<void>;
  reply(peerId: string, eventId: number, message: string): Promise<void>;
}

export interface LettaSynchronizeRuntimeOptions {
  sessionName: string;
  purpose?: string;
  peerId?: string;
  launchId?: string;
  model?: string;
  deliveryMode?: LettaDeliveryMode;
  pollMs?: number;
  logger?: (message: string) => void;
}

interface DeliveryJob {
  event: Event;
  prompt: string;
  interrupted: boolean;
}

const DEFAULT_PURPOSE = "Letta Code SDK harness connected to Synchronize";

export class LettaSynchronizeRuntime {
  private readonly deliveryMode: LettaDeliveryMode;
  private readonly pollMs: number;
  private readonly logger: (message: string) => void;
  private peerId: string | null = null;
  private initialized = false;
  private stopped = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private queue: DeliveryJob[] = [];
  private seenEventIds = new Set<number>();
  private processing = false;
  private currentJob: DeliveryJob | null = null;
  private idleWaiters: Array<() => void> = [];

  constructor(
    private readonly bus: SynchronizeBus,
    private readonly session: LettaSession,
    private readonly options: LettaSynchronizeRuntimeOptions,
  ) {
    this.deliveryMode = options.deliveryMode ?? "interrupt";
    this.pollMs = options.pollMs ?? 1_000;
    this.logger = options.logger ?? (() => {});
  }

  async initialize(): Promise<SynchronizeRegistration & { letta: LettaInit }> {
    if (this.initialized) throw new Error("LettaSynchronizeRuntime is already initialized");
    const initial = await this.bus.register({
      sessionName: this.options.sessionName,
      purpose: this.options.purpose ?? DEFAULT_PURPOSE,
      ...(this.options.peerId ? { peerId: this.options.peerId } : {}),
      ...(this.options.launchId ? { launchId: this.options.launchId } : {}),
      ...(this.options.model ? { model: this.options.model } : {}),
      metadata: { delivery_mode: this.deliveryMode, phase: "starting" },
    });
    this.peerId = initial.peerId;

    const letta = await this.session.initialize();
    await this.bus.register({
      peerId: initial.peerId,
      sessionName: initial.sessionName,
      purpose: this.options.purpose ?? DEFAULT_PURPOSE,
      ...(this.options.launchId ? { launchId: this.options.launchId } : {}),
      ...(letta.model || this.options.model ? { model: letta.model || this.options.model } : {}),
      metadata: {
        delivery_mode: this.deliveryMode,
        letta_agent_id: letta.agentId,
        letta_session_id: letta.sessionId,
        letta_conversation_id: letta.conversationId,
        letta_tools: letta.tools ?? [],
        phase: "ready",
      },
    });
    await this.bus.setActivity(initial.peerId, "idle");
    this.initialized = true;
    return { ...initial, letta };
  }

  async start(): Promise<void> {
    if (!this.initialized) await this.initialize();
    if (!this.peerId) throw new Error("runtime has no peer id");
    this.heartbeatTimer = setInterval(() => {
      void this.bus.heartbeat(this.peerId!).catch((error) => this.log(`heartbeat failed: ${formatError(error)}`));
    }, 15_000);
    this.schedulePoll(0);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.pollTimer = null;
    this.heartbeatTimer = null;
    this.session.close();
  }

  async ingestEvents(events: Event[]): Promise<void> {
    for (const event of events) {
      if (this.seenEventIds.has(event.event_id)) continue;
      this.seenEventIds.add(event.event_id);
      if (!this.shouldDeliver(event)) continue;
      const job = { event, prompt: formatSynchronizeEvent(event), interrupted: false };
      if (this.deliveryMode === "interrupt" && this.processing && this.currentJob) {
        this.currentJob.interrupted = true;
        this.queue.unshift(job);
        await this.session.abort();
        this.log(`interrupted active Letta turn for synchronize event ${event.event_id}`);
      } else {
        this.queue.push(job);
      }
    }
    void this.processQueue();
  }

  async waitUntilIdle(): Promise<void> {
    if (!this.processing && this.queue.length === 0) return;
    await new Promise<void>((resolve) => this.idleWaiters.push(resolve));
  }

  private async pollOnce(): Promise<void> {
    if (!this.peerId) return;
    const events = await this.bus.readInbox(this.peerId);
    await this.ingestEvents(events);
  }

  private schedulePoll(delayMs: number): void {
    if (this.stopped) return;
    this.pollTimer = setTimeout(() => {
      void this.pollLoop();
    }, delayMs);
  }

  private async pollLoop(): Promise<void> {
    try {
      await this.pollOnce();
    } catch (error) {
      this.log(`poll failed: ${formatError(error)}`);
    } finally {
      this.schedulePoll(this.pollMs);
    }
  }

  private shouldDeliver(event: Event): boolean {
    if (!event.body || event.body.trim() === "") return false;
    if (this.peerId && event.sender_peer_id === this.peerId) return false;
    return event.type === "dm" || event.type === "group_message";
  }

  private async processQueue(): Promise<void> {
    if (this.processing || !this.peerId) return;
    this.processing = true;
    try {
      while (this.queue.length > 0) {
        const job = this.queue.shift()!;
        this.currentJob = job;
        await this.bus.setActivity(this.peerId, "working");
        try {
          const answer = await this.runJob(job);
          if (!job.interrupted && answer.trim()) {
            await this.bus.reply(this.peerId, job.event.event_id, answer.trim());
          }
          await this.bus.ack(this.peerId, [job.event.event_id]);
        } catch (error) {
          this.log(`event ${job.event.event_id} failed: ${formatError(error)}`);
        } finally {
          this.currentJob = null;
          await this.bus.setActivity(this.peerId, "idle").catch(() => {});
        }
      }
    } finally {
      this.processing = false;
      this.resolveIdleWaiters();
    }
  }

  private async runJob(job: DeliveryJob): Promise<string> {
    await this.session.send(job.prompt);
    const assistantChunks: string[] = [];
    let finalResult = "";
    for await (const message of this.session.stream()) {
      if (job.interrupted) continue;
      if (message.type === "assistant" && message.content) assistantChunks.push(message.content);
      if (message.type === "result") {
        if (message.success === false) throw new Error(message.error ?? message.message ?? "Letta turn failed");
        finalResult = message.result ?? assistantChunks.join("");
        break;
      }
    }
    return finalResult || assistantChunks.join("");
  }

  private resolveIdleWaiters(): void {
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const waiter of waiters) waiter();
  }

  private log(message: string): void {
    this.logger(`[letta-synchronize] ${message}`);
  }
}

export function formatSynchronizeEvent(event: Event): string {
  const attrs = [
    `event_id="${event.event_id}"`,
    `type="${escapeAttr(event.type)}"`,
    event.sender_peer_id ? `from_peer_id="${escapeAttr(event.sender_peer_id)}"` : null,
    event.group_name ? `group="${escapeAttr(event.group_name)}"` : null,
    event.parent_event_id !== null ? `parent_event_id="${event.parent_event_id}"` : null,
    event.reply_to_event_id !== null ? `reply_to_event_id="${event.reply_to_event_id}"` : null,
    `created_at="${escapeAttr(event.created_at)}"`,
  ].filter(Boolean).join(" ");
  return [
    "Treat this as a live Synchronize bus event from another agent session.",
    "Respond to the sender's message. The Synchronize harness will deliver your final response back to the source event.",
    "",
    `<synchronize_event ${attrs}>`,
    escapeText(event.body ?? ""),
    "</synchronize_event>",
  ].join("\n");
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
