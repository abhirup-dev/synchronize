import { spawn } from "node:child_process";
import { ensureDaemon } from "../../client.ts";
import { loadConfig } from "../../config.ts";
import { ENV_SESSION_NAME } from "../../constants.ts";
import { buildAgentCommand, buildLaunchEnv, isLaunchTool, sanitizeLaunchBaseEnv, type LaunchTool } from "../../launch/build.ts";
import { resolveConfiguredAgentLaunchProfile, type ResolvedAgentLaunchProfile } from "../../launch/profiles.ts";
import { getRuntimePaths } from "../../paths.ts";

export async function run(argv: string[]): Promise<void> {
  const parsed = parseLaunchArgs(argv);
  const resolved = await resolveLaunchTarget(parsed);
  await ensureDaemon();
  const launchId = crypto.randomUUID();
  const env = {
    ...sanitizeLaunchBaseEnv(process.env),
    ...(resolved.profile?.env ?? {}),
    ...buildLaunchEnv({
      launchId,
      ...(resolved.name ? { sessionName: resolved.name } : {}),
      ...(resolved.profile ? { profileName: resolved.profile.profileName } : {}),
    }),
  };
  const cmd = buildAgentCommand(
    resolved.target,
    resolved.rest,
    resolved.profile?.bin ? { bin: resolved.profile.bin } : {},
  );
  process.stderr.write(
    `[synchronize launch] target=${resolved.target}${resolved.profile ? ` profile=${resolved.profile.profileName}` : ""} name=${resolved.name ?? "<unset>"} launch_id=${launchId} ${ENV_SESSION_NAME}=${resolved.name ?? "<unset>"} argv=${JSON.stringify(cmd)}\n`,
  );
  const child = spawn(cmd[0]!, cmd.slice(1), {
    stdio: "inherit",
    env,
    ...(resolved.cwd ? { cwd: resolved.cwd } : {}),
  });
  const code = await new Promise<number>((resolve) => {
    child.on("exit", (exitCode, signal) => {
      if (signal) resolve(128);
      else resolve(exitCode ?? 0);
    });
  });
  process.exit(code);
}

export function parseLaunchArgs(argv: string[]): { target: string; name?: string; rest: string[] } {
  let target: string | undefined;
  let name: string | undefined;
  const rest: string[] = [];
  let passThrough = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;

    if (!target) {
      if (arg === "--") {
        continue;
      }
      if (arg === "--name") {
        const next = argv[index + 1];
        if (!next) throw new Error("launch --name requires a value");
        name = next;
        index += 1;
        continue;
      }
      target = arg;
      continue;
    }

    if (passThrough) {
      rest.push(arg);
      continue;
    }
    if (arg === "--") {
      passThrough = true;
      continue;
    }
    if (arg === "--name") {
      const next = argv[index + 1];
      if (!next) throw new Error("launch --name requires a value");
      name = next;
      index += 1;
      continue;
    }
    rest.push(arg);
  }

  if (!target) {
    throw new Error("launch requires a target: claude | pi | letta | configured-profile");
  }
  return name ? { target, name, rest } : { target, rest };
}

async function resolveLaunchTarget(parsed: { target: string; name?: string; rest: string[] }): Promise<{
  target: LaunchTool;
  name?: string;
  rest: string[];
  cwd?: string;
  profile?: ResolvedAgentLaunchProfile;
}> {
  if (isLaunchTool(parsed.target)) {
    return {
      target: parsed.target,
      ...(parsed.name ? { name: parsed.name } : {}),
      rest: parsed.rest,
    };
  }
  const config = await loadConfig(getRuntimePaths().configPath);
  const profile = resolveConfiguredAgentLaunchProfile(config, parsed.target);
  const name = parsed.name ?? profile.sessionName ?? profile.profileName;
  return {
    target: profile.tool,
    name,
    rest: [...profile.args, ...parsed.rest],
    ...(profile.repo ? { cwd: profile.repo } : {}),
    profile,
  };
}
