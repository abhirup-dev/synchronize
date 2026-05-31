import { requestJson, type ClientConfig } from "../client.ts";
import type { Event, Group, GroupMember } from "./types.ts";

export function createGroup(
  client: ClientConfig,
  input: { name: string; ephemeral?: boolean; creatorPeerId?: string; description?: string },
): Promise<{ group: Group }> {
  return requestJson<{ group: Group }>(client, "/groups", {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      ephemeral: input.ephemeral,
      creator_peer_id: input.creatorPeerId,
      ...(input.description !== undefined ? { description: input.description } : {}),
    }),
  });
}

export function patchGroup(
  client: ClientConfig,
  input: { name: string; description?: string | null },
): Promise<{ group: Group }> {
  return requestJson<{ group: Group }>(client, `/groups/${encodeURIComponent(input.name)}`, {
    method: "PATCH",
    body: JSON.stringify({
      ...(input.description !== undefined ? { description: input.description } : {}),
    }),
  });
}

export function listGroups(client: ClientConfig): Promise<{ groups: Group[] }> {
  return requestJson<{ groups: Group[] }>(client, "/groups");
}

export interface MyGroup extends Group {
  alias: string;
  joined_at: string;
}

/** Groups the given peer is an active member of, with the peer's alias + join time. */
export function listMyGroups(client: ClientConfig, peerId: string): Promise<{ groups: MyGroup[] }> {
  return requestJson<{ groups: MyGroup[] }>(client, `/groups?member=${encodeURIComponent(peerId)}`);
}

export interface JoinGroupResponse {
  member: GroupMember;
  // Null when the call was an idempotent no-op (peer already a member of the
  // group with the same alias); the join event is the original join, not a
  // fresh one. Inspect `already_member` to distinguish.
  event: Event | null;
  // Present when this join took over an alias previously held by a different
  // peer. The reclaim audit event was already emitted and fanned out; this
  // pointer lets the caller surface it without polling the events table.
  reclaimed_from?: { previous_peer_id: string; event_id: number };
  already_member?: boolean;
}

export function joinGroup(
  client: ClientConfig,
  input: { name: string; peerId: string; alias?: string; fresh?: boolean },
): Promise<JoinGroupResponse> {
  return requestJson<JoinGroupResponse>(client, `/groups/${encodeURIComponent(input.name)}/join`, {
    method: "POST",
    body: JSON.stringify({
      peer_id: input.peerId,
      alias: input.alias,
      fresh: input.fresh,
    }),
  });
}

export function renameInGroup(
  client: ClientConfig,
  input: { name: string; peerId: string; newAlias: string },
): Promise<{ member: GroupMember; event: Event }> {
  return requestJson<{ member: GroupMember; event: Event }>(
    client,
    `/groups/${encodeURIComponent(input.name)}/rename`,
    {
      method: "POST",
      body: JSON.stringify({ peer_id: input.peerId, new_alias: input.newAlias }),
    },
  );
}

export interface LeaveGroupResponse {
  ok: boolean;
  // Null when the call was an idempotent no-op (peer is not, or no longer, an
  // active member). Inspect `already_left` to distinguish a fresh leave from
  // a no-op.
  event: Event | null;
  already_left?: boolean;
}

export function leaveGroup(client: ClientConfig, input: { name: string; peerId: string }): Promise<LeaveGroupResponse> {
  return requestJson<LeaveGroupResponse>(client, `/groups/${encodeURIComponent(input.name)}/leave`, {
    method: "POST",
    body: JSON.stringify({ peer_id: input.peerId }),
  });
}

export interface MentionWarning {
  token: string;
  reason: "alias_not_in_group";
}

// Delivery summary so callers can verify routing without having to scan
// inbox state or watch for push callbacks. `pushed_to` is the set of active
// members whose push subscription was triggered (driven by mentions and
// thread-poster rules); `inbox_only` is the set of active members whose
// inbox row was written without a push (typical for non-mentioned members
// on a main-channel message). Sender is always excluded from both.
export interface DeliverySummary {
  pushed_to: string[];
  inbox_only: string[];
}

export interface SendGroupMessageResponse {
  event: Event;
  warnings: MentionWarning[];
  delivery: DeliverySummary;
}

export function sendGroupMessage(
  client: ClientConfig,
  input: { name: string; senderPeerId: string; message: string; inReplyTo?: number; skillDirectives?: string[] },
): Promise<SendGroupMessageResponse> {
  return requestJson<SendGroupMessageResponse>(
    client,
    `/groups/${encodeURIComponent(input.name)}/messages`,
    {
      method: "POST",
      body: JSON.stringify({
        sender_peer_id: input.senderPeerId,
        message: input.message,
        ...(input.inReplyTo !== undefined ? { in_reply_to: input.inReplyTo } : {}),
        ...(input.skillDirectives !== undefined ? { skill_directives: input.skillDirectives } : {}),
      }),
    },
  );
}

export function getGroupHistory(
  client: ClientConfig,
  input: { name: string; peerId: string; threadOf?: number },
): Promise<{ events: Event[]; next_cursor: number }> {
  const params = new URLSearchParams({ peer_id: input.peerId });
  if (input.threadOf !== undefined) params.set("thread_of", String(input.threadOf));
  return requestJson<{ events: Event[]; next_cursor: number }>(
    client,
    `/groups/${encodeURIComponent(input.name)}/history?${params.toString()}`,
  );
}
