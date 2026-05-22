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
  TIMELINE,
} from "./seed.ts";

export class MockDataSource implements DataSource {
  readonly kind = "mock" as const;

  private readonly _agents = createSnapshot<Agent[]>(AGENTS);
  private readonly _rooms = createSnapshot<Room[]>([...GROUPS, ...DMS]);
  private readonly _messages = new Map<string, MutableSnapshot<Message[]>>();
  private readonly _threadReplies = new Map<string, MutableSnapshot<Message[]>>();
  private readonly _timeline = new Map<string, MutableSnapshot<TimelineEvent[]>>();
  private readonly _tasks = new Map<string, MutableSnapshot<Task[]>>();
  private readonly _artifacts = new Map<string, MutableSnapshot<Artifact[]>>();
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

  async connect(): Promise<void> { /* mock has no live connection */ }
  disconnect(): void { /* noop */ }
}
