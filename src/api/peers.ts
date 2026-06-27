import { hostname } from "node:os";
import { requestJson, type ClientConfig } from "../client.ts";
import type { ActivityState } from "../constants.ts";
import type { GroupMember, Peer, PeerWorkState, PeerWorkStateHistoryEntry, WorkPhase, WorkScope } from "./types.ts";

// /peers returns a different shape depending on whether `group` is set.
// Without a group, it's plain Peer[] (daemon-wide roster). With a group, the
// daemon returns enriched group_members joined with peers — alias, active,
// joined_at, history_from_event_id, host_session_id, online, etc. Surface
// the union so callers (and the MCP adapter) get a discriminated response.
export interface GroupMemberListed extends GroupMember {
  online: boolean;
}
export type ListPeersResponse =
  | { peers: Peer[] }
  | { peers: GroupMemberListed[] };

export function registerPeer(
  client: ClientConfig,
  input: {
    peerId?: string;
    sessionName: string;
    purpose?: string;
    tool: string;
    machineId?: string;
  },
): Promise<{ peer: Peer }> {
  return requestJson<{ peer: Peer }>(client, "/peers/register", {
    method: "POST",
    body: JSON.stringify({
      peer_id: input.peerId,
      session_name: input.sessionName,
      purpose: input.purpose,
      tool: input.tool,
      machine_id: input.machineId ?? hostname(),
    }),
  });
}

export function heartbeatPeer(client: ClientConfig, peerId: string): Promise<{ peer: Peer }> {
  return requestJson<{ peer: Peer }>(client, `/peers/${encodeURIComponent(peerId)}/heartbeat`, {
    method: "PATCH",
  });
}

// Operator-only: manual evict from the web UI. Normal client code paths must
// NOT call this on shutdown — death is detected by lease lapse, not by an
// explicit delete (see plan-agent-ttl-presence-v0.md "footgun removal").
export function deletePeer(client: ClientConfig, peerId: string): Promise<{ ok: boolean; peer_id: string }> {
  return requestJson<{ ok: boolean; peer_id: string }>(client, `/peers/${encodeURIComponent(peerId)}`, {
    method: "DELETE",
  });
}

// Push an activity transition. Pi sends { peerId }; the stateless Claude hook
// sends { hostTool, hostSessionId } so the daemon resolves the peer. Refreshes
// the lease as a side effect (activity = proof-of-life).
export function setPeerActivity(
  client: ClientConfig,
  input:
    | { peerId: string; state: ActivityState }
    | { hostTool: string; hostSessionId: string; state: ActivityState },
): Promise<{ peer: Peer }> {
  const body =
    "peerId" in input
      ? { peer_id: input.peerId, state: input.state }
      : { host_tool: input.hostTool, host_session_id: input.hostSessionId, state: input.state };
  return requestJson<{ peer: Peer }>(client, "/peers/activity", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export type SetPeerWorkStateInput =
  | {
      peerId: string;
      phase: WorkPhase;
      summary: string;
      scope?: WorkScope;
      task?: string;
      triggerEventId?: number;
      ttlMinutes?: number;
      source?: PeerWorkState["source"];
    }
  | {
      hostTool: string;
      hostSessionId: string;
      phase: WorkPhase;
      summary: string;
      scope?: WorkScope;
      task?: string;
      triggerEventId?: number;
      ttlMinutes?: number;
      source?: PeerWorkState["source"];
    }
  | {
      peerId: string;
      clear: true;
      triggerEventId?: number;
      source?: PeerWorkState["source"];
    }
  | {
      hostTool: string;
      hostSessionId: string;
      clear: true;
      triggerEventId?: number;
      source?: PeerWorkState["source"];
    };

export interface SetPeerWorkStateResponse {
  peer: Peer;
  work_state: PeerWorkState | null;
  ttl_minutes: number | null;
  expires_at: string | null;
}

export function setPeerWorkState(client: ClientConfig, input: SetPeerWorkStateInput): Promise<SetPeerWorkStateResponse> {
  const identity =
    "peerId" in input
      ? { peer_id: input.peerId }
      : { host_tool: input.hostTool, host_session_id: input.hostSessionId };
  const body =
    "clear" in input
      ? {
          ...identity,
          clear: true,
          trigger_event_id: input.triggerEventId,
          source: input.source,
        }
      : {
          ...identity,
          phase: input.phase,
          summary: input.summary,
          scope: input.scope,
          task: input.task,
          trigger_event_id: input.triggerEventId,
          ttl_minutes: input.ttlMinutes,
          source: input.source,
        };
  return requestJson<SetPeerWorkStateResponse>(client, "/peers/work-state", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export interface ListPeerWorkStateHistoryInput {
  peerId: string;
  limit?: number;
  from?: string;
  to?: string;
  phase?: WorkPhase;
  taskContains?: string;
  scopeKind?: WorkScope["kind"];
  scopeValue?: string;
  eventId?: number;
  correlation?: PeerWorkStateHistoryEntry["correlation_method"];
}

export function listPeerWorkStateHistory(
  client: ClientConfig,
  input: ListPeerWorkStateHistoryInput,
): Promise<{ history: PeerWorkStateHistoryEntry[]; truncated: boolean }> {
  const params = new URLSearchParams();
  if (input.limit !== undefined) params.set("limit", String(input.limit));
  if (input.from !== undefined) params.set("from", input.from);
  if (input.to !== undefined) params.set("to", input.to);
  if (input.phase !== undefined) params.set("phase", input.phase);
  if (input.taskContains !== undefined) params.set("task_contains", input.taskContains);
  if (input.scopeKind !== undefined) params.set("scope_kind", input.scopeKind);
  if (input.scopeValue !== undefined) params.set("scope_value", input.scopeValue);
  if (input.eventId !== undefined) params.set("event_id", String(input.eventId));
  if (input.correlation !== undefined) params.set("correlation", input.correlation);
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return requestJson<{ history: PeerWorkStateHistoryEntry[]; truncated: boolean }>(
    client,
    `/peers/${encodeURIComponent(input.peerId)}/work-state-history${query}`,
  );
}

export function listPeers(client: ClientConfig, input: { group?: string } = {}): Promise<ListPeersResponse> {
  const path = input.group ? `/peers?group=${encodeURIComponent(input.group)}` : "/peers";
  return requestJson<ListPeersResponse>(client, path);
}
