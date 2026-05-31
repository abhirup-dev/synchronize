import { spawn } from "node:child_process";
import { ensureDaemon } from "../../client.ts";
import { ENV_SESSION_NAME } from "../../constants.ts";
import { buildAgentCommand, buildLaunchEnv, isLaunchTool, sanitizeLaunchBaseEnv, type LaunchTool } from "../../launch/build.ts";

export async function run(argv: string[]): Promise<void> {
  const { target, name, rest } = parseLaunchArgs(argv);
  await ensureDaemon();
  const launchId = crypto.randomUUID();
  const env = {
    ...sanitizeLaunchBaseEnv(process.env),
    ...buildLaunchEnv({ launchId, ...(name ? { sessionName: name } : {}) }),
  };
  const cmd = buildAgentCommand(target, rest);
  process.stderr.write(
    `[synchronize launch] target=${target} name=${name ?? "<unset>"} launch_id=${launchId} ${ENV_SESSION_NAME}=${name ?? "<unset>"} argv=${JSON.stringify(cmd)}\n`,
  );
  const child = spawn(cmd[0]!, cmd.slice(1), {
    stdio: "inherit",
    env,
  });
  const code = await new Promise<number>((resolve) => {
    child.on("exit", (exitCode, signal) => {
      if (signal) resolve(128);
      else resolve(exitCode ?? 0);
    });
  });
  process.exit(code);
}

export function parseLaunchArgs(argv: string[]): { target: LaunchTool; name?: string; rest: string[] } {
  let target: LaunchTool | undefined;
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
      if (isLaunchTool(arg)) {
        target = arg;
        continue;
      }
      throw new Error("launch requires one of: claude, pi, letta");
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
    throw new Error("launch requires one of: claude, pi, letta");
  }
  return name ? { target, name, rest } : { target, rest };
}
