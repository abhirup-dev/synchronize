import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RuntimePaths } from "./paths.ts";
import { isMissing } from "./fs.ts";

const ENV_DIR = ".env";
const DAEMON_ENV_FILES = ["daemon.env", "synchronize.env"];

export function daemonEnvFilePaths(paths: RuntimePaths, sourceRoot: string): string[] {
  return [
    ...DAEMON_ENV_FILES.map((file) => join(sourceRoot, ENV_DIR, file)),
    ...DAEMON_ENV_FILES.map((file) => join(paths.home, ENV_DIR, file)),
  ];
}

export async function loadDaemonEnvFiles(
  paths: RuntimePaths,
  sourceRoot: string,
  baseEnv: NodeJS.ProcessEnv = process.env,
): Promise<Record<string, string>> {
  const loaded: Record<string, string> = {};
  for (const path of daemonEnvFilePaths(paths, sourceRoot)) {
    const parsed = await readEnvFile(path);
    for (const [key, value] of Object.entries(parsed)) {
      if (baseEnv[key] !== undefined || loaded[key] !== undefined) continue;
      loaded[key] = value;
    }
  }
  return loaded;
}

export async function applyDaemonEnvFiles(
  paths: RuntimePaths,
  sourceRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string[]> {
  const loaded = await loadDaemonEnvFiles(paths, sourceRoot, env);
  for (const [key, value] of Object.entries(loaded)) env[key] = value;
  return Object.keys(loaded);
}

async function readEnvFile(path: string): Promise<Record<string, string>> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (isMissing(error)) return {};
    throw error;
  }

  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) continue;
    out[match[1]!] = parseEnvValue(match[2]!.trim());
  }
  return out;
}

function parseEnvValue(value: string): string {
  const quote = value[0];
  if ((quote === `"` || quote === `'`) && value.endsWith(quote)) {
    const inner = value.slice(1, -1);
    if (quote === `"`) {
      return inner
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\t/g, "\t")
        .replace(/\\"/g, `"`)
        .replace(/\\\\/g, "\\");
    }
    return inner;
  }
  const comment = value.match(/\s+#/);
  return (comment ? value.slice(0, comment.index) : value).trim();
}
