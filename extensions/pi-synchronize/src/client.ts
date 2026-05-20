import { homedir } from "node:os";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

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

export interface Peer {
  peer_id: string;
  tool: string;
  session_name: string;
  purpose: string | null;
  lease_expires_at: string;
  online?: boolean;
}

export interface PiSyncClient {
  baseUrl: string;
  token: string | null;
}

interface Discovery {
  baseUrl: string;
}

export async function discoverDaemon(): Promise<PiSyncClient> {
  const home = process.env.SYNCHRONIZE_HOME ?? join(homedir(), ".synchronize");
  const discoveryPath = join(home, "daemon.json");
  const raw = await readFile(discoveryPath, "utf8").catch(() => null);
  if (!raw) {
    throw new Error(`synchronize daemon not running (no ${discoveryPath}); start it via the synchronize CLI first`);
  }
  const discovery = JSON.parse(raw) as Discovery;
  if (!discovery.baseUrl) throw new Error(`invalid ${discoveryPath}: missing baseUrl`);
  return { baseUrl: discovery.baseUrl, token: process.env.SYNCHRONIZE_TOKEN ?? null };
}

async function requestJson<T>(client: PiSyncClient, path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json; charset=utf-8");
  }
  if (client.token) headers.set("authorization", `Bearer ${client.token}`);
  const response = await fetch(`${client.baseUrl}${path}`, { ...init, headers });
  const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  if (!response.ok) {
    const message = body?.error?.message ?? `${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return body as T;
}

export function registerPeer(
  client: PiSyncClient,
  input: { peerId?: string; sessionName: string; purpose?: string; tool: string },
): Promise<{ peer: Peer }> {
  return requestJson<{ peer: Peer }>(client, "/peers/register", {
    method: "POST",
    body: JSON.stringify({
      peer_id: input.peerId,
      session_name: input.sessionName,
      tool: input.tool,
      purpose: input.purpose,
    }),
  });
}

export function heartbeatPeer(client: PiSyncClient, peerId: string): Promise<unknown> {
  return requestJson(client, `/peers/${encodeURIComponent(peerId)}/heartbeat`, { method: "PATCH" });
}

export function deletePeer(client: PiSyncClient, peerId: string): Promise<unknown> {
  return requestJson(client, `/peers/${encodeURIComponent(peerId)}`, { method: "DELETE" });
}

export function subscribeToEvents(
  client: PiSyncClient,
  input: { peerId: string; callbackUrl: string; token: string },
): Promise<unknown> {
  return requestJson(client, "/subscriptions", {
    method: "POST",
    body: JSON.stringify({
      peer_id: input.peerId,
      callback_url: input.callbackUrl,
      token: input.token,
    }),
  });
}
