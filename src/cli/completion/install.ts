import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { renderTabSetupScript, type TabShell } from "./render-tab.ts";

export interface InstallCompletionResult {
  path: string;
  sourceHint: string;
}

export async function installTabCompletion(
  shell: TabShell,
  options: { env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform } = {},
): Promise<InstallCompletionResult> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const path = tabCompletionPath(shell, env, platform);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, renderTabSetupScript(shell), "utf8");
  return { path, sourceHint: sourceHint(shell, path) };
}

export function tabCompletionPath(
  shell: TabShell,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  if (env.SYNCHRONIZE_COMPLETION_PATH) return env.SYNCHRONIZE_COMPLETION_PATH;
  if (shell === "fish") return join(configHome(env), "fish", "completions", "synchronize.fish");
  if (shell === "powershell") return join(powershellProfileDir(env, platform), "synchronize-completion.ps1");
  return join(configHome(env), "synchronize", "completions", `synchronize.${shell}`);
}

function configHome(env: NodeJS.ProcessEnv): string {
  return env.XDG_CONFIG_HOME ?? join(env.HOME ?? homedir(), ".config");
}

function powershellProfileDir(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, "powershell");
  if (platform === "win32") return join(env.USERPROFILE ?? homedir(), "Documents", "PowerShell");
  return join(env.HOME ?? homedir(), ".config", "powershell");
}

function sourceHint(shell: TabShell, path: string): string {
  if (shell === "fish") return "fish loads this file automatically on new shell sessions";
  if (shell === "powershell") return `. ${path}`;
  return `source ${path}`;
}
