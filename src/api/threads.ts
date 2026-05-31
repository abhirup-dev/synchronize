import { requestJson, type ClientConfig } from "../client.ts";
import type { ThreadDiscoveryRow, ThreadResponse, ThreadStatus, ThreadSummaryResponse } from "./types.ts";

export interface ListThreadsInput {
  group?: string;
  startedByPeerId?: string;
  startedBySessionName?: string;
  participatedByPeerId?: string;
  participatedBySessionName?: string;
  activeSince?: string;
  limit?: number;
}

export function listThreads(
  client: ClientConfig,
  input: ListThreadsInput = {},
): Promise<{ threads: ThreadDiscoveryRow[] }> {
  const params = new URLSearchParams();
  if (input.group) params.set("group", input.group);
  if (input.startedByPeerId) params.set("started_by_peer_id", input.startedByPeerId);
  if (input.startedBySessionName) params.set("started_by_session_name", input.startedBySessionName);
  if (input.participatedByPeerId) params.set("participated_by_peer_id", input.participatedByPeerId);
  if (input.participatedBySessionName) params.set("participated_by_session_name", input.participatedBySessionName);
  if (input.activeSince) params.set("active_since", input.activeSince);
  if (input.limit !== undefined) params.set("limit", String(input.limit));
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return requestJson<{ threads: ThreadDiscoveryRow[] }>(client, `/threads${query}`);
}

export function getThreadStatus(client: ClientConfig, rootEventId: number): Promise<{ status: ThreadStatus }> {
  return requestJson<{ status: ThreadStatus }>(client, `/threads/${rootEventId}/status`);
}

export function getThread(
  client: ClientConfig,
  input: { rootEventId: number; format?: "json" | "transcript" },
): Promise<ThreadResponse> {
  const params = new URLSearchParams();
  if (input.format) params.set("format", input.format);
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return requestJson<ThreadResponse>(client, `/threads/${input.rootEventId}${query}`);
}

export function getThreadSummary(
  client: ClientConfig,
  rootEventId: number,
): Promise<ThreadSummaryResponse> {
  return requestJson<ThreadSummaryResponse>(client, `/threads/${rootEventId}/summary`);
}

export interface PostThreadSummaryInput {
  rootEventId: number;
  strategy?: string;
  k?: number;
  first_k?: number;
  last_k?: number;
}

export function postThreadSummary(
  client: ClientConfig,
  input: PostThreadSummaryInput,
): Promise<ThreadSummaryResponse> {
  const { rootEventId, ...body } = input;
  return requestJson<ThreadSummaryResponse>(client, `/threads/${rootEventId}/summary`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}
