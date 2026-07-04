// MockDataSource — in-memory adapter seeded from ./seed.ts. Useful for
// developing components without a daemon, and as a fallback when the live
// adapter can't connect. Every snapshot is independent so subscribing to one
// room's messages doesn't re-render unrelated rooms.

import type {
  ActivityItem,
  Agent,
  AgentLaunchProfile,
  ArchivePreview,
  ArchivePreviewMember,
  ArchivedSession,
  Artifact,
  DataSource,
  Message,
  MessageAttachment,
  ReactToMessageInput,
  ResumePreview,
  ResumePreviewMember,
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
  WebDeepLinkTarget,
} from "./types.ts";
import { createSnapshot, type MutableSnapshot } from "./store.ts";
import { attachmentKindFor, extensionFor, makeExternalAttachment, nativeFilePath } from "../utils/attachments.ts";
import {
  identityColorCss,
  identityRefForId,
  normalizeIdentityColorRef,
  type IdentityColorRef,
} from "../theme/identity.ts";
import { readIdentityOverrideMap, writeIdentityOverrideMap } from "../theme/storage.ts";
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
const SEEDED_COLOR_REF_BY_ID = new Map(AGENTS.map((a) => [a.id, a.colorRef ?? normalizeIdentityColorRef(a.color, a.id)] as const));

function agentsWithColorOverrides(): Agent[] {
  const overrides = readIdentityOverrideMap(COLOR_OVERRIDES_KEY);
  return AGENTS.map((a) => {
    const override = overrides[a.id];
    const colorRef = override ?? a.colorRef ?? normalizeIdentityColorRef(a.color, a.id);
    return { ...a, colorRef, color: identityColorCss(colorRef) };
  });
}

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

const MOCK_ARCHIVED_AT = new Date(Date.now() - 18 * 60_000).toISOString();
const MOCK_ARCHIVED_SESSIONS: ArchivedSession[] = [
  {
    peerId: "pulse",
    sessionName: "Pulse",
    tool: "pi",
    archivedAt: MOCK_ARCHIVED_AT,
    archivedReason: "paused ranking investigation",
    archiveSource: "manual",
    aliases: [{ group: "ml-ranking", alias: "pulse" }],
  },
];

export class MockDataSource implements DataSource {
  readonly kind = "mock" as const;

  private readonly _agents = createSnapshot<Agent[]>(agentsWithColorOverrides());
  private readonly _rooms = createSnapshot<Room[]>([...GROUPS, ...DMS]);
  private readonly _messages = new Map<string, MutableSnapshot<Message[]>>();
  private readonly _threadReplies = new Map<string, MutableSnapshot<Message[]>>();
  private readonly _drafts = new Map<string, MutableSnapshot<string>>();
  private readonly _timeline = new Map<string, MutableSnapshot<TimelineEvent[]>>();
  private readonly _tasks = new Map<string, MutableSnapshot<Task[]>>();
  private readonly _artifacts = new Map<string, MutableSnapshot<Artifact[]>>();
  private readonly _threadSummaries = new Map<string, MutableSnapshot<ThreadSummary>>();
  private readonly _me = createSnapshot<Agent>(AGENTS.find((a) => a.id === "you")!);
  private readonly _skillCatalog = createSnapshot<SkillCatalogEntry[]>(MOCK_SKILL_CATALOG);
  private readonly _launchProfiles = createSnapshot<AgentLaunchProfile[]>([]);
  private readonly _archivedSessions = createSnapshot<ArchivedSession[]>(MOCK_ARCHIVED_SESSIONS);
  // Activity feed: aggregated once from the seed (every other agent's message
  // across all rooms), then awaiting is recomputed from explicit handled
  // markers. This mirrors the daemon's thread-interaction projection in memory.
  private readonly activityBase: ActivityItem[] = buildMockActivity(this._me.get().id);
  private readonly handledActivityScopes = new Map<string, number>();
  private readonly _activity = createSnapshot<ActivityItem[]>([]);
  private readonly _activityAwaiting = createSnapshot<number>(0);

  agents(): Snapshot<Agent[]> { return this._agents; }
  rooms(): Snapshot<Room[]>   { return this._rooms; }
  me(): Snapshot<Agent>        { return this._me; }
  skillCatalog(): Snapshot<SkillCatalogEntry[]> { return this._skillCatalog; }
  launchProfiles(): Snapshot<AgentLaunchProfile[]> { return this._launchProfiles; }

  activity(): Snapshot<ActivityItem[]> {
    if (this._activity.get().length === 0 && this.activityBase.length > 0) this.emitActivity();
    return this._activity;
  }

  activityAwaitingCount(): Snapshot<number> {
    if (this._activity.get().length === 0 && this.activityBase.length > 0) this.emitActivity();
    return this._activityAwaiting;
  }

  archivedSessions(): Snapshot<ArchivedSession[]> { return this._archivedSessions; }

  private emitActivity(): void {
    const items = this.activityBase.map((item) => ({
      ...item,
      awaiting:
        item.awaiting &&
        item.eventId > (this.handledActivityScopes.get(activityScopeKey(item)) ?? 0),
    }));
    this._activity.set(items);
    this._activityAwaiting.set(items.filter((item) => item.awaiting).length);
  }

  async ackActivity(eventId: number): Promise<void> {
    await this.ackActivityEvents([eventId]);
  }

  async ackActivityEvents(eventIds: number[]): Promise<void> {
    for (const eventId of eventIds) {
      this.markActivityScopeByEventId(eventId);
    }
    this.emitActivity();
  }

  async ackAllActivity(): Promise<void> {
    for (const item of this.activityBase) {
      if (!item.awaiting) continue;
      this.markActivityScope(item, item.eventId);
    }
    this.emitActivity();
  }

  async loadMoreActivity(): Promise<void> {
    // Mock aggregates the whole seed up front — nothing older to page in.
    return;
  }

  // Engaging with a message (react/reply) advances the handled marker for that
  // thread — mirrors the daemon's server-side activity projection.
  private ackActivityByMsgId(msgId: string): void {
    const item = this.activityBase.find((entry) => entry.msgId === msgId);
    if (!item) return;
    this.markActivityScope(item, item.eventId);
    if (this._activity.get().length > 0) this.emitActivity();
  }

  private markActivityScopeByEventId(eventId: number): void {
    const item = this.activityBase.find((entry) => entry.eventId === eventId);
    if (!item) return;
    this.markActivityScope(item, eventId);
  }

  private markActivityScope(item: ActivityItem, eventId: number): void {
    const scope = activityScopeKey(item);
    this.handledActivityScopes.set(scope, Math.max(this.handledActivityScopes.get(scope) ?? 0, eventId));
  }

  messages(roomId: string): Snapshot<Message[]> {
    let snap = this._messages.get(roomId);
    if (!snap) {
      snap = createSnapshot<Message[]>(MESSAGES[roomId] ?? []);
      this._messages.set(roomId, snap);
    }
    return snap;
  }

  draft(roomId: string, threadParentId = ""): Snapshot<string> {
    const key = `${roomId} ${threadParentId}`;
    let snap = this._drafts.get(key);
    if (!snap) {
      snap = createSnapshot<string>("");
      this._drafts.set(key, snap);
    }
    return snap;
  }

  async saveDraft(input: { roomId: string; threadParentId?: string; body: string }): Promise<void> {
    (this.draft(input.roomId, input.threadParentId ?? "") as MutableSnapshot<string>).set(input.body);
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
    const colorRef = identityRefForId(peerId);
    const agent: Agent = {
      id: peerId,
      name: sessionName,
      handle: sessionName.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || peerId.slice(-8),
      color: identityColorCss(colorRef),
      colorRef,
      role: input.profileName ?? input.tool,
      status: "idle",
      lifecycleState: "active",
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

  async archiveSessionPreview(input: { peerId: string; reason?: string }): Promise<ArchivePreview> {
    return {
      target: "session",
      dryRun: true,
      members: [this.mockArchiveMember(input.peerId, "would_archive")],
    };
  }

  async archiveGroupPreview(input: { group: string; reason?: string }): Promise<ArchivePreview> {
    const room = this.findGroup(input.group);
    return {
      target: "group",
      group: room.name,
      dryRun: true,
      members: room.members
        .filter((peerId) => peerId !== this._me.get().id)
        .map((peerId) => this.mockArchiveMember(peerId, this.isArchived(peerId) ? "already_archived" : "would_archive")),
    };
  }

  async confirmArchiveSession(input: { peerId: string; reason?: string }): Promise<ArchivePreview> {
    const member = this.mockArchiveMember(input.peerId, this.isArchived(input.peerId) ? "already_archived" : "archived");
    if (member.action === "archived") this.archivePeer(input.peerId, input.reason);
    return { target: "session", dryRun: false, members: [member] };
  }

  async confirmArchiveGroup(input: { group: string; reason?: string }): Promise<ArchivePreview> {
    const preview = await this.archiveGroupPreview(input);
    const members = preview.members.map((member) => {
      if (member.action === "already_archived") return member;
      this.archivePeer(member.peerId, input.reason);
      return { ...member, action: "archived" as const };
    });
    return { target: "group", group: input.group, dryRun: false, members };
  }

  async resumeSessionPreview(input: { peerId: string; print?: boolean; force?: boolean }): Promise<ResumePreview> {
    return {
      target: "session",
      mode: input.print ? "print" : "launch",
      dryRun: true,
      members: [this.mockResumeMember(input.peerId, input.print ? "print" : "launch")],
    };
  }

  async resumeGroupPreview(input: { group: string; print?: boolean; force?: boolean; only?: string[]; exclude?: string[] }): Promise<ResumePreview> {
    const mode = input.print ? "print" : "launch";
    const sessions = this._archivedSessions.get().filter((session) =>
      session.aliases.some((alias) => alias.group === input.group) &&
      (!input.only || input.only.length === 0 || session.aliases.some((alias) => input.only!.includes(alias.alias))) &&
      (!input.exclude || !session.aliases.some((alias) => input.exclude!.includes(alias.alias)))
    );
    return {
      target: "group",
      group: input.group,
      mode,
      dryRun: true,
      members: sessions.map((session) => this.mockResumeMember(session.peerId, mode)),
    };
  }

  async confirmResumeSession(input: { peerId: string; print?: boolean; force?: boolean }): Promise<unknown> {
    this.resumePeer(input.peerId);
    return { ok: true };
  }

  async confirmResumeGroup(input: { group: string; print?: boolean; force?: boolean; only?: string[]; exclude?: string[] }): Promise<unknown> {
    const preview = await this.resumeGroupPreview(input);
    for (const member of preview.members) {
      if (member.action === "will_launch" || member.action === "will_print") this.resumePeer(member.peerId);
    }
    return { ok: true };
  }

  setAgentColor(agentId: string, color: IdentityColorRef | string | null): void {
    const overrides = readIdentityOverrideMap(COLOR_OVERRIDES_KEY);
    if (color === null) {
      delete overrides[agentId];
    } else {
      overrides[agentId] = normalizeIdentityColorRef(color, agentId);
    }
    writeIdentityOverrideMap(COLOR_OVERRIDES_KEY, overrides);
    const fallbackRef = SEEDED_COLOR_REF_BY_ID.get(agentId) ?? identityRefForId(agentId);
    const nextRef = color === null ? fallbackRef : normalizeIdentityColorRef(color, agentId);
    this._agents.update((prev) =>
      prev.map((a) => (a.id === agentId ? { ...a, colorRef: nextRef, color: identityColorCss(nextRef) } : a)),
    );
    // Mirror onto `me` if it's the same agent.
    if (this._me.get().id === agentId) {
      this._me.set({ ...this._me.get(), colorRef: nextRef, color: identityColorCss(nextRef) });
    }
  }

  // Resolve a seed message id into a deep-link target. A main-list message (in
  // MESSAGES) focuses in the chat; a thread reply (in THREAD_REPLIES) opens the
  // thread pane on its parent. This mocks the web projection, not daemon truth.
  async resolveDeepLink(eventId: string): Promise<WebDeepLinkTarget> {
    for (const [roomId, msgs] of Object.entries(MESSAGES)) {
      if (msgs.some((m) => m.id === eventId)) {
        const room = this._rooms.get().find((r) => r.id === roomId);
        return {
          roomId,
          surface: room?.kind === "dm" ? "dm" : "group-main",
          focusMessageId: eventId,
          threadParentId: null,
          linkId: eventId,
          eventId: 0,
        };
      }
    }
    for (const [parentId, replies] of Object.entries(THREAD_REPLIES)) {
      if (!replies.some((m) => m.id === eventId)) continue;
      const parentRoomId = Object.entries(MESSAGES).find(([, msgs]) => msgs.some((m) => m.id === parentId))?.[0];
      if (!parentRoomId) break;
      return {
        roomId: parentRoomId,
        surface: "group-thread",
        focusMessageId: eventId,
        threadParentId: parentId,
        linkId: eventId,
        eventId: 0,
      };
    }
    throw new Error(`deep link target not found: ${eventId}`);
  }

  // Mock holds the whole seed in memory, so there is nothing to hydrate.
  async hydrateDeepLinkTarget(): Promise<void> {}

  async connect(): Promise<void> { /* mock has no live connection */ }
  disconnect(): void { /* noop */ }

  private findGroup(group: string): Room {
    const room = this._rooms.get().find((candidate) => candidate.kind === "group" && (candidate.name === group || candidate.id === group));
    if (!room) throw new Error(`group not found: ${group}`);
    return room;
  }

  private isArchived(peerId: string): boolean {
    return this._archivedSessions.get().some((session) => session.peerId === peerId);
  }

  private mockArchiveMember(peerId: string, action: ArchivePreviewMember["action"]): ArchivePreviewMember {
    const agent = this._agents.get().find((candidate) => candidate.id === peerId);
    return {
      peerId,
      sessionName: agent?.name ?? peerId,
      tool: agent?.role ?? "mock",
      action,
      reaped: false,
      zombie: false,
    };
  }

  private mockResumeMember(peerId: string, mode: "launch" | "print"): ResumePreviewMember {
    const session = this._archivedSessions.get().find((candidate) => candidate.peerId === peerId);
    const agent = this._agents.get().find((candidate) => candidate.id === peerId);
    if (!session) {
      return {
        peerId,
        sessionName: agent?.name ?? peerId,
        alias: null,
        tool: agent?.role ?? "mock",
        group: null,
        cwd: null,
        hostSessionId: null,
        action: "skipped",
        code: "peer_not_archived",
        forceAvailable: false,
        warning: "session is not archived",
      };
    }
    const alias = session.aliases[0];
    return {
      peerId,
      sessionName: session.sessionName,
      alias: alias?.alias ?? session.sessionName,
      tool: session.tool,
      group: alias?.group ?? null,
      cwd: "/mock/synchronize/worktree",
      hostSessionId: `mock-session-${peerId}`,
      action: mode === "print" ? "will_print" : "will_launch",
      forceAvailable: false,
    };
  }

  private archivePeer(peerId: string, reason?: string): void {
    const agent = this._agents.get().find((candidate) => candidate.id === peerId);
    const aliases = this._rooms.get()
      .filter((room) => room.kind === "group" && room.members.includes(peerId))
      .map((room) => ({ group: room.name, alias: room.memberAliases?.[peerId] ?? agent?.handle ?? peerId }));
    if (!this.isArchived(peerId)) {
      this._archivedSessions.update((sessions) => [
        {
          peerId,
          sessionName: agent?.name ?? peerId,
          tool: agent?.role ?? "mock",
          archivedAt: new Date().toISOString(),
          archivedReason: reason ?? null,
          archiveSource: "manual",
          aliases,
        },
        ...sessions,
      ]);
    }
    this._agents.update((agents) => agents.map((candidate) =>
      candidate.id === peerId
        ? {
            ...candidate,
            lifecycleState: "archived",
            status: "offline",
            archivedAt: new Date().toISOString(),
            ...(reason ? { archivedReason: reason } : {}),
            archiveSource: "manual",
          }
        : candidate,
    ));
    this._rooms.update((rooms) => rooms.map((room) => room.kind === "group" ? recalcArchiveRoom({
      ...room,
      members: room.members.filter((id) => id !== peerId),
      memberStates: { ...room.memberStates, [peerId]: "archived" },
      memberAliases: { ...room.memberAliases, [peerId]: room.memberAliases?.[peerId] ?? agent?.handle ?? peerId },
    }) : room));
  }

  private resumePeer(peerId: string): void {
    const session = this._archivedSessions.get().find((candidate) => candidate.peerId === peerId);
    this._archivedSessions.update((sessions) => sessions.filter((candidate) => candidate.peerId !== peerId));
    this._agents.update((agents) => agents.map((candidate) =>
      candidate.id === peerId ? activeAgent(candidate) : candidate,
    ));
    if (!session) return;
    this._rooms.update((rooms) => rooms.map((room) => {
      const alias = session.aliases.find((candidate) => candidate.group === room.name);
      if (!alias || room.kind !== "group") return room;
      return recalcArchiveRoom({
        ...room,
        members: room.members.includes(peerId) ? room.members : [...room.members, peerId],
        memberStates: { ...room.memberStates, [peerId]: "active" },
        memberAliases: { ...room.memberAliases, [peerId]: alias.alias },
      });
    }));
  }
}

function recalcArchiveRoom(room: Room): Room {
  const memberStates = room.memberStates ?? Object.fromEntries(room.members.map((id) => [id, "active"]));
  const archivedMemberCount = Object.values(memberStates).filter((state) => state === "archived").length;
  const activeMemberCount = room.members.length;
  return {
    ...room,
    activeMemberCount,
    archivedMemberCount,
    archiveState: archivedMemberCount > 0 ? (activeMemberCount > 0 ? "mixed" : "archived") : "active",
  };
}

function activeAgent(agent: Agent): Agent {
  const { archivedAt: _archivedAt, archivedReason: _archivedReason, archiveSource: _archiveSource, ...rest } = agent;
  return { ...rest, lifecycleState: "active", status: "idle" };
}

function activityScopeKey(item: Pick<ActivityItem, "roomId" | "threadParentId" | "msgId">): string {
  return `${item.roomId}:${item.threadParentId ?? item.msgId}`;
}

function activityRepresentativeKey(item: Pick<ActivityItem, "roomId" | "threadParentId" | "msgId" | "actorId">): string {
  return `${activityScopeKey(item)}:${item.actorId}`;
}

// Aggregate the seed into a global, newest-first Activity feed — the in-memory
// analogue of the daemon's observer feed. Awaiting follows the same interaction
// shape as the daemon: agent-authored group messages after the local user's
// latest message/reaction in the same thread. Activity shows one representative
// row per actor within a thread, so repeated agent replies don't crowd out the
// actual set of active threads.
function buildMockActivity(meId: string): ActivityItem[] {
  const dmRoomIds = new Set(DMS.map((dm) => dm.id));
  const agentIds = new Set(AGENTS.filter((agent) => agent.id !== meId).map((agent) => agent.id));
  const all: Message[] = [];
  for (const list of Object.values(MESSAGES)) all.push(...list);
  for (const list of Object.values(THREAD_REPLIES)) all.push(...list);

  const seen = new Set<string>();
  const chronological = all
    .filter((message) => {
      if (seen.has(message.id)) return false;
      seen.add(message.id);
      return Boolean(message.roomId);
    })
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const lastInteractionAt = new Map<string, number>();
  const candidates: Array<{ message: Message; awaiting: boolean; isMention: boolean }> = [];
  for (const message of chronological) {
    const isDm = dmRoomIds.has(message.roomId);
    const scope = `${message.roomId}:${message.parentId ?? message.id}`;
    const timestamp = Date.parse(message.createdAt);
    const hasSelfReaction = message.reactions.some((reaction) => reaction.by.includes(meId));
    if (message.authorId === meId && !isDm) {
      lastInteractionAt.set(scope, timestamp);
      continue;
    }
    if (message.authorId === meId) continue; // exclude own sends
    const isMention = message.mentions.includes(meId) || /@you\b/i.test(message.body);
    const awaiting =
      !isDm &&
      agentIds.has(message.authorId) &&
      !hasSelfReaction &&
      timestamp > (lastInteractionAt.get(scope) ?? Number.NEGATIVE_INFINITY);
    candidates.push({ message, awaiting, isMention });
    if (hasSelfReaction && !isDm) lastInteractionAt.set(scope, timestamp);
  }
  // Oldest-first to assign monotonic event ids before collapsing. That mirrors
  // daemon event ids: hidden older rows leave gaps, but ordering stays truthful.
  candidates.sort((a, b) => Date.parse(a.message.createdAt) - Date.parse(b.message.createdAt));
  const representatives = new Map<string, ActivityItem>();
  for (const [index, entry] of candidates.entries()) {
    const { message } = entry;
    const item: ActivityItem = {
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
    representatives.set(activityRepresentativeKey(item), item);
  }
  return [...representatives.values()].sort((a, b) => b.eventId - a.eventId);
}
