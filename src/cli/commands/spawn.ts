import { launchAgent } from "../../api/agent-sessions.ts";
import { listPeers } from "../../api/peers.ts";
import type { Peer } from "../../api/types.ts";
import { ensureDaemon } from "../../client.ts";
import { loadConfig, resolveAgentProfile, resolveLettaServerProfile } from "../../config.ts";
import { isLaunchTool, type LaunchTool } from "../../launch/build.ts";
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
  const { tool, name, repo, group, model, thinking, args } = parseSpawnArgs(argv);
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
  tool: LaunchTool;
  name: string;
  repo?: string;
  group?: string;
  model?: string;
  thinking?: string;
  args: string[];
} {
  const [tool, ...rest] = argv;
  if (!tool || !isLaunchTool(tool)) {
    throw new Error("spawn requires a tool: claude | pi | letta");
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
  if (!name) throw new Error("spawn requires --name NAME");
  return { tool, name, ...(repo ? { repo } : {}), ...(group ? { group } : {}), ...(model ? { model } : {}), ...(thinking ? { thinking } : {}), args };
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

async function listConfiguredPeers(client: Awaited<ReturnType<typeof ensureDaemon>>): Promise<Peer[]> {
  const response = await listPeers(client);
  return "peers" in response ? response.peers as Peer[] : [];
}

function findRunningLettaPeer(peers: Peer[], sessionName: string): Peer | null {
  return peers.find((peer) => peer.tool === "letta" && peer.session_name === sessionName && peer.online === true) ?? null;
}
