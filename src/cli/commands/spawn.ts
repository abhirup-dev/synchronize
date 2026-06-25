import { launchAgent } from "../../api/agent-sessions.ts";
import { listPeers } from "../../api/peers.ts";
import type { Peer } from "../../api/types.ts";
import { ensureDaemon } from "../../client.ts";
import { loadConfig, resolveAgentProfile, resolveLettaServerProfile } from "../../config.ts";
import { isLaunchTool, type LaunchTool } from "../../launch/build.ts";
import { resolveConfiguredAgentLaunchProfile, type ResolvedAgentLaunchProfile } from "../../launch/profiles.ts";
import { getRuntimePaths } from "../../paths.ts";
import { run as runRemoteCommand } from "./remote.ts";

/**
 * `synchronize spawn <claude|pi|letta> --name N --repo PATH [--group G] [-- ...toolArgs]`
 *
 * Thin adapter over the daemon launch endpoint: spawns a persistent agent
 * session via the configured backend (AOE), optionally auto-joining a group.
 * Distinct from `synchronize launch`, which runs an agent in the foreground.
 */
export async function run(argv: string[]): Promise<void> {
  const parsed = parseSpawnArgs(argv);
  if (!isLaunchTool(parsed.target)) {
    await spawnConfiguredProfile(parsed);
    return;
  }
  const { target: tool, name, repo, group, model, thinking, args } = parsed;
  if (!name) throw new Error("spawn requires --name NAME");
  if (
    tool === "letta" &&
    (await trySpawnConfiguredLetta({
      name,
      ...(group ? { group } : {}),
      ...(model ? { model } : {}),
      ...(thinking ? { thinking } : {}),
      args,
    }))
  ) return;
  if (!repo) throw new Error("spawn requires --repo PATH");
  const client = await ensureDaemon();
  const result = await launchAgent(client, {
    tool,
    name,
    repo,
    ...(group ? { group } : {}),
    ...(model ? { model } : {}),
    ...(thinking ? { thinking } : {}),
    ...(args.length ? { args } : {}),
  });
  console.log(JSON.stringify(result, null, 2));
}

function parseSpawnArgs(argv: string[]): {
  target: string;
  name?: string;
  repo?: string;
  group?: string;
  model?: string;
  thinking?: string;
  args: string[];
} {
  const [target, ...rest] = argv;
  if (!target) {
    throw new Error("spawn requires a target: claude | pi | letta | configured-profile");
  }
  let name: string | undefined;
  let repo: string | undefined;
  let group: string | undefined;
  let model: string | undefined;
  let thinking: string | undefined;
  const args: string[] = [];
  let passThrough = false;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    if (passThrough) {
      args.push(arg);
      continue;
    }
    if (arg === "--") {
      passThrough = true;
      continue;
    }
    if (arg === "--name" || arg === "--repo" || arg === "--group" || arg === "--model" || arg === "--thinking") {
      const value = rest[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`spawn ${arg} requires a value`);
      if (arg === "--name") name = value;
      else if (arg === "--repo") repo = value;
      else if (arg === "--group") group = value;
      else if (arg === "--model") model = value;
      else thinking = value;
      index += 1;
      continue;
    }
    throw new Error(`spawn: unexpected argument '${arg}' (use -- before tool args)`);
  }
  return { target, ...(name ? { name } : {}), ...(repo ? { repo } : {}), ...(group ? { group } : {}), ...(model ? { model } : {}), ...(thinking ? { thinking } : {}), args };
}

async function spawnConfiguredProfile(parsed: ReturnType<typeof parseSpawnArgs>): Promise<void> {
  const config = await loadConfig(getRuntimePaths().configPath);
  const profile = resolveConfiguredAgentLaunchProfile(config, parsed.target);
  if (
    profile.tool === "letta" &&
    !parsed.repo &&
    (await trySpawnConfiguredLettaProfile(profile, {
      ...(parsed.name ? { name: parsed.name } : {}),
      ...(parsed.group ? { group: parsed.group } : {}),
      ...(parsed.model ? { model: parsed.model } : {}),
      ...(parsed.thinking ? { thinking: parsed.thinking } : {}),
      args: parsed.args,
    }))
  ) return;

  const name = parsed.name ?? profile.sessionName;
  if (!name) throw new Error(`spawn profile '${profile.profileName}' requires --name NAME or session_name in config`);
  const repo = parsed.repo ?? profile.repo;
  if (!repo) throw new Error(`spawn profile '${profile.profileName}' requires --repo PATH or repo in config`);
  const client = await ensureDaemon();
  const result = await launchAgent(client, {
    tool: profile.tool,
    profileName: profile.profileName,
    name,
    repo,
    ...(parsed.group ? { group: parsed.group } : {}),
    ...(parsed.model ?? profile.model ? { model: parsed.model ?? profile.model } : {}),
    ...(parsed.thinking ?? profile.thinking ? { thinking: parsed.thinking ?? profile.thinking } : {}),
    ...(parsed.args.length ? { args: parsed.args } : {}),
  });
  console.log(JSON.stringify(result, null, 2));
}

async function trySpawnConfiguredLetta(input: {
  name: string;
  group?: string;
  model?: string;
  thinking?: string;
  args: string[];
}): Promise<boolean> {
  if (input.group || input.model || input.thinking || input.args.length > 0) return false;
  const config = await loadConfig(getRuntimePaths().configPath);
  const agent = resolveAgentProfile(config, input.name);
  if (!agent) return false;
  if (agent.tool !== "letta") {
    throw new Error(`configured agent '${input.name}' uses tool '${agent.tool}', not letta`);
  }
  if (!agent.server) throw new Error(`configured letta agent '${input.name}' requires server`);
  const server = resolveLettaServerProfile(config, agent.server);
  if (!server) throw new Error(`configured letta server '${agent.server}' not found`);
  if (!server.remote) return false;
  if (!agent.agentId) throw new Error(`configured letta agent '${input.name}' requires agent_id`);

  const sessionName = agent.sessionName ?? input.name;
  const conversationId = agent.conversationId ?? "default";
  const client = await ensureDaemon();
  const running = findRunningLettaPeer(await listConfiguredPeers(client), sessionName);
  if (running) {
    throw new Error(
      `configured letta agent '${input.name}' is already running as '${sessionName}' (peer ${running.peer_id})`,
    );
  }
  const route = `${input.name}:${sessionName}:${agent.agentId}:${conversationId}`;
  await runRemoteCommand([
    "connect",
    server.remote,
    "--letta-agent",
    route,
    "--letta-base-url",
    server.baseUrl,
    "--letta-api-key",
    server.apiKeyEnv ? process.env[server.apiKeyEnv] ?? "dummy" : server.apiKey ?? "dummy",
    ...(agent.pollMs ? ["--poll-ms", String(agent.pollMs)] : []),
  ]);
  console.log(
    JSON.stringify(
      {
        ok: true,
        tool: "letta",
        name: input.name,
        remote: server.remote,
        server: agent.server,
        agent_id: agent.agentId,
        conversation_id: conversationId,
      },
      null,
      2,
    ),
  );
  return true;
}

async function trySpawnConfiguredLettaProfile(
  profile: ResolvedAgentLaunchProfile,
  input: {
    name?: string;
    group?: string;
    model?: string;
    thinking?: string;
    args: string[];
  },
): Promise<boolean> {
  const agent = profile.raw;
  if (input.group || input.model || input.thinking || input.args.length > 0) return false;
  if (!agent.server) return false;
  const config = await loadConfig(getRuntimePaths().configPath);
  const server = resolveLettaServerProfile(config, agent.server);
  if (!server?.remote) return false;
  if (!agent.agentId) throw new Error(`configured letta agent '${profile.profileName}' requires agent_id`);

  const sessionName = input.name ?? agent.sessionName ?? profile.profileName;
  const conversationId = agent.conversationId ?? "default";
  const client = await ensureDaemon();
  const running = findRunningLettaPeer(await listConfiguredPeers(client), sessionName);
  if (running) {
    throw new Error(
      `configured letta agent '${profile.profileName}' is already running as '${sessionName}' (peer ${running.peer_id})`,
    );
  }
  const route = `${profile.profileName}:${sessionName}:${agent.agentId}:${conversationId}`;
  await runRemoteCommand([
    "connect",
    server.remote,
    "--letta-agent",
    route,
    "--letta-base-url",
    server.baseUrl,
    "--letta-api-key",
    server.apiKeyEnv ? process.env[server.apiKeyEnv] ?? "dummy" : server.apiKey ?? "dummy",
    ...(agent.pollMs ? ["--poll-ms", String(agent.pollMs)] : []),
  ]);
  console.log(
    JSON.stringify(
      {
        ok: true,
        tool: "letta",
        name: profile.profileName,
        remote: server.remote,
        server: agent.server,
        agent_id: agent.agentId,
        conversation_id: conversationId,
      },
      null,
      2,
    ),
  );
  return true;
}

async function listConfiguredPeers(client: Awaited<ReturnType<typeof ensureDaemon>>): Promise<Peer[]> {
  const response = await listPeers(client);
  return "peers" in response ? response.peers as Peer[] : [];
}

function findRunningLettaPeer(peers: Peer[], sessionName: string): Peer | null {
  return peers.find((peer) => peer.tool === "letta" && peer.session_name === sessionName && peer.online === true) ?? null;
}
