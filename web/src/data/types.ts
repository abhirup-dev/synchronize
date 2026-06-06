// Single typed contract every UI component reads from. Two adapters implement
// it: MockDataSource (in-memory seed) and DaemonDataSource (REST + SSE/polling
// against the synchronize daemon). Components never see either directly — they
// go through the hooks in ./context.tsx.

export type AgentStatus = "online" | "busy" | "idle" | "offline";

export interface Agent {
  id: string;
  name: string;
  handle: string;
  color: string;
  role: string;
  status: AgentStatus;
  statusNote?: string;
  launchLifecycle?: {
    launchId: string;
    state: string;
    targetGroup?: string;
    failureCode?: string;
    failureMessage?: string;
  };
  aoeSession?: {
    profile: string;
    title: string;
    attachCommand: string;
  };
  avatar: string; // single uppercase letter
}

export type RoomKind = "group" | "dm";

export interface GroupPath {
  id: string;
  path: string;
  label?: string;
}

export interface Room {
  id: string;
  kind: RoomKind;
  name: string;
  emoji?: string;
  color: string;
  members: string[]; // agent ids; for DMs always [you, other]
  memberAliases?: Record<string, string>; // group-scoped peer_id -> alias
  paths?: GroupPath[]; // group-scoped launch paths
  description?: string;
  lastPreview?: string;
  unread: number;
  pinned?: boolean;
  // For DMs only
  peerId?: string;
  launchTools?: Partial<Record<AgentLaunchTool, LaunchToolAvailability>>;
}

export type MessageStatus = "queued" | "delivered" | "read";

export interface Message {
  id: string;
  roomId: string;
  authorId: string;
  body: string; // markdown
  createdAt: string; // ISO
  mentions: string[];
  reactions: Reaction[];
  attachments?: MessageAttachment[];
  threadReplyCount?: number;
  threadLastReplyAt?: string;
  threadParticipantIds?: string[];
  status?: MessageStatus;
  parentId?: string; // when this is a thread reply
  poll?: Poll;
}

export interface PollOption {
  id: string;
  label: string;
  icon?: string;
  voters: string[]; // agent ids who voted
}
export interface Poll {
  question: string;
  options: PollOption[];
  closesAt?: string; // ISO
  eligible: string[]; // agent ids who can vote
}

export interface Reaction {
  emoji: string;
  by: string[]; // agent ids
}

export type MessageAttachmentKind = "image" | "file";
export type MessageAttachmentSource = "external" | "staged";

export interface MessageAttachment {
  id: string;
  kind: MessageAttachmentKind;
  source: MessageAttachmentSource;
  name: string;
  mimeType: string;
  size: number;
  extension: string;
  path: string;
  previewUrl?: string;
}

export type TimelineEventType =
  | "claim"
  | "analyze"
  | "deliver"
  | "ship"
  | "review"
  | "alert"
  | "kickoff"
  | "request";

export interface TimelineEvent {
  id: string;
  roomId: string;
  type: TimelineEventType;
  agentId: string;
  label: string;
  createdAt: string;
  messageId?: string;
}

export type TaskStatus = "backlog" | "doing" | "review" | "shipped";
export type TaskPriority = "high" | "med" | "low";

export interface Task {
  id: string;
  roomId: string;
  title: string;
  status: TaskStatus;
  assigneeId?: string;
  reviewerIds: string[];
  progress?: number; // 0-100
  priority?: TaskPriority; // drives the card's priority chip color
  tag?: string; // free-form category label, e.g. "BACKEND" / "FRONTEND"
}

export type ArtifactKind = "img" | "code" | "doc" | "diff" | "tf" | "log" | "chart";

export interface Artifact {
  id: string;
  roomId: string;
  kind: ArtifactKind;
  title: string;
  byAgentId: string;
  createdAt: string;
}

// LLM-generated thread summary. The daemon (bd sync-b8q) computes this once per
// cold thread and exposes it via `GET /threads/:root_event_id/summary`, which
// returns `{ summary, status: "ready"|"pending"|"disabled" }`. The DaemonDataSource
// maps that onto the shape below: "ready" -> "ok" (with text), "pending" while the
// worker is still computing, "disabled" when the feature is off (no API key) or the
// id can't be resolved. The UI shows the summary only when status is "ok"; for
// "pending"/"disabled" it falls back to a generated headline ("N replies from M
// agents"). The MockDataSource only ever emits "ok"/"disabled".
export type ThreadSummaryStatus = "ok" | "pending" | "disabled";

export interface ThreadSummary {
  /** The summary prose, or null when unavailable. */
  text: string | null;
  status: ThreadSummaryStatus;
}

// ─── Activity feed ─────────────────────────────────────────────────────────

// One row in the global, cross-room Activity feed. Derived from real events
// (the daemon's per-peer inbox ⋈ events; the mock aggregates the seed the same
// way). `type` is a single generic kind for now but is kept as a free string so
// future work-event categories (claim/deliver/ship/…) slot in as pure data via
// the client's `actMeta(type)` map — no structural change. `awaiting` is the
// server-authoritative "awaiting you" signal (inbox.acked_at IS NULL); `react`,
// `reply`, and "mark all handled" clear it. `isMention`/`threadParentId` are
// derived flags driving the Mentions filter and whether the thread pane opens
// on an existing parent or on the row's own single-message root.
export interface ActivityItem {
  id: string; // stable row id (encodes the event id)
  eventId: number; // numeric cursor key (newest-first)
  roomId: string; // group or dm room id
  actorId: string; // sender agent id
  type: string; // forward-compat kind; one generic value today
  text: string; // markdown body / preview
  createdAt: string; // ISO
  awaiting: boolean; // inbox.acked_at IS NULL
  isMention: boolean; // mentions include me
  threadParentId?: string; // set when this is a thread reply; otherwise msgId is the thread root
  replyCount?: number;
  msgId: string; // target for jump-to-message
  isNew?: boolean; // transient: just arrived via SSE (drives the flash)
}

// ─── Snapshot contract ─────────────────────────────────────────────────────

export interface Snapshot<T> {
  get(): T;
  subscribe(listener: () => void): () => void;
}

// ─── DataSource ────────────────────────────────────────────────────────────

export interface SendMessageInput {
  roomId: string;
  body: string;
  mentions: string[];
  attachments?: MessageAttachment[];
  parentMessageId?: string;
  skillDirectives?: string[];
}

export interface StageAttachmentInput {
  file: File;
  previewUrl?: string;
  sourceHint: "clipboard" | "picker";
}

export interface ReactToMessageInput {
  messageId: string;
  roomId: string;
  emoji: string;
  op?: "add" | "remove" | "toggle";
}

export type AgentLaunchTool = "claude" | "pi";

export interface SkillCatalogEntry {
  id: string;
  name: string;
  description: string;
  runtimes: AgentLaunchTool[];
  sourcePath?: string;
}

export interface LaunchToolAvailability {
  tool: AgentLaunchTool;
  available: boolean;
  path?: string;
}

export interface SpawnAgentInput {
  roomId: string;
  tool: AgentLaunchTool;
  name: string;
  path: string;
  model: string;
  thinking?: string;
}

export interface SpawnAgentResult {
  peerId: string;
  sessionName: string;
  title: string;
  group: string;
}

export interface DataSource {
  // queries
  rooms(): Snapshot<Room[]>;
  agents(): Snapshot<Agent[]>;
  messages(roomId: string): Snapshot<Message[]>;
  threadReplies(parentMessageId: string): Snapshot<Message[]>;
  timeline(roomId: string): Snapshot<TimelineEvent[]>;
  tasks(roomId: string): Snapshot<Task[]>;
  artifacts(roomId: string): Snapshot<Artifact[]>;
  /** Summary for a thread, keyed by its parent (root) message id. Integration
   *  seam for bd sync-b8q — see {@link ThreadSummary}. */
  threadSummary(parentMessageId: string): Snapshot<ThreadSummary>;
  skillCatalog(): Snapshot<SkillCatalogEntry[]>;
  me(): Snapshot<Agent>;
  /** Global cross-room Activity feed, newest-first. */
  activity(): Snapshot<ActivityItem[]>;
  /** Count of items awaiting the local user (server-authoritative). */
  activityAwaitingCount(): Snapshot<number>;

  // commands
  stageAttachment(input: StageAttachmentInput): Promise<MessageAttachment>;
  removeDraftAttachment(attachment: MessageAttachment): Promise<void>;
  sendMessage(input: SendMessageInput): Promise<Message>;
  reactToMessage(input: ReactToMessageInput): Promise<Message>;
  /** Clear one item from "awaiting you" (e.g. on an explicit react in the feed). */
  ackActivity(eventId: number): Promise<void>;
  /** Clear every awaiting item ("mark all handled"). */
  ackAllActivity(): Promise<void>;
  /** Page in older activity rows (cursor "load older"). */
  loadMoreActivity(): Promise<void>;
  spawnAgent(input: SpawnAgentInput): Promise<SpawnAgentResult>;
  /** Override an agent's identity color. Pass `null` to revert to the seeded
   *  color. Mutates the agents snapshot so every component re-renders. */
  setAgentColor(agentId: string, hex: string | null): void;

  // lifecycle
  connect(): Promise<void>;
  disconnect(): void;

  // debug — what adapter is this
  readonly kind: "mock" | "daemon";
}
