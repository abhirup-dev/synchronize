// Daemon payload types — mirrors native-android-daemon-contract.md and the
// live /web/state shape observed against the production daemon.

export interface Peer {
  peer_id: string;
  tool: string;
  session_name: string;
  purpose?: string | null;
  activity_state?: string | null;
  lifecycle_state?: string | null;
  archived_at?: string | null;
  archived_reason?: string | null;
  online: boolean;
  presence?: string;
  last_activity_at?: string | null;
  created_at?: string;
}

export interface Group {
  group_id: number;
  name: string;
  durable?: boolean;
  description?: string | null;
  creator_peer_id?: string;
}

export interface Membership {
  group_id: number;
  peer_id: string;
  alias?: string;
  active: boolean;
  session_name?: string;
  tool?: string;
  online?: boolean;
  presence?: string;
}

export interface RoomSummary {
  group_id: number;
  last_event_id: number;
  last_event_at: string;
  last_preview: string;
  message_count: number;
}

export interface Reaction {
  emoji: string;
  count: number;
  by: { peer_id: string; session_name?: string }[];
}

export interface SyncEvent {
  event_id: number;
  type: string;
  sender_peer_id: string;
  recipient_peer_id?: string | null;
  group_id?: number | null;
  body: string;
  media_id?: number | null;
  parent_event_id?: number | null;
  reply_to_event_id?: number | null;
  mentions_json?: string | null;
  created_at: string;
  group_name?: string;
  reply_count?: number;
  delivered_count?: number;
  read_count?: number;
  acked_count?: number;
  acked_at?: string | null;
  awaiting?: number;
  reactions?: Reaction[];
}

export interface LaunchTool {
  tool: string;
  available: boolean;
  path?: string;
}

export interface LaunchProfile {
  name: string;
  tool: string;
  available: boolean;
}

export interface LaunchLifecycle {
  launch_id: string;
  peer_id: string;
  tool: string;
  session_name: string;
  state: string;
  target_group?: string | null;
  failure_message?: string | null;
  created_at: string;
}

export interface AgentRuntimeDetails {
  peer_id: string;
  tool: string;
  session_name: string;
  model?: string | null;
  thinking?: string | null;
  cwd?: string | null;
  git_branch?: string | null;
  git_dirty?: boolean;
  pid?: number | null;
  host_tool?: string | null;
  last_seen_at?: string;
}

export interface GroupPath {
  path_id: number;
  group_id: number;
  path: string;
  active: boolean;
}

export interface WebState {
  ok: boolean;
  cursor: number;
  peers: Peer[];
  groups: Group[];
  memberships: Membership[];
  room_summaries: RoomSummary[];
  events: SyncEvent[];
  launch_tools: Record<string, LaunchTool>;
  launch_profiles: LaunchProfile[];
  launch_lifecycle: LaunchLifecycle[];
  agent_runtime_details: AgentRuntimeDetails[];
  group_paths: GroupPath[];
}

export interface ActivityFeed {
  events: SyncEvent[];
  peers: Peer[];
  next_cursor: number | null;
  awaiting_count: number;
}

// ---- client-side view models ----

export interface Room {
  id: string; // group:<id> | dm:<peer_id>
  kind: 'group' | 'dm';
  name: string;
  preview: string;
  lastAt: string | null;
  messageCount: number;
  members: Membership[];
  online?: boolean;
  peer?: Peer;
  group?: Group;
}

export interface Agent {
  peer: Peer;
  runtime?: AgentRuntimeDetails;
  lifecycle?: LaunchLifecycle;
  rooms: string[];
}
