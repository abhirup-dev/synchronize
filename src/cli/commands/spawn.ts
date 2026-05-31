import { launchAgent } from "../../api/agent-sessions.ts";
import { ensureDaemon } from "../../client.ts";
import { isLaunchTool, type LaunchTool } from "../../launch/build.ts";

/**
 * `synchronize spawn <claude|pi> --name N --repo PATH [--group G] [-- ...toolArgs]`
 *
 * Thin adapter over the daemon launch endpoint: spawns a persistent agent
 * session via the configured backend (AOE), optionally auto-joining a group.
 * Distinct from `synchronize launch`, which runs an agent in the foreground.
 */
export async function run(argv: string[]): Promise<void> {
  const { tool, name, repo, group, model, thinking, args } = parseSpawnArgs(argv);
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
  repo: string;
  group?: string;
  model?: string;
  thinking?: string;
  args: string[];
} {
  const [tool, ...rest] = argv;
  if (!tool || !isLaunchTool(tool)) {
    throw new Error("spawn requires a tool: claude | pi");
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
  if (!repo) throw new Error("spawn requires --repo PATH");
  return { tool, name, repo, ...(group ? { group } : {}), ...(model ? { model } : {}), ...(thinking ? { thinking } : {}), args };
}
