import { spawn } from "node:child_process";
import { ensureDaemon } from "../../client.ts";
import { ENV_HOOK_ENABLE, ENV_LAUNCH_ID, ENV_SESSION_NAME } from "../../constants.ts";

export async function run(argv: string[]): Promise<void> {
  const { target, name, rest } = parseLaunchArgs(argv);
  await ensureDaemon();
  const env = {
    ...process.env,
    [ENV_HOOK_ENABLE]: "1",
    [ENV_LAUNCH_ID]: crypto.randomUUID(),
    ...(name ? { [ENV_SESSION_NAME]: name } : {}),
  };
  const cmd = buildCommand(target, rest);
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

function parseLaunchArgs(argv: string[]): { target: string; name?: string; rest: string[] } {
  const [target, ...args] = argv;
  if (target !== "claude" && target !== "pi") {
    throw new Error("launch requires one of: claude, pi");
  }
  let name: string | undefined;
  const rest: string[] = [];
  let passThrough = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (passThrough) {
      rest.push(arg);
      continue;
    }
    if (arg === "--") {
      passThrough = true;
      continue;
    }
    if (arg === "--name") {
      const next = args[index + 1];
      if (!next) throw new Error("launch --name requires a value");
      name = next;
      index += 1;
      continue;
    }
    rest.push(arg);
  }
  return name ? { target, name, rest } : { target, rest };
}

function buildCommand(target: string, rest: string[]): string[] {
  if (target === "claude") {
    const args = [...rest];
    if (!args.includes("--dangerously-skip-permissions")) {
      args.unshift("--dangerously-skip-permissions");
    }
    if (!args.includes("--dangerously-load-development-channels")) {
      args.unshift("--dangerously-load-development-channels", "server:synchronize");
    }
    return ["claude", ...args];
  }
  return ["pi", ...rest];
}
