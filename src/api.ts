import { requestJson, type ClientConfig } from "./client.ts";

export interface StatusResponse {
  ok: boolean;
  pid: number;
  base_url: string;
  started_at: string;
  token_required: boolean;
  home: string;
  db_path: string;
  media_path: string;
  counts: {
    peers: number;
    groups: number;
    events: number;
  };
}

export interface Peer {
  peer_id: string;
  tool: string;
  session_name: string;
  purpose: string | null;
  lease_expires_at: string;
  online?: boolean;
}

export interface Event {
  event_id: number;
  type: string;
  sender_peer_id: string | null;
  recipient_peer_id: string | null;
  group_id: number | null;
  body: string | null;
  media_id: string | null;
  created_at: string;
  delivered_at?: string | null;
  read_at?: string | null;
  acked_at?: string | null;
}

export interface Group {
  group_id: number;
  name: string;
  durable: boolean;
  media_dir: string;
  creator_peer_id: string | null;
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
    pending_inbox: number;
    groups: number;
    updated_at: string;
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

export function getStatus(client: ClientConfig): Promise<StatusResponse> {
  return requestJson<StatusResponse>(client, "/status");
}

export function getSummary(client: ClientConfig): Promise<SummaryResponse> {
  return requestJson<SummaryResponse>(client, "/summary");
}

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
      machine_id: input.machineId,
    }),
  });
}

export function heartbeatPeer(client: ClientConfig, peerId: string): Promise<{ peer: Peer }> {
  return requestJson<{ peer: Peer }>(client, `/peers/${encodeURIComponent(peerId)}/heartbeat`, {
    method: "PATCH",
  });
}

export function deletePeer(client: ClientConfig, peerId: string): Promise<{ ok: boolean; peer_id: string }> {
  return requestJson<{ ok: boolean; peer_id: string }>(client, `/peers/${encodeURIComponent(peerId)}`, {
    method: "DELETE",
  });
}

export function listPeers(client: ClientConfig, input: { group?: string } = {}): Promise<{ peers: Peer[] }> {
  const path = input.group ? `/peers?group=${encodeURIComponent(input.group)}` : "/peers";
  return requestJson<{ peers: Peer[] }>(client, path);
}

export function sendDm(
  client: ClientConfig,
  input: { senderPeerId: string; recipientPeerId: string; message: string },
): Promise<{ event: Event }> {
  return requestJson<{ event: Event }>(client, "/dm", {
    method: "POST",
    body: JSON.stringify({
      sender_peer_id: input.senderPeerId,
      recipient_peer_id: input.recipientPeerId,
      message: input.message,
    }),
  });
}

export function readInbox(client: ClientConfig, peerId: string): Promise<{ events: Event[]; next_cursor: number }> {
  return requestJson<{ events: Event[]; next_cursor: number }>(client, `/peers/${encodeURIComponent(peerId)}/inbox`);
}

export function ackInbox(client: ClientConfig, peerId: string, eventIds?: number[]): Promise<{ ok: boolean; acked: number }> {
  return requestJson<{ ok: boolean; acked: number }>(client, `/peers/${encodeURIComponent(peerId)}/inbox/ack`, {
    method: "POST",
    body: JSON.stringify(eventIds ? { event_ids: eventIds } : {}),
  });
}

export function readEvents(
  client: ClientConfig,
  peerId: string,
  input: { cursor?: number; limit?: number } = {},
): Promise<{ events: Event[]; next_cursor: number }> {
  const params = new URLSearchParams();
  if (input.cursor !== undefined) params.set("cursor", String(input.cursor));
  if (input.limit !== undefined) params.set("limit", String(input.limit));
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return requestJson<{ events: Event[]; next_cursor: number }>(client, `/events/${encodeURIComponent(peerId)}${query}`);
}

export function subscribeToEvents(
  client: ClientConfig,
  input: { peerId: string; callbackUrl: string; token: string },
): Promise<{ subscription: EventSubscriptionRegistration }> {
  return requestJson<{ subscription: EventSubscriptionRegistration }>(client, "/subscriptions", {
    method: "POST",
    body: JSON.stringify({
      peer_id: input.peerId,
      callback_url: input.callbackUrl,
      token: input.token,
    }),
  });
}

export function createGroup(
  client: ClientConfig,
  input: { name: string; ephemeral?: boolean; creatorPeerId?: string },
): Promise<{ group: Group }> {
  return requestJson<{ group: Group }>(client, "/groups", {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      ephemeral: input.ephemeral,
      creator_peer_id: input.creatorPeerId,
    }),
  });
}

export function listGroups(client: ClientConfig): Promise<{ groups: Group[] }> {
  return requestJson<{ groups: Group[] }>(client, "/groups");
}

export function joinGroup(
  client: ClientConfig,
  input: { name: string; peerId: string; alias?: string; fresh?: boolean },
): Promise<{ member: GroupMember; event: Event }> {
  return requestJson<{ member: GroupMember; event: Event }>(client, `/groups/${encodeURIComponent(input.name)}/join`, {
    method: "POST",
    body: JSON.stringify({
      peer_id: input.peerId,
      alias: input.alias,
      fresh: input.fresh,
    }),
  });
}

export function leaveGroup(client: ClientConfig, input: { name: string; peerId: string }): Promise<{ ok: boolean; event: Event }> {
  return requestJson<{ ok: boolean; event: Event }>(client, `/groups/${encodeURIComponent(input.name)}/leave`, {
    method: "POST",
    body: JSON.stringify({ peer_id: input.peerId }),
  });
}

export function sendGroupMessage(
  client: ClientConfig,
  input: { name: string; senderPeerId: string; message: string },
): Promise<{ event: Event }> {
  return requestJson<{ event: Event }>(client, `/groups/${encodeURIComponent(input.name)}/messages`, {
    method: "POST",
    body: JSON.stringify({ sender_peer_id: input.senderPeerId, message: input.message }),
  });
}

export function getGroupHistory(
  client: ClientConfig,
  input: { name: string; peerId: string },
): Promise<{ events: Event[]; next_cursor: number }> {
  return requestJson<{ events: Event[]; next_cursor: number }>(
    client,
    `/groups/${encodeURIComponent(input.name)}/history?peer_id=${encodeURIComponent(input.peerId)}`,
  );
}

export function shareMedia(
  client: ClientConfig,
  input: { group: string; sharedByPeerId: string; path: string; description?: string },
): Promise<{ media: MediaItem; event: Event }> {
  return requestJson<{ media: MediaItem; event: Event }>(client, `/groups/${encodeURIComponent(input.group)}/media`, {
    method: "POST",
    body: JSON.stringify({
      shared_by_peer_id: input.sharedByPeerId,
      path: input.path,
      description: input.description,
    }),
  });
}

export function listMedia(
  client: ClientConfig,
  input: { group: string; query?: string },
): Promise<{ media: MediaItem[] }> {
  const query = input.query ? `?query=${encodeURIComponent(input.query)}` : "";
  return requestJson<{ media: MediaItem[] }>(client, `/groups/${encodeURIComponent(input.group)}/media${query}`);
}

export function getMedia(client: ClientConfig, mediaId: string): Promise<{ media: MediaItem }> {
  return requestJson<{ media: MediaItem }>(client, `/media/${encodeURIComponent(mediaId)}`);
}

export async function findReusablePeer(
  client: ClientConfig,
  input: { sessionName: string; tool: string },
): Promise<string | undefined> {
  const summary = await getSummary(client);
  return summary.peers
    .filter((peer) => peer.tool === input.tool && peer.session_name === input.sessionName)
    .sort(compareReusablePeers)
    .at(0)?.peer_id;
}

function compareReusablePeers(left: SummaryPeer, right: SummaryPeer): number {
  if (left.groups !== right.groups) return right.groups - left.groups;
  if (left.online !== right.online) return Number(right.online) - Number(left.online);
  return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
}
