import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ENV_HOME, ENV_HOOK_ENABLE, ENV_LAUNCH_ID, ENV_PEER_ID, ENV_SESSION_NAME } from "../constants.ts";

export type LaunchTool = "claude" | "pi" | "letta";

export function isLaunchTool(value: string): value is LaunchTool {
  return value === "claude" || value === "pi" || value === "letta";
}

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

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
    // Register the synchronize MCP server as a live push channel. A `server:`
    // channel only registers when loaded as a development channel (decompiled
    // claude: a server channel registers only when O.dev===true; the
    // `allowedChannelPlugins` allowlist gates marketplace plugins only, never
    // `server:` channels — see bd sync-zst). This flag triggers an interactive
    // "local development" confirmation on every launch; the AOE backend
    // auto-dismisses it via tmux send-keys after spawn so the session is
    // unattended. (`--channels server:synchronize` would skip the prompt but
    // also skips channel registration → no live push.)
    if (!args.includes("--dangerously-load-development-channels")) {
      args.unshift("--dangerously-load-development-channels", "server:synchronize");
    }
    return ["claude", ...args];
  }
  if (tool === "letta") {
    return ["bun", "run", join(REPO_ROOT, "extensions/letta-synchronize/src/index.ts"), ...rest];
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
