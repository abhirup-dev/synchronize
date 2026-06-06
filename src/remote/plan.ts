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
