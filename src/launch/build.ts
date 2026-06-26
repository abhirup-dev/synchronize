import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ENV_HOME, ENV_HOOK_ENABLE, ENV_LAUNCH_ID, ENV_PEER_ID, ENV_PROFILE_NAME, ENV_SESSION_NAME } from "../constants.ts";

export type LaunchTool = "claude" | "pi" | "letta";

export function isLaunchTool(value: string): value is LaunchTool {
  return value === "claude" || value === "pi" || value === "letta";
}

export const LAUNCH_ENV_UNSET_KEYS = [
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "GRPC_DEFAULT_SSL_ROOTS_FILE_PATH",
] as const;
const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/**
 * Build the bare agent command (binary + args) for a launch target.
 *
 * Shared by the foreground CLI (`synchronize launch`) and the daemon-managed
 * AOE launch path. The CLI spawns this directly; the AOE path wraps it as
 * `env K=V … <command>` for `aoe add --cmd-override`. Either way the produced
 * argv is identical, so the two surfaces never drift.
 */
export interface AgentCommandOptions {
  bin?: string;
}

export function buildAgentCommand(tool: LaunchTool, rest: string[], options: AgentCommandOptions = {}): string[] {
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
    return [options.bin ?? "claude", ...args];
  }
  if (tool === "letta") {
    return options.bin ? [options.bin, ...rest] : ["bun", "run", join(REPO_ROOT, "extensions/letta-synchronize/src/index.ts"), ...rest];
  }
  return [options.bin ?? "pi", ...rest];
}

export interface ResumeTarget {
  /** The captured host session id (claude --resume / pi --session). */
  hostSessionId: string;
  /** Pi may resume by session file path; preferred over the id when present. */
  hostSessionFile?: string | null;
}

/**
 * Build the FAITHFUL-RESUME agent command — the same argv as a fresh launch, but
 * reattaching the original conversation rather than starting a new one.
 *
 *   claude: claude --resume <host_session_id> …flags   (NEVER --fork-session —
 *           forking would mint a new session id and break host_session_id
 *           correlation, so the resumed agent would not re-bind to its identity)
 *   pi:     pi --session <host_session_id|file> …rest   (NOT -r, which opens an
 *           interactive picker rather than resuming a specific session)
 *
 * The archived peer_id is reused via ENV_PEER_ID (buildLaunchEnv), so the
 * re-registration on boot matches the archived identity and resurrects it.
 */
export function buildAgentResumeCommand(
  tool: LaunchTool,
  target: ResumeTarget,
  rest: string[],
  options: AgentCommandOptions = {},
): string[] {
  const base = buildAgentCommand(tool, rest, options); // ["claude"|"pi", ...flags]
  if (tool === "claude") {
    return [options.bin ?? "claude", "--resume", target.hostSessionId, ...base.slice(1)];
  }
  if (tool === "pi") {
    const session = target.hostSessionFile ?? target.hostSessionId;
    return [options.bin ?? "pi", "--session", session, ...base.slice(1)];
  }
  throw new Error("letta launches do not support faithful resume yet");
}

export interface LaunchEnvInput {
  /** Short-lived correlation key shared by launcher, hook, and MCP process. */
  launchId: string;
  /** Stable session name for hook/Pi registration. */
  sessionName?: string;
  /** Configured [agent.NAME] launch profile, if this process came from one. */
  profileName?: string;
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
  if (input.profileName) env[ENV_PROFILE_NAME] = input.profileName;
  if (input.peerId) env[ENV_PEER_ID] = input.peerId;
  if (input.home) env[ENV_HOME] = input.home;
  return env;
}

/**
 * Copy a caller environment for agent launch while dropping trust-store
 * overrides that can force child MCP binaries onto the wrong CA bundle.
 */
export function sanitizeLaunchBaseEnv(base: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) continue;
    if ((LAUNCH_ENV_UNSET_KEYS as readonly string[]).includes(key)) continue;
    env[key] = value;
  }
  return env;
}
