import type { LaunchTool } from "./build.ts";

/**
 * Session backend seam.
 *
 * The daemon launch path talks to a `SessionBackend`, never to `aoe` directly,
 * so the engine can be swapped later (e.g. vanilla tmux) without touching the
 * route/orchestration. v0 ships `AoeBackend` only.
 */
export interface SessionBackend {
  /** Idempotently prepare the backend workspace (AOE: profile create). */
  ensureReady(): Promise<void>;
  /** Create + start one agent session. Throws on backend failure. */
  spawn(spec: LaunchSpec): Promise<void>;
  /** Best-effort prompt confirmation for sessions that need local acceptance. */
  confirmPrompt?(title: string): Promise<boolean>;
  /** Tear down one session by its backend title. Throws on failure. */
  stop(title: string): Promise<void>;
  /** List live sessions known to the backend. */
  list(): Promise<BackendSession[]>;
}

export interface LaunchSpec {
  /** Backend session title (durable, derivable, <= AOE's 20-char tmux prefix). */
  title: string;
  /** Agent type for the backend's own rendering (AOE: `--cmd`). */
  tool: LaunchTool;
  /** Full agent argv (from buildAgentCommand). */
  command: string[];
  /** Env to inject ahead of the command (from buildLaunchEnv + extras). */
  env: Record<string, string>;
  /** Working directory for the session. */
  cwd: string;
  /** Optional cosmetic backend group (AOE HUD organization). */
  group?: string;
}

export interface BackendSession {
  title: string;
  id?: string;
  group?: string;
  path?: string;
  tool?: string;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Injectable command runner so the backend is unit-testable without `aoe`. */
export type CommandRunner = (cmd: string[]) => Promise<CommandResult>;

export const defaultRunner: CommandRunner = async (cmd) => {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
};

const SAFE_TOKEN = /^[A-Za-z0-9_./:=-]+$/;

function shellQuote(token: string): string {
  if (SAFE_TOKEN.test(token)) return token;
  return `'${token.replace(/'/g, "'\\''")}'`;
}

function shellJoin(tokens: string[]): string {
  return tokens.map(shellQuote).join(" ");
}

/**
 * Build the `--cmd-override` string AOE runs in the pane:
 * `env KEY=VAL … <agent argv>`. Exported for testing.
 */
export function buildCmdOverride(env: Record<string, string>, command: string[]): string {
  return shellJoin(["env", ...Object.entries(env).map(([k, v]) => `${k}=${v}`), ...command]);
}

/** Tolerant parser for `aoe list --json` (top-level array of sessions). */
export function parseAoeList(raw: string): BackendSession[] {
  const trimmed = raw.trim();
  if (trimmed === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }
  const rows = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { sessions?: unknown }).sessions)
      ? (parsed as { sessions: unknown[] }).sessions
      : [];
  const sessions: BackendSession[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (typeof r.title !== "string") continue;
    sessions.push({
      title: r.title,
      ...(typeof r.id === "string" ? { id: r.id } : {}),
      ...(typeof r.group === "string" && r.group !== "" ? { group: r.group } : {}),
      ...(typeof r.path === "string" ? { path: r.path } : {}),
      ...(typeof r.tool === "string" ? { tool: r.tool } : {}),
    });
  }
  return sessions;
}

/**
 * AOE-backed session backend. Spawns persistent agent sessions via the `aoe`
 * CLI, which hands them to AOE's daemon/tmux — so they outlive both the `aoe`
 * invocation and the synchronize daemon (verified: tmux server reparents to
 * PID 1).
 */
export class AoeBackend implements SessionBackend {
  private readonly profile: string;
  private readonly run: CommandRunner;
  private readonly confirmDevChannel: boolean;
  private readonly sleep: (ms: number) => Promise<void>;
  private ready = false;

  constructor(opts: {
    profile: string;
    run?: CommandRunner;
    /** Auto-dismiss claude's dev-channel confirmation prompt in the pane (default true). */
    confirmDevChannel?: boolean;
    /** Injectable sleep for tests. */
    sleep?: (ms: number) => Promise<void>;
  }) {
    this.profile = opts.profile;
    this.run = opts.run ?? defaultRunner;
    this.confirmDevChannel = opts.confirmDevChannel ?? true;
    this.sleep = opts.sleep ?? ((ms) => Bun.sleep(ms));
  }

  private aoe(args: string[]): string[] {
    return ["aoe", "-p", this.profile, ...args];
  }

  async ensureReady(): Promise<void> {
    if (this.ready) return;
    // Idempotent: ignore "already exists" — the profile persists across launches.
    await this.run(["aoe", "profile", "create", this.profile]);
    this.ready = true;
  }

  async spawn(spec: LaunchSpec): Promise<void> {
    await this.ensureReady();
    if (spec.group) {
      // Cosmetic AOE group for HUD grouping; idempotent, errors ignored.
      await this.run(this.aoe(["group", "create", spec.group]));
    }
    const override = buildCmdOverride(spec.env, spec.command);
    const addArgs = ["add", "--title", spec.title, "--cmd", spec.tool, "--cmd-override", override];
    if (spec.group) addArgs.push("-g", spec.group);
    addArgs.push(spec.cwd);
    const added = await this.run(this.aoe(addArgs));
    if (added.exitCode !== 0) {
      throw new Error(failure("aoe add", spec.title, added));
    }
    // `session start`, NOT `add --launch`: --launch attaches and exits non-zero
    // headless ("open terminal failed") even though the session launched.
    const started = await this.run(this.aoe(["session", "start", spec.title]));
    if (started.exitCode !== 0) {
      // Roll back the added-but-unstarted session so the title isn't orphaned
      // (which would block a future launch under the same title).
      await this.run(this.aoe(["remove", "--force", spec.title]));
      throw new Error(failure("aoe session start", spec.title, started));
    }
    // In direct/non-durable use, keep the old best-effort non-blocking prompt
    // confirmer. The daemon's durable worker also calls confirmPrompt as an
    // explicit lifecycle step, and duplicate Enter attempts are harmless.
    if (this.confirmDevChannel && spec.tool === "claude") {
      void this.confirmPrompt(spec.title).catch(() => {});
    }
  }

  async confirmPrompt(title: string): Promise<boolean> {
    if (!this.confirmDevChannel) return true;
    return this.autoConfirmDevChannelPrompt(title);
  }

  /**
   * Poll the session's tmux pane for claude's dev-channel confirmation prompt
   * and accept it. Bounded and best-effort.
   */
  async autoConfirmDevChannelPrompt(title: string): Promise<boolean> {
    const PROMPT = /I am using this for local development|Enter to confirm/i;
    let confirmationsSent = 0;
    for (let attempt = 0; attempt < 24; attempt += 1) {
      await this.sleep(1500);
      const session = await this.tmuxSessionFor(title);
      if (!session) continue;
      const paneTarget = await this.activePaneFor(session);
      const target = paneTarget ?? session;
      const promptVisible = await this.isPromptVisible(target, PROMPT);
      if (!promptVisible) {
        if (confirmationsSent > 0) return true;
        continue;
      }

      await this.sendEnter(target);
      await this.sleep(250);
      if (!(await this.isPromptVisible(target, PROMPT))) return true;
      await this.sendCarriageReturn(target);
      confirmationsSent += 1;
      if (confirmationsSent >= 3) return false;
    }
    return false;
  }

  private async isPromptVisible(target: string, prompt: RegExp): Promise<boolean> {
    const pane = await this.run(["tmux", "capture-pane", "-p", "-J", "-S", "-200", "-t", target]);
    return pane.exitCode === 0 && prompt.test(pane.stdout);
  }

  private async activePaneFor(session: string): Promise<string | null> {
    const res = await this.run(["tmux", "display-message", "-p", "-t", session, "#{pane_id}"]);
    if (res.exitCode !== 0) return null;
    return res.stdout.trim() || null;
  }

  private async sendEnter(target: string): Promise<void> {
    await this.run(["tmux", "send-keys", "-t", target, "Enter"]);
  }

  private async sendCarriageReturn(target: string): Promise<void> {
    await this.run(["tmux", "send-keys", "-t", target, "C-m"]);
  }

  /** Resolve the tmux session name AOE created for a title. */
  async tmuxSessionFor(title: string): Promise<string | null> {
    const aoeList = await this.run(this.aoe(["list", "--json"]));
    const aoeSession = aoeList.exitCode === 0 ? parseAoeList(aoeList.stdout).find((session) => session.title === title) : undefined;
    const idSuffix = aoeSession?.id?.slice(0, 8);
    const res = await this.run(["tmux", "list-sessions", "-F", "#{session_name}"]);
    if (res.exitCode !== 0) return null;
    const sessions = res.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
    if (idSuffix) {
      const byId = sessions.find((session) => session.startsWith("aoe_") && session.endsWith(`_${idSuffix}`));
      if (byId) return byId;
    }
    const prefix = `aoe_${title}_`;
    const match = sessions.find((s) => s.startsWith(prefix));
    return match ?? null;
  }

  async stop(title: string): Promise<void> {
    const removed = await this.run(this.aoe(["remove", "--force", title]));
    if (removed.exitCode !== 0) {
      throw new Error(failure("aoe remove", title, removed));
    }
  }

  async list(): Promise<BackendSession[]> {
    const res = await this.run(this.aoe(["list", "--json"]));
    if (res.exitCode !== 0) {
      throw new Error(`aoe list failed (exit ${res.exitCode}): ${detail(res)}`);
    }
    return parseAoeList(res.stdout);
  }
}

function failure(op: string, title: string, res: CommandResult): string {
  return `${op} failed for '${title}' (exit ${res.exitCode}): ${detail(res)}`;
}

function detail(res: CommandResult): string {
  return res.stderr.trim() || res.stdout.trim() || "(no output)";
}
