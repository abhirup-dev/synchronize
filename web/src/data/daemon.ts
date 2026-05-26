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
  TimelineEventType,
} from "./types.ts";
import { createSnapshot, type MutableSnapshot } from "./store.ts";

export interface DaemonDataSourceOptions {
  baseUrl?: string;
  token?: string;
  pollMs?: number;
  stateLimit?: number;
}

interface DaemonPeer {
  peer_id: string;
  tool: string;
  session_name: string;
  purpose: string | null;
  lease_expires_at: string;
  online?: boolean;
}

interface DaemonGroup {
  group_id: number;
  name: string;
  durable: boolean;
  description: string | null;
  created_at: string;
}

interface DaemonMember {
  group_id: number;
  peer_id: string;
  alias: string;
  active: boolean;
  purpose: string | null;
  session_name: string;
  tool: string;
  online?: boolean;
}

interface DaemonEvent {
  event_id: number;
  type: string;
  sender_peer_id: string | null;
  recipient_peer_id: string | null;
  group_id: number | null;
  body: string | null;
  media_id: string | null;
  parent_event_id: number | null;
  mentions_json: string | null;
  created_at: string;
  reply_count?: number;
  last_reply_event_id?: number | null;
  delivered_count?: number;
  read_count?: number;
  acked_count?: number;
}

interface DaemonMedia {
  media_id: string;
  group_id: number;
  original_path: string;
  content_type: string;
  description: string | null;
  shared_by_peer_id: string;
  created_at: string;
}

interface WebStateResponse {
  ok: true;
  cursor: number;
  peers: DaemonPeer[];
  groups: DaemonGroup[];
  memberships: DaemonMember[];
  room_summaries: Array<{
    group_id: number;
    last_event_id: number | null;
    last_event_at: string | null;
    last_preview: string | null;
    message_count: number;
  }>;
  events: DaemonEvent[];
  media: DaemonMedia[];
}

interface WebStateChange {
  cursor: number;
  type: "connected" | "state_changed";
  domains: string[];
  event_id?: number;
  group_id?: number | null;
  peer_id?: string | null;
}

const PEER_KEY = "synchronize.web.peerId";
const PENDING_WEB_PEER_ID = "web:pending";
const COLORS = ["#FFD23F", "#FF5DA2", "#4D7CFE", "#7BE389", "#FF8A3D", "#B49BFF", "#F45B69", "#2EC4B6"];
const EMPTY_AGENT: Agent = {
  id: "web:pending",
  name: "Web",
  handle: "web",
  color: "#111111",
  role: "web",
  status: "online",
  avatar: "W",
};

export class DaemonDataSource implements DataSource {
  readonly kind = "daemon" as const;

  private readonly baseUrl: string;
  private readonly pollMs: number;
  private readonly stateLimit: number;
  private readonly _agents = createSnapshot<Agent[]>([EMPTY_AGENT]);
  private readonly _rooms = createSnapshot<Room[]>([]);
  private readonly _me = createSnapshot<Agent>(EMPTY_AGENT);
  private readonly _messages = new Map<string, MutableSnapshot<Message[]>>();
  private readonly _threadReplies = new Map<string, MutableSnapshot<Message[]>>();
  private readonly _timeline = new Map<string, MutableSnapshot<TimelineEvent[]>>();
  private readonly _tasks = new Map<string, MutableSnapshot<Task[]>>();
  private readonly _artifacts = new Map<string, MutableSnapshot<Artifact[]>>();
  private readonly threadReplyCache = new Map<string, Message[]>();
  private readonly threadParentRoom = new Map<string, string>();
  private groupNameByRoomId = new Map<string, string>();
  private roomCursor = new Map<string, number>();
  private pendingRooms = new Set<string>();
  private connected = false;
  private refreshing: Promise<void> | null = null;
  private roomRefreshes = new Map<string, Promise<void>>();
  private coalesceTimer: number | undefined;
  private pollTimer: number | undefined;
  private streamAbort: AbortController | undefined;
  private readonly token: string | undefined;
  private peerId: string;

  constructor(opts: DaemonDataSourceOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? window.location.origin).replace(/\/$/, "");
    this.token = opts.token || undefined;
    this.pollMs = opts.pollMs ?? 2_000;
    this.stateLimit = opts.stateLimit ?? 500;
    this.peerId = PENDING_WEB_PEER_ID;
  }

  agents(): Snapshot<Agent[]> { return this._agents; }
  rooms(): Snapshot<Room[]> { return this._rooms; }
  me(): Snapshot<Agent> { return this._me; }

  messages(roomId: string): Snapshot<Message[]> {
    let snap = this._messages.get(roomId);
    if (!snap) {
      snap = createSnapshot<Message[]>([]);
      this._messages.set(roomId, snap);
      if (this.connected) void this.refreshRoom(roomId, { reset: true });
    }
    return snap;
  }

  threadReplies(parentId: string): Snapshot<Message[]> {
    let snap = this._threadReplies.get(parentId);
    if (!snap) {
      snap = createSnapshot<Message[]>(this.threadReplyCache.get(parentId) ?? []);
      this._threadReplies.set(parentId, snap);
    }
    return snap;
  }

  timeline(roomId: string): Snapshot<TimelineEvent[]> {
    let snap = this._timeline.get(roomId);
    if (!snap) {
      snap = createSnapshot<TimelineEvent[]>([]);
      this._timeline.set(roomId, snap);
      if (this.connected) void this.refreshRoom(roomId, { reset: true });
    }
    return snap;
  }

  tasks(roomId: string): Snapshot<Task[]> {
    let snap = this._tasks.get(roomId);
    if (!snap) {
      snap = createSnapshot<Task[]>([]);
      this._tasks.set(roomId, snap);
    }
    return snap;
  }

  artifacts(roomId: string): Snapshot<Artifact[]> {
    let snap = this._artifacts.get(roomId);
    if (!snap) {
      snap = createSnapshot<Artifact[]>([]);
      this._artifacts.set(roomId, snap);
    }
    return snap;
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    this.connected = true;
    await this.registerWebPeer();
    await this.refresh();
    this.openStream();
    this.pollTimer = window.setInterval(() => {
      void this.refresh();
      for (const roomId of this._messages.keys()) void this.refreshRoom(roomId);
    }, this.pollMs);
  }

  disconnect(): void {
    this.connected = false;
    if (this.pollTimer !== undefined) window.clearInterval(this.pollTimer);
    this.streamAbort?.abort();
  }

  async sendMessage(input: SendMessageInput): Promise<Message> {
    const body = input.body.trim();
    if (!body) throw new Error("message body is required");
    const inReplyTo = input.parentMessageId ? eventIdFromMessageId(input.parentMessageId) : undefined;
    const optimistic = this.addOptimisticMessage(input, body);
    if (input.roomId.startsWith("group:")) {
      const name = this.groupNameByRoomId.get(input.roomId);
      if (!name) {
        this.removeOptimistic(input, optimistic.id);
        throw new Error(`Unknown group room: ${input.roomId}`);
      }
      try {
        const response = await this.request<{ event: DaemonEvent }>(`/groups/${encodeURIComponent(name)}/messages`, {
          method: "POST",
          body: JSON.stringify({
            sender_peer_id: this.peerId,
            message: body,
            ...(inReplyTo !== undefined ? { in_reply_to: inReplyTo } : {}),
          }),
        });
        const delivered = mapMessage(response.event, input.roomId, "delivered");
        this.replaceOptimistic(input, optimistic.id, delivered);
        await this.refreshRoom(input.roomId);
        return delivered;
      } catch (error) {
        this.removeOptimistic(input, optimistic.id);
        throw error;
      }
    }

    const recipientPeerId = input.roomId.startsWith("dm:") ? input.roomId.slice(3) : undefined;
    if (!recipientPeerId) {
      this.removeOptimistic(input, optimistic.id);
      throw new Error(`Unknown DM room: ${input.roomId}`);
    }
    try {
      const response = await this.request<{ event: DaemonEvent }>("/dm", {
        method: "POST",
        body: JSON.stringify({
          sender_peer_id: this.peerId,
          recipient_peer_id: recipientPeerId,
          message: body,
        }),
      });
      const delivered = mapMessage(response.event, input.roomId, "delivered");
      this.replaceOptimistic(input, optimistic.id, delivered);
      await this.refreshRoom(input.roomId);
      return delivered;
    } catch (error) {
      this.removeOptimistic(input, optimistic.id);
      throw error;
    }
  }

  setAgentColor(agentId: string, hex: string | null): void {
    const key = `synchronize.agentColor.${agentId}`;
    if (hex) localStorage.setItem(key, hex);
    else localStorage.removeItem(key);
    this._agents.update((prev) => prev.map((agent) => agent.id === agentId ? { ...agent, color: colorForPeer(agentId) } : agent));
  }

  private async registerWebPeer(): Promise<void> {
    const result = await this.request<{ peer: DaemonPeer }>("/web/session", { method: "POST" });
    this.peerId = result.peer.peer_id;
    localStorage.setItem(PEER_KEY, this.peerId);
  }

  private addOptimisticMessage(input: SendMessageInput, body: string): Message {
    const message: Message = {
      id: `optimistic:${crypto.randomUUID()}`,
      roomId: input.roomId,
      authorId: this.peerId,
      body,
      createdAt: new Date().toISOString(),
      mentions: input.mentions,
      reactions: [],
      status: "queued",
      ...(input.parentMessageId ? { parentId: input.parentMessageId } : {}),
    };
    const snap = input.parentMessageId ? this._threadReplies.get(input.parentMessageId) : this._messages.get(input.roomId);
    snap?.set([...snap.get(), message]);
    return message;
  }

  private replaceOptimistic(input: SendMessageInput, optimisticId: string, delivered: Message): void {
    const snap = input.parentMessageId ? this._threadReplies.get(input.parentMessageId) : this._messages.get(input.roomId);
    snap?.set(snap.get().map((message) => message.id === optimisticId ? delivered : message));
  }

  private removeOptimistic(input: SendMessageInput, optimisticId: string): void {
    const snap = input.parentMessageId ? this._threadReplies.get(input.parentMessageId) : this._messages.get(input.roomId);
    snap?.set(snap.get().filter((message) => message.id !== optimisticId));
  }

  private async refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      let state = await this.request<WebStateResponse>(`/web/state?limit=${this.stateLimit}&peer_id=${encodeURIComponent(this.peerId)}`);
      if (await this.ensureWebPeerMemberships(state)) {
        state = await this.request<WebStateResponse>(`/web/state?limit=${this.stateLimit}&peer_id=${encodeURIComponent(this.peerId)}`);
      }
      this.applySummaryState(state);
    })().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async ensureWebPeerMemberships(state: WebStateResponse): Promise<boolean> {
    if (state.groups.length === 0) return false;
    const activeGroupIds = new Set(
      state.memberships
        .filter((member) => member.peer_id === this.peerId && member.active)
        .map((member) => member.group_id),
    );
    const missing = state.groups.filter((group) => !activeGroupIds.has(group.group_id));
    if (missing.length === 0) return false;
    await Promise.all(missing.map((group) =>
      this.request(`/groups/${encodeURIComponent(group.name)}/join`, {
        method: "POST",
        body: JSON.stringify({
          peer_id: this.peerId,
          alias: "you",
          fresh: false,
        }),
      }),
    ));
    return true;
  }

  private applySummaryState(state: WebStateResponse): void {
    const peerById = new Map(state.peers.map((peer) => [peer.peer_id, peer] as const));
    const memberByGroup = groupMembersByGroup(state.memberships);
    const summaryByGroup = new Map(state.room_summaries.map((summary) => [summary.group_id, summary] as const));
    const agents = agentsFromState(state, this.peerId);
    const me = agents.find((agent) => agent.id === this.peerId) ?? mapAgent(peerById.get(this.peerId) ?? {
      peer_id: this.peerId,
      tool: "web",
      session_name: "web-ui",
      purpose: "local human web participant",
      lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
      online: true,
    }, this.peerId);

    const groupRooms = state.groups.map((group) => {
      const members = memberByGroup.get(group.group_id) ?? [];
      const roomId = groupRoomId(group.group_id);
      this.groupNameByRoomId.set(roomId, group.name);
      const summary = summaryByGroup.get(group.group_id);
      return {
        id: roomId,
        kind: "group" as const,
        name: group.name,
        emoji: "#",
        color: colorForGroup(group.group_id),
        members: members.map((member) => member.peer_id),
        memberAliases: Object.fromEntries(members.map((member) => [member.peer_id, member.alias])),
        ...(group.description ? { description: group.description } : {}),
        lastPreview: summary?.last_preview ?? "no activity yet",
        unread: 0,
      } satisfies Room;
    });
    const dmRooms = state.peers
      .filter((peer) => peer.peer_id !== this.peerId)
      .map((peer) => {
        return {
          id: dmRoomId(peer.peer_id),
          kind: "dm" as const,
          name: peer.session_name,
          color: colorForPeer(peer.peer_id),
          members: [this.peerId, peer.peer_id],
          peerId: peer.peer_id,
          lastPreview: "open direct message",
          unread: 0,
        } satisfies Room;
      });

    this._agents.set(reuseEqualAgents(this._agents.get(), agents));
    this._me.set(me);
    this._rooms.set(reuseEqualRooms(this._rooms.get(), [...groupRooms, ...dmRooms]));
  }

  private async refreshRoom(roomId: string, opts: { reset?: boolean } = {}): Promise<void> {
    const existing = this.roomRefreshes.get(roomId);
    if (existing) return existing;
    const since = opts.reset ? 0 : this.roomCursor.get(roomId) ?? 0;
    const promise = this.request<WebStateResponse>(
      `/web/state?room=${encodeURIComponent(roomId)}&since=${since}&limit=${this.stateLimit}&peer_id=${encodeURIComponent(this.peerId)}`,
    )
      .then((state) => this.applyRoomState(roomId, state, { append: !opts.reset && since > 0 }))
      .finally(() => {
        this.roomRefreshes.delete(roomId);
      });
    this.roomRefreshes.set(roomId, promise);
    return promise;
  }

  private applyRoomState(roomId: string, state: WebStateResponse, opts: { append: boolean }): void {
    const peerById = new Map(state.peers.map((peer) => [peer.peer_id, peer] as const));
    const groupById = new Map(state.groups.map((group) => [group.group_id, group] as const));
    const groupedMessages = new Map<string, Message[]>();
    const groupedReplies = new Map<string, Message[]>();
    const timelines = new Map<string, TimelineEvent[]>();
    for (const event of state.events) {
      if (event.type === "group_message" && event.group_id !== null) {
        const roomId = groupRoomId(event.group_id);
        const message = mapMessage(event, roomId, statusForEvent(event, this.peerId));
        if (event.parent_event_id) pushMap(groupedReplies, messageId(event.parent_event_id), message);
        else pushMap(groupedMessages, roomId, message);
      } else if (event.type === "dm" && event.recipient_peer_id && event.sender_peer_id) {
        const other = event.sender_peer_id === this.peerId ? event.recipient_peer_id : event.sender_peer_id;
        pushMap(groupedMessages, dmRoomId(other), mapMessage(event, dmRoomId(other), statusForEvent(event, this.peerId)));
      } else if (event.group_id !== null) {
        pushMap(timelines, groupRoomId(event.group_id), mapTimelineEvent(event, groupById, peerById));
      }
    }
    this.roomCursor.set(roomId, state.cursor);
    const nextMessages = groupedMessages.get(roomId) ?? [];
    const currentMessages = this._messages.get(roomId)?.get() ?? [];
    this._messages.get(roomId)?.set(opts.append ? mergeMessages(currentMessages, nextMessages) : nextMessages);
    this._timeline.get(roomId)?.set(opts.append ? mergeTimeline(this._timeline.get(roomId)?.get() ?? [], timelines.get(roomId) ?? []) : timelines.get(roomId) ?? []);
    if (!opts.append) {
      for (const [parentId, parentRoomId] of this.threadParentRoom) {
        if (parentRoomId !== roomId) continue;
        this.threadReplyCache.delete(parentId);
        this.threadParentRoom.delete(parentId);
        this._threadReplies.get(parentId)?.set([]);
      }
    }
    for (const [parentId, replies] of groupedReplies) {
      this.threadParentRoom.set(parentId, roomId);
      const previous = this.threadReplyCache.get(parentId) ?? [];
      const next = opts.append ? mergeMessages(previous, replies) : replies;
      this.threadReplyCache.set(parentId, next);
      const snap = this._threadReplies.get(parentId);
      if (!snap) continue;
      snap.set(next);
    }
    this.updateThreadSummaries(roomId, groupedReplies.keys());

    const artifactsByRoom = new Map<string, Artifact[]>();
    for (const item of state.media) {
      pushMap(artifactsByRoom, groupRoomId(item.group_id), {
        id: item.media_id,
        roomId: groupRoomId(item.group_id),
        kind: artifactKind(item.content_type, item.original_path),
        title: item.description ?? item.original_path.split("/").at(-1) ?? item.media_id,
        byAgentId: item.shared_by_peer_id,
        createdAt: item.created_at,
      });
    }
    this._artifacts.get(roomId)?.set(artifactsByRoom.get(roomId) ?? []);
  }

  private updateThreadSummaries(roomId: string, parentIds: Iterable<string>): void {
    const snapshot = this._messages.get(roomId);
    if (!snapshot) return;
    const ids = [...parentIds];
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const nextMessages = snapshot.get().map((message) => {
      if (!idSet.has(message.id)) return message;
      const replies = this.threadReplyCache.get(message.id) ?? [];
      if (replies.length === 0) return message;
      const participantIds = [...new Set(replies.map((reply) => reply.authorId))];
      const lastReply = replies[replies.length - 1];
      return {
        ...message,
        threadReplyCount: Math.max(message.threadReplyCount ?? 0, replies.length),
        ...(lastReply ? { threadLastReplyAt: lastReply.createdAt } : {}),
        threadParticipantIds: participantIds,
      };
    });
    snapshot.set(reuseEqualMessages(snapshot.get(), nextMessages));
  }

  private openStream(): void {
    this.streamAbort?.abort();
    this.streamAbort = new AbortController();
    void this.readSse(this.streamAbort.signal).catch(() => {
      if (!this.connected) return;
      window.setTimeout(() => this.openStream(), this.pollMs);
    });
  }

  private async readSse(signal: AbortSignal): Promise<void> {
    const response = await this.requestRaw("/web/events", { signal });
    if (!response.ok || !response.body) throw new Error(`SSE failed: ${response.status}`);
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const change = parseSseChange(raw);
        if (change?.type === "state_changed") this.scheduleInvalidation(change);
      }
    }
  }

  private scheduleInvalidation(change: WebStateChange): void {
    if (change.group_id) this.pendingRooms.add(groupRoomId(change.group_id));
    if (change.peer_id) {
      const dmId = dmRoomId(change.peer_id);
      if (this._messages.has(dmId)) this.pendingRooms.add(dmId);
    }
    if (this.coalesceTimer !== undefined) window.clearTimeout(this.coalesceTimer);
    this.coalesceTimer = window.setTimeout(() => {
      this.coalesceTimer = undefined;
      void this.refresh();
      for (const roomId of this.pendingRooms) {
        if (this._messages.has(roomId) || this._timeline.has(roomId)) void this.refreshRoom(roomId);
      }
      this.pendingRooms.clear();
    }, 50);
  }

  private request<T>(path: string, init: RequestInit = {}): Promise<T> {
    return this.requestRaw(path, init).then(async (response) => {
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error?.message ?? `${response.status} ${response.statusText}`);
      return body as T;
    });
  }

  private requestRaw(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("accept", path === "/web/events" ? "text/event-stream" : "application/json");
    if (init.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
    if (this.token) headers.set("authorization", `Bearer ${this.token}`);
    return fetch(`${this.baseUrl}${path}`, { ...init, headers });
  }
}

function agentsFromState(state: WebStateResponse, mePeerId: string): Agent[] {
  const peers = new Map<string, DaemonPeer>();
  for (const peer of state.peers) peers.set(peer.peer_id, peer);
  for (const member of state.memberships) {
    if (peers.has(member.peer_id)) continue;
    peers.set(member.peer_id, {
      peer_id: member.peer_id,
      tool: member.tool,
      session_name: member.session_name,
      purpose: member.purpose,
      lease_expires_at: "",
      online: Boolean(member.online),
    });
  }
  return [...peers.values()].map((peer) => mapAgent(peer, mePeerId));
}

function mapAgent(peer: DaemonPeer, mePeerId: string): Agent {
  const isMe = peer.peer_id === mePeerId;
  const name = isMe ? "You" : peer.session_name;
  return {
    id: peer.peer_id,
    name,
    handle: isMe ? "you" : handleFor(peer),
    color: colorForPeer(peer.peer_id),
    role: peer.tool,
    status: isMe || peer.online ? "online" : "offline",
    ...(peer.purpose ? { statusNote: peer.purpose } : {}),
    avatar: (name.trim()[0] ?? "?").toUpperCase(),
  };
}

function mapMessage(event: DaemonEvent, roomId: string, status?: Message["status"]): Message {
  return {
    id: messageId(event.event_id),
    roomId,
    authorId: event.sender_peer_id ?? "system",
    body: event.body ?? "",
    createdAt: event.created_at,
    mentions: parseMentions(event.mentions_json),
    reactions: [],
    ...(event.reply_count !== undefined && event.reply_count > 0 ? { threadReplyCount: event.reply_count } : {}),
    ...(event.last_reply_event_id ? { threadLastReplyAt: event.created_at } : {}),
    ...(event.parent_event_id ? { parentId: messageId(event.parent_event_id) } : {}),
    ...(status ? { status } : {}),
  };
}

function mapTimelineEvent(event: DaemonEvent, groupById: Map<number, DaemonGroup>, peerById: Map<string, DaemonPeer>): TimelineEvent {
  const agentId = event.sender_peer_id ?? "system";
  return {
    id: messageId(event.event_id),
    roomId: event.group_id === null ? "" : groupRoomId(event.group_id),
    type: timelineType(event.type),
    agentId,
    label: timelineLabel(event, groupById, peerById),
    createdAt: event.created_at,
  };
}

function timelineType(type: string): TimelineEventType {
  if (type === "group_created" || type === "group_joined") return "kickoff";
  if (type === "group_left") return "alert";
  if (type === "media_shared") return "deliver";
  if (type === "group_member_renamed" || type === "group_member_alias_reclaimed") return "review";
  return "request";
}

function timelineLabel(event: DaemonEvent, groupById: Map<number, DaemonGroup>, peerById: Map<string, DaemonPeer>): string {
  const actor = event.sender_peer_id ? peerById.get(event.sender_peer_id)?.session_name ?? event.sender_peer_id : "system";
  const group = event.group_id ? groupById.get(event.group_id)?.name : undefined;
  if (event.type === "group_created") return `${actor} created #${group ?? event.group_id}`;
  if (event.type === "group_joined") return `${actor} joined #${group ?? event.group_id}`;
  if (event.type === "group_left") return `${actor} left #${group ?? event.group_id}`;
  if (event.type === "media_shared") return `${actor} shared media`;
  if (event.type === "group_member_renamed") return `${actor} renamed their alias`;
  if (event.type === "group_member_alias_reclaimed") return `${actor} reclaimed an alias`;
  return event.type;
}

function parseSseChange(raw: string): WebStateChange | null {
  const data = raw.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
  if (!data) return null;
  try {
    return JSON.parse(data) as WebStateChange;
  } catch {
    return null;
  }
}

function parseMentions(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function groupMembersByGroup(memberships: DaemonMember[]): Map<number, DaemonMember[]> {
  const grouped = new Map<number, DaemonMember[]>();
  for (const member of memberships) pushMap(grouped, member.group_id, member);
  return grouped;
}

function latestEventForGroup(events: DaemonEvent[], groupId: number): DaemonEvent | undefined {
  return [...events].reverse().find((event) => event.group_id === groupId && event.parent_event_id === null);
}

function latestDmForPeer(events: DaemonEvent[], me: string, peer: string): DaemonEvent | undefined {
  return [...events].reverse().find((event) =>
    event.type === "dm" &&
    ((event.sender_peer_id === me && event.recipient_peer_id === peer) ||
     (event.sender_peer_id === peer && event.recipient_peer_id === me)),
  );
}

function previewForEvent(event: DaemonEvent | undefined): string {
  if (!event) return "no activity yet";
  if (event.type === "group_message" || event.type === "dm") return event.body ?? "";
  return event.type.replaceAll("_", " ");
}

function statusForEvent(event: DaemonEvent, me: string): Message["status"] | undefined {
  if (event.sender_peer_id !== me) return undefined;
  if ((event.acked_count ?? 0) > 0) return "read";
  if ((event.delivered_count ?? 0) > 0 || event.type === "group_message") return "delivered";
  return "queued";
}

function handleFor(peer: DaemonPeer): string {
  return peer.session_name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || peer.peer_id.slice(0, 8);
}

function colorForPeer(peerId: string): string {
  const override = localStorage.getItem(`synchronize.agentColor.${peerId}`);
  if (override) return override;
  return COLORS[hashString(peerId) % COLORS.length] ?? COLORS[0]!;
}

function colorForGroup(groupId: number): string {
  return COLORS[groupId % COLORS.length] ?? COLORS[0]!;
}

function groupRoomId(groupId: number): string {
  return `group:${groupId}`;
}

function dmRoomId(peerId: string): string {
  return `dm:${peerId}`;
}

function messageId(eventId: number): string {
  return `e:${eventId}`;
}

function eventIdFromMessageId(id: string): number {
  const parsed = Number.parseInt(id.replace(/^e:/, ""), 10);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`Invalid message id: ${id}`);
  return parsed;
}

function artifactKind(contentType: string, path: string): Artifact["kind"] {
  if (contentType.startsWith("image/")) return "img";
  if (path.endsWith(".diff") || path.endsWith(".patch")) return "diff";
  if (path.endsWith(".tf")) return "tf";
  if (path.endsWith(".log")) return "log";
  if (path.endsWith(".md") || path.endsWith(".txt") || path.endsWith(".pdf")) return "doc";
  if (path.endsWith(".json") || path.endsWith(".ts") || path.endsWith(".tsx") || path.endsWith(".js")) return "code";
  return "doc";
}

function pushMap<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}

function mergeMessages(prev: Message[], next: Message[]): Message[] {
  if (next.length === 0) return prev;
  const byId = new Map(prev.map((item) => [item.id, item] as const));
  for (const item of next) byId.set(item.id, item);
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

function mergeTimeline(prev: TimelineEvent[], next: TimelineEvent[]): TimelineEvent[] {
  if (next.length === 0) return prev;
  const byId = new Map(prev.map((item) => [item.id, item] as const));
  for (const item of next) byId.set(item.id, item);
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return hash;
}

function reuseEqualAgents(prev: Agent[], next: Agent[]): Agent[] {
  return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
}

function reuseEqualRooms(prev: Room[], next: Room[]): Room[] {
  return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
}

function reuseEqualMessages(prev: Message[], next: Message[]): Message[] {
  return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
}
