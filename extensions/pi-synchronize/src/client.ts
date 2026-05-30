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

export interface AgentSessionBinding {
  binding_id: string;
  peer_id: string;
  host_tool: string;
  host_session_id: string;
  host_session_file: string | null;
  cwd: string | null;
  pid: number | null;
  source: string | null;
  model: string | null;
  agent_type: string | null;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
  last_seen_at: string;
  peer: Peer;
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

// Network errors at the fetch layer surface as TypeError from undici with
// `code: "ECONNREFUSED"`, "ECONNRESET", "ENOTFOUND", or as a bare
// `fetch failed`. We treat all of these as "daemon URL might have moved" and
// trigger a single rediscover-and-retry, mirroring the Claude-side
// `ensureDaemon()` resilience.
function isTransportError(error: unknown): boolean {
  if (!(error instanceof TypeError)) return false;
  if (error.message === "fetch failed") return true;
  const cause = (error as { cause?: { code?: string } }).cause;
  return cause?.code === "ECONNREFUSED" || cause?.code === "ECONNRESET" || cause?.code === "ENOTFOUND";
}

async function fetchJson(client: PiSyncClient, path: string, init: RequestInit): Promise<unknown> {
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
  return body;
}

async function requestJson<T>(client: PiSyncClient, path: string, init: RequestInit = {}): Promise<T> {
  try {
    return (await fetchJson(client, path, init)) as T;
  } catch (error) {
    if (!isTransportError(error)) throw error;
    // Daemon URL likely moved. Re-read daemon.json and retry once with the
    // fresh baseUrl. Mutate the client object so subsequent calls also use
    // the new URL — this matches the lazy-discovery pattern on the Claude
    // side.
    const fresh = await discoverDaemon().catch(() => null);
    if (!fresh || fresh.baseUrl === client.baseUrl) throw error;
    client.baseUrl = fresh.baseUrl;
    return (await fetchJson(client, path, init)) as T;
  }
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

export function registerAgentSession(
  client: PiSyncClient,
  input: { peerId: string; sessionName: string; hostSessionId: string; cwd?: string; launchId?: string },
): Promise<{ binding: AgentSessionBinding }> {
  return requestJson<{ binding: AgentSessionBinding }>(client, "/agent-sessions/register", {
    method: "POST",
    body: JSON.stringify({
      peer_id: input.peerId,
      session_name: input.sessionName,
      tool: "pi",
      purpose: "pi-coding-agent session",
      host_tool: "pi",
      host_session_id: input.hostSessionId,
      cwd: input.cwd,
      pid: process.pid,
      source: "session_start",
      launch_id: input.launchId,
    }),
  });
}

export function heartbeatPeer(client: PiSyncClient, peerId: string): Promise<unknown> {
  return requestJson(client, `/peers/${encodeURIComponent(peerId)}/heartbeat`, { method: "PATCH" });
}

export function deletePeer(client: PiSyncClient, peerId: string): Promise<unknown> {
  return requestJson(client, `/peers/${encodeURIComponent(peerId)}`, { method: "DELETE" });
}

// Push a 3-state activity transition for this peer. Pi has the peer_id
// in-process, so it sends the peer_id form. Best-effort at the call site.
export function setPeerActivity(
  client: PiSyncClient,
  peerId: string,
  state: "initializing" | "working" | "idle",
): Promise<unknown> {
  return requestJson(client, "/peers/activity", {
    method: "POST",
    body: JSON.stringify({ peer_id: peerId, state }),
  });
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
