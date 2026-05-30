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
  parentMessageId?: string;
}

export type AgentLaunchTool = "claude" | "pi";

export interface SpawnAgentInput {
  roomId: string;
  tool: AgentLaunchTool;
  name: string;
  path: string;
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
  me(): Snapshot<Agent>;

  // commands
  sendMessage(input: SendMessageInput): Promise<Message>;
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
