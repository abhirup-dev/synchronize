import { serializeConfig } from "../config.ts";

// Pure builders for the `synchronize remote provision`/`sync` command plans.
// Keeping plan-construction separate from execution makes the exact ssh/rsync
// invocations unit-testable and gives `--dry-run` something concrete to print
// before any remote machine is touched.

export interface RemoteStep {
  name: string;
  /** argv executed locally (ssh/rsync/scp invocations are themselves argv). */
  argv: string[];
  /** Optional stdin piped to the process (used to write remote files safely). */
  stdin?: string;
  /** A failing optional step is reported but does not abort the plan. */
  optional?: boolean;
}

export interface ProvisionPlanInput {
  sshHost: string;
  /** Tools to verify are runnable on the remote. */
  tools?: string[];
  /** Dir that should be on PATH for non-interactive ssh (default ~/.local/bin). */
  localBin?: string;
}

const DEFAULT_TOOLS = ["bun", "aoe", "pi", "claude", "uv", "tmux", "rsync", "git"];
const DEFAULT_EXCLUDES = ["node_modules", ".git", "web/dist", ".beads", "*.log"];

/**
 * Verify the remote has the tools we need and that ~/.local/bin is reachable for
 * non-interactive ssh (the documented gotcha). We resolve each tool against an
 * augmented PATH so a tool that only lives in ~/.local/bin still counts.
 */
export function buildProvisionPlan(input: ProvisionPlanInput): RemoteStep[] {
  const localBin = input.localBin ?? "$HOME/.local/bin";
  const tools = input.tools ?? DEFAULT_TOOLS;
  const check = tools
    .map((t) => `command -v ${t} >/dev/null 2>&1 && echo "ok   ${t}" || echo "MISS ${t}"`)
    .join("; ");
  return [
    {
      name: "verify tools (PATH-augmented)",
      argv: ["ssh", input.sshHost, `export PATH="${localBin}:$PATH"; ${check}`],
    },
    {
      name: "report non-interactive PATH",
      argv: ["ssh", input.sshHost, `echo "PATH=$PATH"; echo "localBin=${localBin}"`],
    },
  ];
}

export interface SyncPlanInput {
  sshHost: string;
  /** Absolute (or ~-relative) remote dir to rsync the runtime into. */
  remotePath: string;
  /** Local repo root to sync from. */
  localRoot: string;
  /** Hub daemon URL the remote client should point at. */
  hubUrl: string;
  /** Either a literal token (written into config.toml) or an env var name. */
  token?: string;
  tokenEnv?: string;
  /** Remote SYNCHRONIZE_HOME where config.toml is written (default ~/.synchronize). */
  remoteHome?: string;
  excludes?: string[];
  /** Skip `bun install` (e.g. when deps are unchanged). */
  skipInstall?: boolean;
}

/** Render the config.toml the remote client uses to reach the hub. */
export function renderRemoteConfig(input: Pick<SyncPlanInput, "hubUrl" | "token" | "tokenEnv">): string {
  return serializeConfig({
    active: "hub",
    remotes: {
      hub: {
        url: input.hubUrl,
        ...(input.tokenEnv ? { tokenEnv: input.tokenEnv } : {}),
        ...(input.token ? { token: input.token } : {}),
      },
    },
  });
}

export function buildSyncPlan(input: SyncPlanInput): RemoteStep[] {
  const excludes = input.excludes ?? DEFAULT_EXCLUDES;
  const remoteHome = input.remoteHome ?? "$HOME/.synchronize";
  const steps: RemoteStep[] = [
    {
      name: "ensure remote dirs",
      argv: ["ssh", input.sshHost, `mkdir -p ${shq(input.remotePath)} ${remoteHome}`],
    },
    {
      name: "rsync runtime",
      argv: [
        "rsync",
        "-az",
        "--delete",
        ...excludes.flatMap((e) => ["--exclude", e]),
        `${stripTrailingSlash(input.localRoot)}/`,
        `${input.sshHost}:${input.remotePath}/`,
      ],
    },
  ];
  if (!input.skipInstall) {
    steps.push({
      name: "bun install (remote)",
      argv: ["ssh", input.sshHost, `cd ${shq(input.remotePath)} && bun install`],
    });
  }
  steps.push({
    name: "write remote config.toml",
    argv: ["ssh", input.sshHost, `mkdir -p ${remoteHome} && cat > ${remoteHome}/config.toml`],
    stdin: renderRemoteConfig(input),
  });
  steps.push({
    name: "verify hub reachable from remote",
    argv: ["ssh", input.sshHost, `curl -fsS -m 5 ${shq(input.hubUrl)}/health`],
    optional: true,
  });
  return steps;
}

// ---------------------------------------------------------------------------
// Run the Python AOE integration harness on a remote, pointed at the hub.
// Each scenario is a `uv run --script` entrypoint; per-scenario default
// timeouts mirror scripts/README.md (Pi scenarios need generous warmup).
// ---------------------------------------------------------------------------

export interface HarnessScenario {
  script: string;
  defaultArgs: string[];
}

export const HARNESS_SCENARIOS: Record<string, HarnessScenario> = {
  "cli-dm": { script: "scripts/integration_tmux.py", defaultArgs: ["--start-timeout", "90", "--command-timeout", "45"] },
  "cli-group-policy": { script: "scripts/integration_group_policy_tmux.py", defaultArgs: ["--start-timeout", "90", "--command-timeout", "45"] },
  "pi-dm": { script: "scripts/integration_pi.py", defaultArgs: ["--start-timeout", "120", "--command-timeout", "180", "--registration-timeout", "120", "--warmup-timeout", "120"] },
  "pi-group-policy": { script: "scripts/integration_group_policy_pi.py", defaultArgs: ["--start-timeout", "120", "--command-timeout", "180", "--registration-timeout", "120", "--warmup-timeout", "120"] },
  "pi-thread-baton": { script: "scripts/integration_thread_baton_pi.py", defaultArgs: ["--start-timeout", "120", "--command-timeout", "240", "--registration-timeout", "120", "--warmup-timeout", "120"] },
  "pi-revival": { script: "scripts/integration_pi_revival.py", defaultArgs: ["--start-timeout", "120", "--command-timeout", "180", "--registration-timeout", "120", "--warmup-timeout", "120"] },
};

export const ALL_HARNESS_SCENARIOS = Object.keys(HARNESS_SCENARIOS);

export interface HarnessPlanInput {
  sshHost: string;
  remotePath: string;
  hubUrl: string;
  token?: string;
  scenarios: string[];
  localBin?: string;
  /** Extra flags appended to every scenario (e.g. --keep, --provider). */
  extraArgs?: string[];
}

export function buildHarnessPlan(input: HarnessPlanInput): RemoteStep[] {
  const localBin = input.localBin ?? "$HOME/.local/bin";
  return input.scenarios.map((key) => {
    const scenario = HARNESS_SCENARIOS[key];
    if (!scenario) throw new Error(`unknown harness scenario: ${key} (known: ${ALL_HARNESS_SCENARIOS.join(", ")})`);
    const args = [
      "--remote-url",
      input.hubUrl,
      ...(input.token ? ["--remote-token", input.token] : []),
      ...scenario.defaultArgs,
      ...(input.extraArgs ?? []),
    ];
    const remoteCmd = `cd ${shq(input.remotePath)} && export PATH="${localBin}:$PATH" && uv run ${scenario.script} ${args.map(shq).join(" ")}`;
    return { name: `harness: ${key}`, argv: ["ssh", input.sshHost, remoteCmd] };
  });
}

function stripTrailingSlash(p: string): string {
  return p.replace(/\/+$/, "");
}

// Minimal single-quote shell escaping for paths/urls embedded in remote commands.
// Tilde-aware: a leading `~/` is left UNQUOTED so the remote shell still expands
// it to $HOME (quoting it would create a literal `~` dir — and rsync expands ~
// remotely, so the two would disagree). The remainder is quoted normally.
function shq(value: string): string {
  if (value.startsWith("~/")) return `~/${quote(value.slice(2))}`;
  return quote(value);
}

function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
