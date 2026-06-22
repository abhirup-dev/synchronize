import { readFileSync } from "node:fs";
import { parseConfig, resolveAgentProfile, type AgentEnvValue, type AgentProfile, type SynchronizeConfig } from "../config.ts";
import { isLaunchTool, type LaunchTool } from "./build.ts";

export const RESERVED_AGENT_PROFILE_NAMES = new Set<LaunchTool>(["claude", "pi", "letta"]);

export interface ResolvedAgentLaunchProfile {
  profileName: string;
  tool: LaunchTool;
  bin?: string;
  repo?: string;
  model?: string;
  thinking?: string;
  args: string[];
  env: Record<string, string>;
  sessionName?: string;
  raw: AgentProfile;
}

export function assertValidAgentProfileName(name: string): void {
  if ((RESERVED_AGENT_PROFILE_NAMES as Set<string>).has(name)) {
    throw new Error(`agent profile '${name}' conflicts with built-in launch tool names: claude, pi, letta`);
  }
}

export function resolveConfiguredAgentLaunchProfile(
  config: SynchronizeConfig,
  profileName: string,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedAgentLaunchProfile {
  assertValidAgentProfileName(profileName);
  const profile = resolveAgentProfile(config, profileName);
  if (!profile) throw new Error(`agent profile '${profileName}' not found`);
  if (!isLaunchTool(profile.tool)) {
    throw new Error(`agent profile '${profileName}' uses unsupported launch tool '${profile.tool}'`);
  }
  return {
    profileName,
    tool: profile.tool,
    ...(profile.bin ? { bin: profile.bin } : {}),
    ...(profile.repo ? { repo: profile.repo } : {}),
    ...(profile.model ? { model: profile.model } : {}),
    ...(profile.thinking ? { thinking: profile.thinking } : {}),
    args: profile.args ?? [],
    env: resolveAgentProfileEnv(profileName, profile.env ?? {}, env),
    ...(profile.sessionName ? { sessionName: profile.sessionName } : {}),
    raw: profile,
  };
}

export function resolveConfiguredAgentLaunchProfileFromPath(
  configPath: string,
  profileName: string,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedAgentLaunchProfile {
  let text: string;
  try {
    text = readFileSync(configPath, "utf8");
  } catch (error) {
    throw new Error(`agent profile '${profileName}' could not be loaded from ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return resolveConfiguredAgentLaunchProfile(parseConfig(text), profileName, env);
}

function resolveAgentProfileEnv(
  profileName: string,
  values: Record<string, AgentEnvValue>,
  env: NodeJS.ProcessEnv,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [targetKey, value] of Object.entries(values)) {
    if (typeof value === "string") {
      resolved[targetKey] = value;
      continue;
    }
    if ("fromEnv" in value) {
      const raw = env[value.fromEnv];
      if (raw === undefined) {
        throw new Error(`agent profile '${profileName}' env '${targetKey}' requires source env '${value.fromEnv}'`);
      }
      resolved[targetKey] = raw;
      continue;
    }
    try {
      resolved[targetKey] = readFileSync(value.fromFile, "utf8").replace(/[\r\n]+$/, "");
    } catch (error) {
      throw new Error(`agent profile '${profileName}' env '${targetKey}' could not read ${value.fromFile}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return resolved;
}
