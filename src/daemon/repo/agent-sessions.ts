import { Database } from "bun:sqlite";

import { HttpError } from "../../http.ts";
import { derivePresence, type PeerRow, type Presence } from "./peers.ts";

interface AgentSessionRow {
  binding_id: string;
  peer_id: string;
  host_tool: string;
  host_session_id: string;
  host_session_file: string | null;
  cwd: string | null;
  git_branch: string | null;
  git_dirty: boolean | null;
  pid: number | null;
  source: string | null;
  model: string | null;
  agent_type: string | null;
  metadata_json: string | null;
  launch_id: string | null;
  created_at: string;
  updated_at: string;
  last_seen_at: string;
}

interface AgentSessionJoinedRow extends AgentSessionRow {
  peer_tool: string;
  peer_session_name: string;
  peer_purpose: string | null;
  peer_lease_expires_at: string;
  peer_activity_state: string | null;
  peer_online: number;
}

export function listAgentSessions(
  db: Database,
  input: { hostTool: string | null; peerId: string | null; launchId?: string | null },
): ReturnType<typeof formatAgentSession>[] {
  const now = new Date().toISOString();
  if (input.launchId) {
    return db
      .query<AgentSessionJoinedRow, [string, string]>(
        `${agentSessionSelectSql()} WHERE s.launch_id = ? ORDER BY s.updated_at DESC`,
      )
      .all(now, input.launchId)
      .map(formatAgentSession);
  }
  if (input.hostTool && input.peerId) {
    return db
      .query<AgentSessionJoinedRow, [string, string, string]>(
        `${agentSessionSelectSql()} WHERE s.host_tool = ? AND s.peer_id = ? ORDER BY s.updated_at DESC`,
      )
      .all(now, input.hostTool, input.peerId)
      .map(formatAgentSession);
  }
  if (input.hostTool) {
    return db
      .query<AgentSessionJoinedRow, [string, string]>(
        `${agentSessionSelectSql()} WHERE s.host_tool = ? ORDER BY s.updated_at DESC`,
      )
      .all(now, input.hostTool)
      .map(formatAgentSession);
  }
  if (input.peerId) {
    return db
      .query<AgentSessionJoinedRow, [string, string]>(
        `${agentSessionSelectSql()} WHERE s.peer_id = ? ORDER BY s.updated_at DESC`,
      )
      .all(now, input.peerId)
      .map(formatAgentSession);
  }
  return db
    .query<AgentSessionJoinedRow, [string]>(`${agentSessionSelectSql()} ORDER BY s.updated_at DESC`)
    .all(now)
    .map(formatAgentSession);
}

export function getAgentSessionByHost(db: Database, hostTool: string, hostSessionId: string): ReturnType<typeof formatAgentSession> {
  const now = new Date().toISOString();
  const row = db
    .query<AgentSessionJoinedRow, [string, string, string]>(
      `${agentSessionSelectSql()} WHERE s.host_tool = ? AND s.host_session_id = ?`,
    )
    .get(now, hostTool, hostSessionId);
  if (!row) throw new HttpError(404, "agent_session_not_found", `Agent session not found: ${hostTool}/${hostSessionId}`);
  return formatAgentSession(row);
}

export function getAgentSessionByPeer(db: Database, peerId: string): ReturnType<typeof formatAgentSession> {
  const now = new Date().toISOString();
  const row = db
    .query<AgentSessionJoinedRow, [string, string]>(
      `${agentSessionSelectSql()} WHERE s.peer_id = ? ORDER BY s.updated_at DESC LIMIT 1`,
    )
    .get(now, peerId);
  if (!row) throw new HttpError(404, "agent_session_not_found", `Agent session not found for peer: ${peerId}`);
  return formatAgentSession(row);
}

function agentSessionSelectSql(): string {
  return `SELECT
      s.*,
      p.tool AS peer_tool,
      p.session_name AS peer_session_name,
      p.purpose AS peer_purpose,
      p.lease_expires_at AS peer_lease_expires_at,
      p.activity_state AS peer_activity_state,
      p.lease_expires_at > ? AS peer_online
    FROM agent_sessions s
    JOIN peers p ON p.peer_id = s.peer_id`;
}

function formatAgentSession(
  row: AgentSessionJoinedRow,
): AgentSessionRow & { peer: PeerRow & { online: boolean; presence: Presence } } {
  return {
    binding_id: row.binding_id,
    peer_id: row.peer_id,
    host_tool: row.host_tool,
    host_session_id: row.host_session_id,
    host_session_file: row.host_session_file,
    cwd: row.cwd,
    git_branch: row.git_branch,
    git_dirty: row.git_dirty === null ? null : Boolean(row.git_dirty),
    pid: row.pid,
    source: row.source,
    model: row.model,
    agent_type: row.agent_type,
    metadata_json: row.metadata_json,
    launch_id: row.launch_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_seen_at: row.last_seen_at,
    peer: {
      peer_id: row.peer_id,
      tool: row.peer_tool,
      session_name: row.peer_session_name,
      purpose: row.peer_purpose,
      machine_id: "",
      lease_expires_at: row.peer_lease_expires_at,
      activity_state: row.peer_activity_state,
      last_activity_at: null,
      last_cursor: 0,
      created_at: "",
      updated_at: "",
      online: Boolean(row.peer_online),
      presence: derivePresence(Boolean(row.peer_online), row.peer_activity_state),
    },
  };
}
