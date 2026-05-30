// MockDataSource — in-memory adapter seeded from ./seed.ts. Useful for
// developing components without a daemon, and as a fallback when the live
// adapter can't connect. Every snapshot is independent so subscribing to one
// room's messages doesn't re-render unrelated rooms.

import type {
  Agent,
  Artifact,
  DataSource,
  Message,
  Room,
  SendMessageInput,
  Snapshot,
  Task,
  ThreadSummary,
  TimelineEvent,
} from "./types.ts";
import { createSnapshot, type MutableSnapshot } from "./store.ts";
import {
  AGENTS,
  ARTIFACTS,
  DMS,
  GROUPS,
  MESSAGES,
  TASKS,
  THREAD_REPLIES,
  THREAD_SUMMARIES,
  TIMELINE,
} from "./seed.ts";

// Persistent overrides for agent identity colors. Stored in localStorage so the
// user's customizations survive reloads; we restore them on construction.
const COLOR_OVERRIDES_KEY = "synchronize.agentColors";
function readColorOverrides(): Record<string, string> {
  try {
    const raw = localStorage.getItem(COLOR_OVERRIDES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}
function writeColorOverrides(overrides: Record<string, string>): void {
  try {
    localStorage.setItem(COLOR_OVERRIDES_KEY, JSON.stringify(overrides));
  } catch {
    /* localStorage full / blocked — ignore */
  }
}
const SEEDED_COLOR_BY_ID = new Map(AGENTS.map((a) => [a.id, a.color] as const));

export class MockDataSource implements DataSource {
  readonly kind = "mock" as const;

  private readonly _agents = createSnapshot<Agent[]>(
    AGENTS.map((a) => {
      const overrides = readColorOverrides();
      const override = overrides[a.id];
      return override ? { ...a, color: override } : a;
    }),
  );
  private readonly _rooms = createSnapshot<Room[]>([...GROUPS, ...DMS]);
  private readonly _messages = new Map<string, MutableSnapshot<Message[]>>();
  private readonly _threadReplies = new Map<string, MutableSnapshot<Message[]>>();
  private readonly _timeline = new Map<string, MutableSnapshot<TimelineEvent[]>>();
  private readonly _tasks = new Map<string, MutableSnapshot<Task[]>>();
  private readonly _artifacts = new Map<string, MutableSnapshot<Artifact[]>>();
  private readonly _threadSummaries = new Map<string, MutableSnapshot<ThreadSummary>>();
  private readonly _me = createSnapshot<Agent>(AGENTS.find((a) => a.id === "you")!);

  agents(): Snapshot<Agent[]> { return this._agents; }
  rooms(): Snapshot<Room[]>   { return this._rooms; }
  me(): Snapshot<Agent>        { return this._me; }

  messages(roomId: string): Snapshot<Message[]> {
    let snap = this._messages.get(roomId);
    if (!snap) {
      snap = createSnapshot<Message[]>(MESSAGES[roomId] ?? []);
      this._messages.set(roomId, snap);
    }
    return snap;
  }

  threadReplies(parentId: string): Snapshot<Message[]> {
    let snap = this._threadReplies.get(parentId);
    if (!snap) {
      snap = createSnapshot<Message[]>(THREAD_REPLIES[parentId] ?? []);
      this._threadReplies.set(parentId, snap);
    }
    return snap;
  }

  timeline(roomId: string): Snapshot<TimelineEvent[]> {
    let snap = this._timeline.get(roomId);
    if (!snap) {
      snap = createSnapshot<TimelineEvent[]>(TIMELINE[roomId] ?? []);
      this._timeline.set(roomId, snap);
    }
    return snap;
  }

  tasks(roomId: string): Snapshot<Task[]> {
    let snap = this._tasks.get(roomId);
    if (!snap) {
      snap = createSnapshot<Task[]>(TASKS[roomId] ?? []);
      this._tasks.set(roomId, snap);
    }
    return snap;
  }

  artifacts(roomId: string): Snapshot<Artifact[]> {
    let snap = this._artifacts.get(roomId);
    if (!snap) {
      snap = createSnapshot<Artifact[]>(ARTIFACTS[roomId] ?? []);
      this._artifacts.set(roomId, snap);
    }
    return snap;
  }

  threadSummary(parentMessageId: string): Snapshot<ThreadSummary> {
    let snap = this._threadSummaries.get(parentMessageId);
    if (!snap) {
      const text = THREAD_SUMMARIES[parentMessageId];
      snap = createSnapshot<ThreadSummary>(
        text ? { text, status: "ok" } : { text: null, status: "disabled" },
      );
      this._threadSummaries.set(parentMessageId, snap);
    }
    return snap;
  }

  async sendMessage(input: SendMessageInput): Promise<Message> {
    const me = this._me.get();
    const msg: Message = {
      id: `m_${Date.now().toString(36)}`,
      roomId: input.roomId,
      authorId: me.id,
      body: input.body,
      createdAt: new Date().toISOString(),
      mentions: input.mentions,
      reactions: [],
      status: "queued",
      ...(input.parentMessageId !== undefined && { parentId: input.parentMessageId }),
    };
    if (input.parentMessageId) {
      const snap = this.threadReplies(input.parentMessageId) as MutableSnapshot<Message[]>;
      snap.update((prev) => [...prev, msg]);
    } else {
      const snap = this.messages(input.roomId) as MutableSnapshot<Message[]>;
      snap.update((prev) => [...prev, msg]);
    }
    // Simulate ack
    setTimeout(() => {
      const ack: Message = { ...msg, status: "delivered" };
      const target = input.parentMessageId
        ? (this.threadReplies(input.parentMessageId) as MutableSnapshot<Message[]>)
        : (this.messages(input.roomId) as MutableSnapshot<Message[]>);
      target.update((prev) => prev.map((m) => (m.id === msg.id ? ack : m)));
    }, 280);
    return msg;
  }

  setAgentColor(agentId: string, hex: string | null): void {
    const overrides = readColorOverrides();
    if (hex === null) {
      delete overrides[agentId];
    } else {
      overrides[agentId] = hex;
    }
    writeColorOverrides(overrides);
    const fallback = SEEDED_COLOR_BY_ID.get(agentId);
    const next = hex ?? fallback;
    this._agents.update((prev) =>
      prev.map((a) => (a.id === agentId ? { ...a, color: next ?? a.color } : a)),
    );
    // Mirror onto `me` if it's the same agent.
    if (this._me.get().id === agentId) {
      this._me.set({ ...this._me.get(), color: next ?? this._me.get().color });
    }
  }

  async connect(): Promise<void> { /* mock has no live connection */ }
  disconnect(): void { /* noop */ }
}
