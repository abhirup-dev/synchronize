import { requestJson, type ClientConfig } from "../client.ts";
import type { Peer } from "./types.ts";

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
