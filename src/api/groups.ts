import { requestJson, type ClientConfig } from "../client.ts";
import type { Event, Group, GroupMember } from "./types.ts";

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

export function leaveGroup(client: ClientConfig, input: { name: string; peerId: string }): Promise<{ ok: boolean; event: Event }> {
  return requestJson<{ ok: boolean; event: Event }>(client, `/groups/${encodeURIComponent(input.name)}/leave`, {
    method: "POST",
    body: JSON.stringify({ peer_id: input.peerId }),
  });
}

export function sendGroupMessage(
  client: ClientConfig,
  input: { name: string; senderPeerId: string; message: string; inReplyTo?: number },
): Promise<{ event: Event }> {
  return requestJson<{ event: Event }>(client, `/groups/${encodeURIComponent(input.name)}/messages`, {
    method: "POST",
    body: JSON.stringify({
      sender_peer_id: input.senderPeerId,
      message: input.message,
      ...(input.inReplyTo !== undefined ? { in_reply_to: input.inReplyTo } : {}),
    }),
  });
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
