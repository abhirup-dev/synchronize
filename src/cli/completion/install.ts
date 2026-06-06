import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { renderCarapaceSpec } from "./render-carapace.ts";

export interface InstallCompletionResult {
  path: string;
}

export async function installCarapaceCompletion(
  options: { env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform } = {},
): Promise<InstallCompletionResult> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const dir = carapaceSpecDir(env, platform);
  const path = join(dir, "synchronize.yaml");
  await mkdir(dir, { recursive: true });
  await writeFile(path, renderCarapaceSpec(), "utf8");
  return { path };
}

export function carapaceSpecDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  if (env.CARAPACE_SPECS_DIR) return env.CARAPACE_SPECS_DIR;
  if (platform === "darwin") {
    return join(env.HOME ?? homedir(), "Library", "Application Support", "carapace", "specs");
  }
  return join(env.XDG_CONFIG_HOME ?? join(env.HOME ?? homedir(), ".config"), "carapace", "specs");
}
