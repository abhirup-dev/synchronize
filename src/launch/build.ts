import { ENV_HOME, ENV_HOOK_ENABLE, ENV_LAUNCH_ID, ENV_PEER_ID, ENV_SESSION_NAME } from "../constants.ts";

export type LaunchTool = "claude" | "pi";

export function isLaunchTool(value: string): value is LaunchTool {
  return value === "claude" || value === "pi";
}

/**
 * Build the bare agent command (binary + args) for a launch target.
 *
 * Shared by the foreground CLI (`synchronize launch`) and the daemon-managed
 * AOE launch path. The CLI spawns this directly; the AOE path wraps it as
 * `env K=V … <command>` for `aoe add --cmd-override`. Either way the produced
 * argv is identical, so the two surfaces never drift.
 */
export function buildAgentCommand(tool: LaunchTool, rest: string[]): string[] {
  if (tool === "claude") {
    const args = [...rest];
    if (!args.includes("--dangerously-skip-permissions")) {
      args.unshift("--dangerously-skip-permissions");
    }
    // Opt the synchronize MCP server in as a live channel. `--channels
    // server:<name>` is the supported path for a manually-configured MCP
    // server and runs non-interactively. (NOT
    // `--dangerously-load-development-channels`, which is for channels you are
    // *building* and triggers an interactive "local development" confirmation
    // on every launch — fatal for an unattended spawned session.)
    if (!args.includes("--channels")) {
      args.unshift("--channels", "server:synchronize");
    }
    return ["claude", ...args];
  }
  return ["pi", ...rest];
}

export interface LaunchEnvInput {
  /** Short-lived correlation key shared by launcher, hook, and MCP process. */
  launchId: string;
  /** Stable session name for hook/Pi registration. */
  sessionName?: string;
  /** Pinned peer id so the daemon knows the durable identity before boot. */
  peerId?: string;
  /** SYNCHRONIZE_HOME, so the agent registers to the launching daemon. */
  home?: string;
}

/**
 * The synchronize-specific environment additions for a launched agent.
 *
 * Returns only the keys synchronize owns; callers merge these over the base
 * environment (CLI: `process.env`; AOE: an explicit `env` prefix). Optional
 * keys are omitted when absent so a bare CLI launch stays identical to today.
 */
export function buildLaunchEnv(input: LaunchEnvInput): Record<string, string> {
  const env: Record<string, string> = {
    [ENV_HOOK_ENABLE]: "1",
    [ENV_LAUNCH_ID]: input.launchId,
  };
  if (input.sessionName) env[ENV_SESSION_NAME] = input.sessionName;
  if (input.peerId) env[ENV_PEER_ID] = input.peerId;
  if (input.home) env[ENV_HOME] = input.home;
  return env;
}
