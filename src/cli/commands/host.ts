import { getStatus } from "../../api/status.ts";
import { ensureDaemon, type Discovery } from "../../client.ts";
import { DEFAULT_PORT, ENV_BIND, ENV_HOME, ENV_PORT, ENV_REMOTE_URL, ENV_TOKEN } from "../../constants.ts";
import { readJson, removePath } from "../../fs.ts";
import { getRuntimePaths } from "../../paths.ts";

export interface HostArgs {
  bind: string;
  port: string;
  token: string;
  home?: string;
  restart: boolean;
}

export async function run(argv: string[]): Promise<void> {
  const args = parseHostArgs(argv);
  if (args.home) process.env[ENV_HOME] = args.home;
  process.env[ENV_BIND] = args.bind;
  process.env[ENV_PORT] = args.port;
  process.env[ENV_TOKEN] = args.token;
  delete process.env[ENV_REMOTE_URL];

  const paths = getRuntimePaths();
  const existing = await readJson<Discovery>(paths.discoveryPath);
  if (existing && (await discoveryIsHealthy(existing))) {
    const compatible = existing.host === args.bind && (args.port === "0" || String(existing.port) === args.port) && existing.tokenRequired;
    if (!compatible) {
      if (!args.restart) {
        throw new Error(
          `Existing daemon at ${existing.baseUrl} does not match requested host settings; rerun with --restart to relaunch it`,
        );
      }
      await stopDaemon(existing.pid);
      await removePath(paths.discoveryPath);
    }
  }

  const client = await ensureDaemon();
  const status = await getStatus(client);
  if (status.host !== args.bind) {
    throw new Error(`Expected daemon host ${args.bind}, got ${status.host}`);
  }
  if (args.port !== "0" && String(status.port) !== args.port) {
    throw new Error(`Expected daemon port ${args.port}, got ${status.port}`);
  }
  if (!status.token_required) {
    throw new Error(`Expected token-protected daemon; set ${ENV_TOKEN}`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: "mac-host",
        daemon_started_by_cli: client.started,
        pid: status.pid,
        host: status.host,
        port: status.port,
        base_url: status.base_url,
        home: status.home,
        token_required: status.token_required,
        remote_env: {
          SYNCHRONIZE_REMOTE_URL: status.base_url,
          SYNCHRONIZE_TOKEN: "<shared-token>",
        },
      },
      null,
      2,
    ),
  );
}

export function parseHostArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): HostArgs {
  let bind = env[ENV_BIND];
  let port = env[ENV_PORT] ?? String(DEFAULT_PORT);
  let token = env[ENV_TOKEN];
  let home = env[ENV_HOME];
  let restart = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--restart") {
      restart = true;
      continue;
    }
    if (arg === "--bind" || arg === "--port" || arg === "--token" || arg === "--home") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`host ${arg} requires a value`);
      if (arg === "--bind") bind = value;
      else if (arg === "--port") port = value;
      else if (arg === "--token") token = value;
      else home = value;
      index += 1;
      continue;
    }
    throw new Error(`host: unexpected argument '${arg}'`);
  }

  if (!bind) throw new Error(`host requires --bind HOST or ${ENV_BIND}`);
  if (!token) throw new Error(`host requires --token TOKEN or ${ENV_TOKEN}`);
  if (!/^\d+$/.test(port)) throw new Error("host --port must be a non-negative integer");
  return { bind, port, token, ...(home ? { home } : {}), restart };
}

async function discoveryIsHealthy(discovery: Discovery): Promise<boolean> {
  try {
    const response = await fetch(`${discovery.baseUrl}/health`);
    if (!response.ok) return false;
    const body = await response.json().catch(() => null);
    return body?.service === "synchronize";
  } catch {
    return false;
  }
}

async function stopDaemon(pid: number): Promise<void> {
  try {
    process.kill(pid);
  } catch {
    return;
  }
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await Bun.sleep(50);
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    return;
  }
}
