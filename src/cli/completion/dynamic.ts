import { listAgentSessions } from "../../api/agent-sessions.ts";
import { listGroups } from "../../api/groups.ts";
import { listMedia } from "../../api/media.ts";
import { listPeers } from "../../api/peers.ts";
import { queryEvents } from "../../api/query.ts";
import { listThreads } from "../../api/threads.ts";
import type { GroupMemberListed } from "../../api/peers.ts";
import type { AgentSessionBinding, MediaItem, Peer, ThreadDiscoveryRow } from "../../api/types.ts";
import { type ClientConfig, type Discovery } from "../../client.ts";
import { probeDaemon } from "../../daemon-probe.ts";
import { ENV_TOKEN } from "../../constants.ts";
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
      case "peer-ids": {
        const peers = (await withTimeout(listPeers(client), COMPLETION_QUERY_TIMEOUT_MS)).peers;
        const memberships = await peerGroupLabels(client);
        return peerIdCandidates(peers, memberships);
      }
      case "session-ids": {
        const bindings = (await withTimeout(listAgentSessions(client), COMPLETION_QUERY_TIMEOUT_MS)).bindings;
        const memberships = await peerGroupLabels(client);
        return sessionIdCandidates(bindings, memberships);
      }
      case "session-names": {
        const peers = (await withTimeout(listPeers(client), COMPLETION_QUERY_TIMEOUT_MS)).peers;
        const memberships = await peerGroupLabels(client);
        return sessionNameCandidates(peers, memberships);
      }
      case "thread-root-event-ids":
        return threadCandidates((await withTimeout(listThreads(client, { limit: 100 }), COMPLETION_QUERY_TIMEOUT_MS)).threads);
      case "media-ids":
        if (!options.context?.group) return allMediaCandidates(await withTimeout(queryEvents(client, {
          sql: "select media_id, original_path, description from media_items order by created_at desc limit 100",
        }), COMPLETION_QUERY_TIMEOUT_MS));
        return mediaCandidates((await withTimeout(listMedia(client, { group: options.context.group }), COMPLETION_QUERY_TIMEOUT_MS)).media);
    }
  } catch {
    return [];
  }
}

function allMediaCandidates(response: { rows: Record<string, unknown>[] }): CompletionCandidate[] {
  return response.rows.flatMap((row) => {
    if (typeof row.media_id !== "string") return [];
    const description =
      typeof row.description === "string" && row.description
        ? row.description
        : typeof row.original_path === "string"
          ? row.original_path
          : undefined;
    return [{
      value: row.media_id,
      ...(description ? { description } : {}),
    }];
  });
}

async function completionClient(env: NodeJS.ProcessEnv): Promise<ClientConfig | null> {
  const paths = getRuntimePaths(env);
  const discovery = await readJson<Discovery>(paths.discoveryPath);
  if (!discovery) return null;
  // Tab completion is latency-bound: it must never retry and never block on a
  // slow daemon. Any non-healthy verdict simply means "no completions", so the
  // probe's classification is deliberately discarded here.
  const probe = await probeDaemon(discovery.baseUrl, {
    timeoutMs: COMPLETION_HEALTH_TIMEOUT_MS,
    token: env[ENV_TOKEN] ?? null,
    attempts: 1,
  });
  if (probe.kind !== "healthy") return null;
  return {
    baseUrl: discovery.baseUrl,
    token: env[ENV_TOKEN] ?? null,
    paths,
    started: false,
  };
}

function groupCandidates(groups: Array<{ name: string; description?: string | null }>): CompletionCandidate[] {
  return groups.map((group) => ({
    value: group.name,
    ...(group.description ? { description: group.description } : {}),
  }));
}

function peerIdCandidates(peers: Array<Peer | GroupMemberListed>, memberships: Map<string, string[]>): CompletionCandidate[] {
  return peers.map((peer) => ({
    value: peer.peer_id,
    description: readablePeerDescription(peer, memberships.get(peer.peer_id) ?? []),
  }));
}

function sessionNameCandidates(peers: Array<Peer | GroupMemberListed>, memberships: Map<string, string[]>): CompletionCandidate[] {
  const seen = new Set<string>();
  const candidates: CompletionCandidate[] = [];
  for (const peer of peers) {
    if (seen.has(peer.session_name)) continue;
    seen.add(peer.session_name);
    candidates.push({ value: peer.session_name, description: readablePeerDescription(peer, memberships.get(peer.peer_id) ?? [], { includeName: false }) });
  }
  return candidates;
}

function sessionIdCandidates(bindings: AgentSessionBinding[], memberships: Map<string, string[]>): CompletionCandidate[] {
  return bindings.map((binding) => ({
    value: binding.host_session_id,
    description: readableSessionDescription(binding, memberships.get(binding.peer_id) ?? []),
  }));
}

function threadCandidates(threads: ThreadDiscoveryRow[]): CompletionCandidate[] {
  return threads.map((thread) => ({
    value: String(thread.root_event_id),
    description: joinDescription([
      thread.group_name,
      thread.root_sender_alias ?? thread.root_sender_session_name,
      `${thread.reply_count} replies`,
      `active ${formatTimestamp(thread.last_activity_at)}`,
    ]),
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

async function peerGroupLabels(client: ClientConfig): Promise<Map<string, string[]>> {
  try {
    const groups = (await withTimeout(listGroups(client), COMPLETION_QUERY_TIMEOUT_MS)).groups.slice(0, 25);
    const memberLists = await withTimeout(
      Promise.all(groups.map(async (group) => ({ group: group.name, peers: (await listPeers(client, { group: group.name })).peers }))),
      COMPLETION_QUERY_TIMEOUT_MS,
    );
    const labels = new Map<string, string[]>();
    for (const entry of memberLists) {
      for (const peer of entry.peers) {
        const label = "alias" in peer && peer.alias ? `${peer.alias}@${entry.group}` : entry.group;
        labels.set(peer.peer_id, [...(labels.get(peer.peer_id) ?? []), label]);
      }
    }
    return labels;
  } catch {
    return new Map();
  }
}

function readableSessionDescription(binding: AgentSessionBinding, membershipLabels: string[]): string {
  return joinDescription([
    binding.host_tool,
    binding.peer.session_name,
    membershipLabels.slice(0, 2).join(", "),
    binding.peer.presence ?? (binding.peer.online ? "online" : "offline"),
    binding.model,
    binding.git_branch ? `${binding.git_branch}${binding.git_dirty ? " dirty" : ""}` : null,
    `seen ${formatTimestamp(binding.last_seen_at)}`,
  ]);
}

function readablePeerDescription(peer: Peer | GroupMemberListed, membershipLabels: string[], options: { includeName?: boolean } = {}): string {
  const includeName = options.includeName ?? true;
  return joinDescription([
    peer.tool,
    includeName ? peer.session_name : null,
    membershipLabels.slice(0, 2).join(", "),
    "alias" in peer && peer.alias ? `alias ${peer.alias}` : null,
    "joined_at" in peer ? `joined ${formatTimestamp(peer.joined_at)}` : null,
    "presence" in peer ? peer.presence : peer.online ? "online" : "offline",
    peer.purpose,
    "machine_id" in peer && peer.machine_id ? `machine ${peer.machine_id}` : null,
  ]);
}

function joinDescription(parts: Array<string | null | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join(" | ");
}

function formatTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.replace(/\.\d{3}Z$/, "Z").replace("T", " ");
}
