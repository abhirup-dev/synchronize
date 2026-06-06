// MockDataSource — in-memory adapter seeded from ./seed.ts. Useful for
// developing components without a daemon, and as a fallback when the live
// adapter can't connect. Every snapshot is independent so subscribing to one
// room's messages doesn't re-render unrelated rooms.

import type {
  ActivityItem,
  Agent,
  Artifact,
  DataSource,
  Message,
  MessageAttachment,
  ReactToMessageInput,
  Room,
  SendMessageInput,
  StageAttachmentInput,
  SkillCatalogEntry,
  SpawnAgentInput,
  SpawnAgentResult,
  Snapshot,
  Task,
  ThreadSummary,
  TimelineEvent,
} from "./types.ts";
import { createSnapshot, type MutableSnapshot } from "./store.ts";
import { attachmentKindFor, extensionFor, makeExternalAttachment, nativeFilePath } from "../utils/attachments.ts";
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
const MOCK_SKILL_CATALOG: SkillCatalogEntry[] = [
  {
    id: "diagnose",
    name: "diagnose",
    description: "Disciplined diagnosis loop for hard bugs and regressions.",
    runtimes: ["claude", "pi"],
  },
  {
    id: "code-review",
    name: "code-review",
    description: "Review code changes for bugs, regressions, and missing tests.",
    runtimes: ["claude"],
  },
  {
    id: "query-sharechat-spanner",
    name: "query-sharechat-spanner",
    description: "Query and inspect ShareChat Cloud Spanner data.",
    runtimes: ["pi"],
  },
];

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
  private readonly _skillCatalog = createSnapshot<SkillCatalogEntry[]>(MOCK_SKILL_CATALOG);
  // Activity feed: aggregated once from the seed (every other agent's message
  // across all rooms), then awaiting is recomputed from `ackedActivity`. This
  // mirrors the daemon's inbox-backed feed and ack semantics in memory.
  private readonly activityBase: ActivityItem[] = buildMockActivity(this._me.get().id);
  private readonly ackedActivity = new Set<number>();
  private readonly _activity = createSnapshot<ActivityItem[]>([]);
  private readonly _activityAwaiting = createSnapshot<number>(0);

  agents(): Snapshot<Agent[]> { return this._agents; }
  rooms(): Snapshot<Room[]>   { return this._rooms; }
  me(): Snapshot<Agent>        { return this._me; }
  skillCatalog(): Snapshot<SkillCatalogEntry[]> { return this._skillCatalog; }

  activity(): Snapshot<ActivityItem[]> {
    if (this._activity.get().length === 0 && this.activityBase.length > 0) this.emitActivity();
    return this._activity;
  }

  activityAwaitingCount(): Snapshot<number> {
    if (this._activity.get().length === 0 && this.activityBase.length > 0) this.emitActivity();
    return this._activityAwaiting;
  }

  private emitActivity(): void {
    const items = this.activityBase.map((item) => ({
      ...item,
      awaiting: item.awaiting && !this.ackedActivity.has(item.eventId),
    }));
    this._activity.set(items);
    this._activityAwaiting.set(items.filter((item) => item.awaiting).length);
  }

  async ackActivity(eventId: number): Promise<void> {
    this.ackedActivity.add(eventId);
    this.emitActivity();
  }

  async ackAllActivity(): Promise<void> {
    for (const item of this.activityBase) if (item.awaiting) this.ackedActivity.add(item.eventId);
    this.emitActivity();
  }

  async loadMoreActivity(): Promise<void> {
    // Mock aggregates the whole seed up front — nothing older to page in.
    return;
  }

  // Engaging with a message (react/reply) clears its activity row — mirrors the
  // daemon's server-side auto-ack.
  private ackActivityByMsgId(msgId: string): void {
    const item = this.activityBase.find((entry) => entry.msgId === msgId);
    if (!item) return;
    this.ackedActivity.add(item.eventId);
    if (this._activity.get().length > 0) this.emitActivity();
  }

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

  async stageAttachment(input: StageAttachmentInput): Promise<MessageAttachment> {
    const externalPath = input.sourceHint === "picker" ? nativeFilePath(input.file) : null;
    if (externalPath) return makeExternalAttachment(input.file, externalPath, input.previewUrl);
    const id = crypto.randomUUID();
    const name = input.file.name || "attachment";
    return {
      id,
      kind: attachmentKindFor(input.file.type, name),
      source: "staged",
      name,
      mimeType: input.file.type || "application/octet-stream",
      size: input.file.size,
      extension: extensionFor(name, input.file.type),
      path: `/mock/synchronize/tmp/web-attachments/${id}/${name}`,
      ...(input.previewUrl ? { previewUrl: input.previewUrl } : {}),
    };
  }

  async removeDraftAttachment(_attachment: MessageAttachment): Promise<void> {
    return;
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
      ...(input.attachments?.length ? { attachments: input.attachments } : {}),
      status: "queued",
      ...(input.parentMessageId !== undefined && { parentId: input.parentMessageId }),
    };
    if (input.parentMessageId) {
      this.ackActivityByMsgId(input.parentMessageId);
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

  async reactToMessage(input: ReactToMessageInput): Promise<Message> {
    const me = this._me.get();
    this.ackActivityByMsgId(input.messageId);
    // Reacting from the Activity feed may target a room whose message snapshot
    // hasn't been opened yet — seed it lazily so the reaction lands.
    this.messages(input.roomId);
    const update = (messages: Message[]) =>
      messages.map((message) => {
        if (message.id !== input.messageId) return message;
        const reactions = message.reactions.map((reaction) => ({ ...reaction, by: [...reaction.by] }));
        const existing = reactions.find((reaction) => reaction.emoji === input.emoji);
        const hasReacted = Boolean(existing?.by.includes(me.id));
        const shouldAdd = input.op === "add" || (input.op !== "remove" && !hasReacted);
        if (shouldAdd) {
          if (existing) existing.by = [...new Set([...existing.by, me.id])];
          else reactions.push({ emoji: input.emoji, by: [me.id] });
        } else if (existing) {
          existing.by = existing.by.filter((id) => id !== me.id);
        }
        return { ...message, reactions: reactions.filter((reaction) => reaction.by.length > 0) };
      });

    const snap = this._messages.get(input.roomId);
    if (snap?.get().some((message) => message.id === input.messageId)) {
      snap.update(update);
      return snap.get().find((message) => message.id === input.messageId)!;
    }
    for (const [parentId, replySnap] of this._threadReplies) {
      if (!replySnap.get().some((message) => message.id === input.messageId)) continue;
      replySnap.update(update);
      return replySnap.get().find((message) => message.id === input.messageId)!;
    }
    // Thread replies are seeded lazily per parent; if the target is a seed reply
    // we haven't opened, find it directly.
    for (const replies of Object.values(THREAD_REPLIES)) {
      const found = replies.find((message) => message.id === input.messageId);
      if (found) {
        const snap = this.threadReplies(found.parentId ?? "") as MutableSnapshot<Message[]>;
        snap.update(update);
        return snap.get().find((message) => message.id === input.messageId) ?? found;
      }
    }
    // Not in any known surface (e.g. reacting from the feed on an item that's
    // only in the aggregated activity list). The awaiting state is already
    // cleared above; return a best-effort message so callers can proceed.
    return {
      id: input.messageId,
      roomId: input.roomId,
      authorId: "",
      body: "",
      createdAt: new Date().toISOString(),
      mentions: [],
      reactions: [{ emoji: input.emoji, by: [me.id] }],
    };
  }

  async spawnAgent(input: SpawnAgentInput): Promise<SpawnAgentResult> {
    const room = this._rooms.get().find((candidate) => candidate.id === input.roomId);
    if (!room || room.kind !== "group") throw new Error("agents can only be spawned into groups");
    const sessionName = input.name.trim();
    if (!sessionName) throw new Error("agent name is required");
    const peerId = `mock:${input.tool}:${Date.now().toString(36)}`;
    const agent: Agent = {
      id: peerId,
      name: sessionName,
      handle: sessionName.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || peerId.slice(-8),
      color: "#B49BFF",
      role: input.tool,
      status: "idle",
      avatar: (sessionName[0] ?? input.tool[0] ?? "?").toUpperCase(),
    };
    this._agents.update((agents) => [...agents, agent]);
    this._rooms.update((rooms) =>
      rooms.map((candidate) =>
        candidate.id === room.id
          ? {
              ...candidate,
              members: [...candidate.members, peerId],
              memberAliases: { ...candidate.memberAliases, [peerId]: sessionName },
              lastPreview: `${sessionName} joined`,
            }
          : candidate,
      ),
    );
    return {
      peerId,
      sessionName,
      title: `${sessionName}-${peerId.slice(-8)}`,
      group: room.name,
    };
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

// Aggregate the seed into a global, newest-first Activity feed — the in-memory
// analogue of the daemon's observer feed. The feed shows every other agent's
// messages across all rooms (own sends excluded). `awaiting` here is a narrower
// demo APPROXIMATION of the daemon (an item "needs you" when it's an @-mention,
// one of your DMs, or a reply in a thread you started). The daemon's real
// awaiting set is every un-acked inbox row in your joined rooms + DMs — a
// superset; the mock just makes the offline demo feel right.
function buildMockActivity(meId: string): ActivityItem[] {
  const dmRoomIds = new Set(DMS.map((dm) => dm.id));
  const all: Message[] = [];
  for (const list of Object.values(MESSAGES)) all.push(...list);
  for (const list of Object.values(THREAD_REPLIES)) all.push(...list);
  const yourMessageIds = new Set(all.filter((m) => m.authorId === meId).map((m) => m.id));

  const seen = new Set<string>();
  const candidates: Array<{ message: Message; awaiting: boolean; isMention: boolean }> = [];
  for (const message of all) {
    if (message.authorId === meId) continue; // exclude own sends
    if (!message.roomId || seen.has(message.id)) continue;
    seen.add(message.id);
    const isMention = message.mentions.includes(meId) || /@you\b/i.test(message.body);
    const isDm = dmRoomIds.has(message.roomId);
    const isReplyToYou = Boolean(message.parentId && yourMessageIds.has(message.parentId));
    candidates.push({ message, awaiting: isMention || isDm || isReplyToYou, isMention });
  }
  // Oldest-first to assign monotonic event ids, then present newest-first.
  candidates.sort((a, b) => Date.parse(a.message.createdAt) - Date.parse(b.message.createdAt));
  const items = candidates.map((entry, index): ActivityItem => {
    const { message } = entry;
    return {
      id: message.id,
      eventId: index + 1,
      roomId: message.roomId,
      actorId: message.authorId,
      type: "activity",
      text: message.body,
      createdAt: message.createdAt,
      awaiting: entry.awaiting,
      isMention: entry.isMention,
      ...(message.parentId ? { threadParentId: message.parentId } : {}),
      ...(message.threadReplyCount !== undefined ? { replyCount: message.threadReplyCount } : {}),
      msgId: message.id,
    };
  });
  return items.reverse();
}
