import { listGroups } from "../../api/groups.ts";
import { listMedia } from "../../api/media.ts";
import { listPeers } from "../../api/peers.ts";
import { listThreads } from "../../api/threads.ts";
import type { GroupMemberListed } from "../../api/peers.ts";
import type { MediaItem, Peer, ThreadDiscoveryRow } from "../../api/types.ts";
import { type ClientConfig, type Discovery } from "../../client.ts";
import { API_VERSION, ENV_TOKEN } from "../../constants.ts";
import { readJson } from "../../fs.ts";
import { getRuntimePaths } from "../../paths.ts";
import type { CompletionCandidate, CompletionContext, DynamicCompletionProvider } from "./types.ts";

const COMPLETION_HEALTH_TIMEOUT_MS = 250;
const COMPLETION_QUERY_TIMEOUT_MS = 500;

export async function completeDynamicProvider(
  provider: DynamicCompletionProvider,
  options: { context?: CompletionContext; env?: NodeJS.ProcessEnv } = {},
): Promise<CompletionCandidate[]> {
  const client = await completionClient(options.env ?? process.env);
  if (!client) return [];

  try {
    switch (provider) {
      case "group-names":
        return groupCandidates((await withTimeout(listGroups(client), COMPLETION_QUERY_TIMEOUT_MS)).groups);
      case "peer-ids":
        return peerIdCandidates((await withTimeout(listPeers(client), COMPLETION_QUERY_TIMEOUT_MS)).peers);
      case "session-names":
        return sessionNameCandidates((await withTimeout(listPeers(client), COMPLETION_QUERY_TIMEOUT_MS)).peers);
      case "thread-root-event-ids":
        return threadCandidates((await withTimeout(listThreads(client, { limit: 100 }), COMPLETION_QUERY_TIMEOUT_MS)).threads);
      case "media-ids":
        if (!options.context?.group) return [];
        return mediaCandidates((await withTimeout(listMedia(client, { group: options.context.group }), COMPLETION_QUERY_TIMEOUT_MS)).media);
    }
  } catch {
    return [];
  }
}

async function completionClient(env: NodeJS.ProcessEnv): Promise<ClientConfig | null> {
  const paths = getRuntimePaths(env);
  const discovery = await readJson<Discovery>(paths.discoveryPath);
  if (!discovery) return null;
  if (!(await isHealthy(discovery.baseUrl))) return null;
  return {
    baseUrl: discovery.baseUrl,
    token: env[ENV_TOKEN] ?? null,
    paths,
    started: false,
  };
}

async function isHealthy(baseUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), COMPLETION_HEALTH_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}/health`, { signal: controller.signal });
    if (!response.ok) return false;
    const body = await response.json().catch(() => null);
    return body?.service === "synchronize" && body?.api_version === API_VERSION;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function groupCandidates(groups: Array<{ name: string; description?: string | null }>): CompletionCandidate[] {
  return groups.map((group) => ({
    value: group.name,
    ...(group.description ? { description: group.description } : {}),
  }));
}

function peerIdCandidates(peers: Array<Peer | GroupMemberListed>): CompletionCandidate[] {
  return peers.map((peer) => ({
    value: peer.peer_id,
    description: peer.session_name,
  }));
}

function sessionNameCandidates(peers: Array<Peer | GroupMemberListed>): CompletionCandidate[] {
  const seen = new Set<string>();
  const candidates: CompletionCandidate[] = [];
  for (const peer of peers) {
    if (seen.has(peer.session_name)) continue;
    seen.add(peer.session_name);
    candidates.push({ value: peer.session_name, description: peer.peer_id });
  }
  return candidates;
}

function threadCandidates(threads: ThreadDiscoveryRow[]): CompletionCandidate[] {
  return threads.map((thread) => ({
    value: String(thread.root_event_id),
    description: thread.group_name,
  }));
}

function mediaCandidates(media: MediaItem[]): CompletionCandidate[] {
  return media.map((item) => ({
    value: item.media_id,
    description: item.description ?? item.original_path,
  }));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: Timer | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("completion query timed out")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
