import { requestJson, type ClientConfig } from "../client.ts";
import type { StatusResponse, SummaryPeer, SummaryResponse } from "./types.ts";

export function getStatus(client: ClientConfig): Promise<StatusResponse> {
  return requestJson<StatusResponse>(client, "/status");
}

export function getSummary(client: ClientConfig): Promise<SummaryResponse> {
  return requestJson<SummaryResponse>(client, "/summary");
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
