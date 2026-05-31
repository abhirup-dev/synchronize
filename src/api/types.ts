export interface StatusResponse {
  ok: boolean;
  pid: number;
  base_url: string;
  started_at: string;
  token_required: boolean;
  home: string;
  db_path: string;
  media_path: string;
  provenance: {
    api_version: number;
    entrypoint_path: string;
    source_root: string;
    git_sha: string | null;
    git_dirty: boolean | null;
  };
  counts: {
    peers: number;
    groups: number;
    events: number;
  };
}

/** Stored per-peer activity (instrumented agents only). */
export type ActivityState = "initializing" | "working" | "idle";
/** Derived presence shown in rosters. */
export type Presence = "offline" | "online" | ActivityState;

export interface Peer {
  peer_id: string;
  tool: string;
  session_name: string;
  purpose: string | null;
  lease_expires_at: string;
  online?: boolean;
  /** 3-state activity for instrumented agents; null/absent for uninstrumented peers. */
  activity_state?: ActivityState | null;
  last_activity_at?: string | null;
  /** Derived: offline if lease lapsed, else activity_state, else generic "online". */
  presence?: Presence;
}

export interface AgentSessionBinding {
  binding_id: string;
  peer_id: string;
  host_tool: string;
  host_session_id: string;
  host_session_file: string | null;
  cwd: string | null;
  pid: number | null;
  source: string | null;
  model: string | null;
  agent_type: string | null;
  metadata_json: string | null;
  launch_id: string | null;
  created_at: string;
  updated_at: string;
  last_seen_at: string;
  peer: Peer;
}

export interface Event {
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
  delivered_at?: string | null;
  read_at?: string | null;
  acked_at?: string | null;
  reactions?: ReactionSummary[];
}

export type ReplySurface = "dm" | "group_main" | "thread";

export interface ReplyDestination {
  surface: ReplySurface;
  direct_event_id: number;
  direct_sender_peer_id: string | null;
  direct_sender: string | null;
  direct_preview: string | null;
  group_id?: number;
  group_name?: string;
  thread_root_event_id?: number;
  thread_root_sender_peer_id?: string | null;
  thread_root_sender?: string | null;
  thread_root_preview?: string | null;
}

export interface ReplyResponse {
  event: Event;
  posted_to: ReplyDestination;
}

export interface ReactionActor {
  peer_id: string;
  session_name: string;
  tool: string;
  alias: string | null;
  created_at: string;
}

export interface ReactionSummary {
  emoji: string;
  count: number;
  by: ReactionActor[];
}

export type SqlParam = string | number | boolean | null;

export interface EventQueryResponse {
  columns: string[];
  rows: Record<string, unknown>[];
  row_count: number;
  truncated: boolean;
  elapsed_ms: number;
}

export interface ThreadDiscoveryRow {
  root_event_id: number;
  group_name: string;
  root_sender_peer_id: string | null;
  root_sender_session_name: string | null;
  root_sender_alias: string | null;
  created_at: string;
  last_activity_at: string;
  reply_count: number;
  participant_count: number;
  preview: string | null;
}

export interface ThreadParticipantStatus {
  peer_id: string;
  session_name: string | null;
  alias: string | null;
  active: boolean;
  event_count: number;
  first_event_id: number;
  last_event_id: number;
  last_activity_at: string;
}

export interface ThreadStatus {
  root_event_id: number;
  group_id: number;
  group_name: string;
  root_sender_peer_id: string | null;
  root_sender_session_name: string | null;
  root_sender_alias: string | null;
  created_at: string;
  last_event_id: number;
  last_activity_at: string;
  reply_count: number;
  event_count: number;
  participant_count: number;
  participants: ThreadParticipantStatus[];
}

export interface ThreadResponse {
  status: ThreadStatus;
  events: Event[];
  transcript?: string;
}

export interface ThreadSummaryResponse {
  summary: string | null;
  model: string | null;
  strategy: "all" | "first_k" | "last_k" | "first_last" | null;
  strategy_params: { k?: number; first_k?: number; last_k?: number } | null;
  prompt_version: number | null;
  covered_last_event_id: number | null;
  covered_event_count: number | null;
  updated_at: string | null;
  stale: boolean;
  status: "ready" | "pending" | "disabled";
}

export interface Group {
  group_id: number;
  name: string;
  durable: boolean;
  media_dir: string;
  creator_peer_id: string | null;
  description: string | null;
  created_at: string;
}

export interface GroupMember {
  group_id: number;
  peer_id: string;
  alias: string;
  join_event_id: number | null;
  history_from_event_id: number | null;
  active: boolean;
  purpose: string | null;
  joined_at: string;
  left_at: string | null;
  session_name: string;
  tool: string;
  host_session_id: string | null;
}

export interface MediaItem {
  media_id: string;
  group_id: number;
  original_path: string;
  copied_path: string;
  size_bytes: number;
  sha256: string;
  content_type: string;
  description: string | null;
  shared_by_peer_id: string;
  created_at: string;
}

export interface EventSubscriptionRegistration {
  peer_id: string;
  callback_url: string;
  token: string;
  created_at: string;
}

export interface SummaryResponse {
  ok: boolean;
  daemon: {
    pid: number;
    base_url: string;
    started_at: string;
    token_required: boolean;
    home: string;
    db_path: string;
    media_path: string;
    provenance?: {
      api_version: number;
      entrypoint_path: string;
      source_root: string;
      git_sha: string | null;
      git_dirty: boolean | null;
    };
  };
  totals: {
    peers: { total: number; online: number; stale: number };
    groups: { total: number; durable: number; ephemeral: number };
    events: { total: number; last_event_at: string | null };
    inbox: { total: number; pending: number };
    media: { files: number; bytes: number };
  };
  peers: Array<{
    peer_id: string;
    session_name: string;
    tool: string;
    purpose: string | null;
    online: boolean;
    presence: Presence;
    activity_state: ActivityState | null;
    pending_inbox: number;
    groups: number;
    updated_at: string;
    host_session_id: string | null;
  }>;
  groups: Array<{
    name: string;
    durable: boolean;
    members: number;
    online_members: number;
    messages: number;
    media: number;
    last_activity_at: string | null;
  }>;
  generated_at: string;
}

export type SummaryPeer = SummaryResponse["peers"][number];
