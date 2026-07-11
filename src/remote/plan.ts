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
  /** Bind used when the synced runtime starts its own daemon. Defaults to LAN-safe 0.0.0.0. */
  daemonBind?: string;
  /** Short daemon lifecycle timings for remote archive/resume GC verification. */
  leaseMs?: number;
  peerRetentionMs?: number;
  sweepIntervalMs?: number;
  /** Remote SYNCHRONIZE_HOME where config.toml is written (default ~/.synchronize). */
  remoteHome?: string;
  excludes?: string[];
  /** Skip `bun install` (e.g. when deps are unchanged). */
  skipInstall?: boolean;
}

const DEFAULT_REMOTE_DAEMON = {
  bind: "0.0.0.0",
  // Keep archive-GC verification fast without racing the default 15s MCP heartbeat.
  leaseMs: 30_000,
  peerRetentionMs: 15_000,
  sweepIntervalMs: 1_000,
} as const;

export interface ReverseTunnelPlanInput {
  sshHost: string;
  localUrl: string;
  remotePort?: number;
  pidDir?: string;
}

export interface LettaChannelPlanInput {
  sshHost: string;
  remotePath: string;
  hubUrl: string;
  agent: string;
  lettaBaseUrl: string;
  lettaApiKey?: string;
  pollMs?: number;
  logPath?: string;
  restartChannel?: boolean;
}

/** Render the config.toml the remote runtime uses both as a client and, when started locally, as a daemon. */
export function renderRemoteConfig(input: Pick<SyncPlanInput, "hubUrl" | "token" | "tokenEnv" | "daemonBind" | "leaseMs" | "peerRetentionMs" | "sweepIntervalMs">): string {
  const clientConfig = serializeConfig({
    active: "hub",
    remotes: {
      hub: {
        url: input.hubUrl,
        ...(input.tokenEnv ? { tokenEnv: input.tokenEnv } : {}),
        ...(input.token ? { token: input.token } : {}),
      },
    },
    lettaServers: {},
    agents: {},
  });
  const daemonLines = [
    "[daemon]",
    `bind = ${tomlString(input.daemonBind ?? DEFAULT_REMOTE_DAEMON.bind)}`,
    ...(daemonPort(input.hubUrl) !== null ? [`port = ${daemonPort(input.hubUrl)}`] : []),
    ...(input.token ? [`token = ${tomlString(input.token)}`] : []),
    `lease_ms = ${positiveInt(input.leaseMs, DEFAULT_REMOTE_DAEMON.leaseMs)}`,
    `peer_retention_ms = ${positiveInt(input.peerRetentionMs, DEFAULT_REMOTE_DAEMON.peerRetentionMs)}`,
    `sweep_interval_ms = ${positiveInt(input.sweepIntervalMs, DEFAULT_REMOTE_DAEMON.sweepIntervalMs)}`,
    "",
  ];
  return `${clientConfig}\n${daemonLines.join("\n")}`;
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

export function buildReverseTunnelPlan(input: ReverseTunnelPlanInput): RemoteStep[] {
  const local = parseHttpUrl(input.localUrl, "localUrl");
  const localPort = portFromUrl(local);
  const remotePort = input.remotePort ?? localPort;
  const pidDir = input.pidDir ?? "~/.synchronize/tunnels";
  const controlSocket = `${pidDir}/${input.sshHost}-${remotePort}.sock`;
  const logFile = `${pidDir}/${input.sshHost}-${remotePort}.log`;
  const tunnelCmd = [
    `mkdir -p ${shq(pidDir)}`,
    `if [ -S ${shq(controlSocket)} ] && ssh -S ${shq(controlSocket)} -O check ${quote(input.sshHost)} >/dev/null 2>&1; then echo "tunnel already running control=${controlSocket}"; exit 0; fi`,
    `rm -f ${shq(controlSocket)}`,
    `ssh -M -S ${shq(controlSocket)} -fN -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -R 127.0.0.1:${remotePort}:127.0.0.1:${localPort} ${quote(input.sshHost)} > ${shq(logFile)} 2>&1`,
    `sleep 1`,
    `ssh -S ${shq(controlSocket)} -O check ${quote(input.sshHost)} >/dev/null 2>&1 || { cat ${shq(logFile)} >&2; exit 1; }`,
    `echo "tunnel control=${controlSocket} remote=http://127.0.0.1:${remotePort} local=http://127.0.0.1:${localPort}"`,
  ].join("; ");
  return [
    {
      name: "start ssh reverse tunnel",
      argv: ["sh", "-lc", tunnelCmd],
    },
    {
      name: "verify reverse tunnel from remote",
      argv: ["ssh", input.sshHost, `curl -fsS -m 5 ${shq(`http://127.0.0.1:${remotePort}`)}/health`],
    },
  ];
}

export function buildLettaChannelPlan(input: LettaChannelPlanInput): RemoteStep[] {
  const lettaBin = `${stripTrailingSlash(input.remotePath)}/.local-bin/letta-code`;
  const logPath = input.logPath ?? "$HOME/.letta/synchronize-channel.log";
  const apiKey = input.lettaApiKey ?? "dummy";
  const pollMs = input.pollMs ?? 1000;
  const env = `LETTA_BASE_URL=${quote(input.lettaBaseUrl)} LETTA_API_KEY=${quote(apiKey)}`;
  const processPattern = "node_modules/@letta-ai/letta-code/letta.js server --channels synchronize";
  const listPids = `ps -eo pid=,args= | awk ${quote(`/${processPattern.replace(/\//g, "\\/")}/ && !/awk/ {print $1}`)}`;
  const countPids = `printf "%s\\n" "$running" | sed '/^$/d' | wc -l | tr -d ' '`;
  const startChannel = [
    `cd ${shq(input.remotePath)}`,
    `: > ${logPath}`,
    `${env} nohup ${shq(lettaBin)} server --channels synchronize --debug > ${logPath} 2>&1 &`,
    `pid=$!`,
    `echo "started Letta synchronize channel pid=$pid"`,
    `sleep 2`,
    `running=$(${listPids})`,
    `count=$(${countPids})`,
    `if [ "$count" != "1" ]; then echo "expected exactly one Letta synchronize channel process, found $count: $running" >&2; exit 1; fi`,
    `ps -p "$pid" -o pid=,args=`,
  ];
  const ensureChannel = [
    `running=$(${listPids})`,
    `count=$(${countPids})`,
    `if [ "$count" -gt 1 ]; then echo "expected at most one Letta synchronize channel process, found $count: $running" >&2; exit 1; fi`,
    `if [ "$count" = "1" ]; then echo "Letta synchronize channel already running pid=$running"; exit 0; fi`,
    ...startChannel,
  ];
  const restartChannel = [
    `old=$(${listPids})`,
    `if [ -n "$old" ]; then kill $old 2>/dev/null || true; fi`,
    `if [ -n "$old" ]; then for i in $(seq 1 50); do ps -p $old >/dev/null 2>&1 || break; sleep 0.1; done; fi`,
    `if [ -n "$old" ] && ps -p $old >/dev/null 2>&1; then kill -9 $old 2>/dev/null || true; fi`,
    ...startChannel,
  ];
  return [
    {
      name: "write Letta Code wrapper",
      argv: [
        "ssh",
        input.sshHost,
        `mkdir -p ${shq(input.remotePath)}/.local-bin && cat > ${shq(lettaBin)} && chmod +x ${shq(lettaBin)}`,
      ],
      stdin: `#!/usr/bin/env bash\nexec bun ${stripTrailingSlash(input.remotePath)}/node_modules/@letta-ai/letta-code/letta.js "$@"\n`,
    },
    {
      name: "provision Letta synchronize channel",
      argv: [
        "ssh",
        input.sshHost,
        `cd ${shq(input.remotePath)} && ${env} bash extensions/letta-synchronize/channel/provision.sh --daemon-url ${shq(input.hubUrl)} --poll-ms ${pollMs} --letta ${shq(lettaBin)} --agent ${shq(input.agent)}`,
      ],
    },
    {
      name: input.restartChannel ? "restart Letta synchronize channel" : "ensure Letta synchronize channel running",
      argv: [
        "ssh",
        input.sshHost,
        (input.restartChannel ? restartChannel : ensureChannel).join("; "),
      ],
    },
  ];
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
  "pi_mcp_archive_resume": { script: "scripts/integration_archive_resume_pi.py", defaultArgs: ["--start-timeout", "120", "--command-timeout", "240", "--registration-timeout", "120", "--warmup-timeout", "120"] },
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

function parseHttpUrl(raw: string, name: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} must be a valid http(s) URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must use http or https`);
  }
  return url;
}

function portFromUrl(url: URL): number {
  if (url.port) return Number(url.port);
  return url.protocol === "https:" ? 443 : 80;
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

function tomlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function positiveInt(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value !== undefined && value > 0 ? Math.trunc(value) : fallback;
}

function daemonPort(hubUrl: string): number | null {
  try {
    const port = new URL(hubUrl).port;
    if (!port) return null;
    const n = Number(port);
    return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
  } catch {
    return null;
  }
}
