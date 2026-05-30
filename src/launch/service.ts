import { buildAgentCommand, buildLaunchEnv, isLaunchTool, type LaunchTool } from "./build.ts";
import type { LaunchSpec, SessionBackend } from "./backend.ts";

/**
 * Ad-hoc launch request (the v0 input). A config-driven resolver would later
 * produce the same `LaunchSpec` — spec *resolution* is kept separate from spec
 * *execution* so config support is additive, not a rewrite.
 */
export interface LaunchRequest {
  tool: LaunchTool;
  /** session_name + AOE title stem + group alias (does triple duty). */
  name: string;
  /** Working directory for the spawned agent. Required, no magic default. */
  repo: string;
  /** Optional synchronize group to auto-join on register; also the AOE group. */
  group?: string;
  /** Tool-specific passthrough args (--model / --provider / --thinking …). */
  args?: string[];
}

/**
 * Launch intent held in memory between spawn and the agent's self-register.
 * Deliberately NOT persisted: once the agent registers + joins, all durable
 * truth (peer_id, session_name, membership) lives in SQLite via existing paths.
 */
export interface PendingLaunch {
  launchId: string;
  peerId: string;
  sessionName: string;
  tool: LaunchTool;
  group?: string;
  alias: string;
  title: string;
  cwd: string;
  createdAtMs: number;
}

export interface LaunchResult {
  launchId: string;
  peerId: string;
  sessionName: string;
  title: string;
  group?: string;
  /** How many launches have not yet registered (this one included). */
  pendingCount: number;
  /** Operator hint when launches are outstanding. */
  warning?: string;
}

export class LaunchValidationError extends Error {}

export function validateLaunchRequest(input: unknown): LaunchRequest {
  if (!input || typeof input !== "object") {
    throw new LaunchValidationError("launch body must be an object");
  }
  const body = input as Record<string, unknown>;
  const tool = body.tool;
  if (typeof tool !== "string" || !isLaunchTool(tool)) {
    throw new LaunchValidationError("launch requires tool: 'claude' | 'pi'");
  }
  const name = body.name;
  if (typeof name !== "string" || name.trim() === "") {
    throw new LaunchValidationError("launch requires a non-empty name");
  }
  const repo = body.repo;
  if (typeof repo !== "string" || repo.trim() === "") {
    throw new LaunchValidationError("launch requires a non-empty repo (working directory)");
  }
  let group: string | undefined;
  if (body.group !== undefined && body.group !== null) {
    if (typeof body.group !== "string" || body.group.trim() === "") {
      throw new LaunchValidationError("launch group must be a non-empty string when provided");
    }
    group = body.group.trim();
  }
  let args: string[] | undefined;
  if (body.args !== undefined && body.args !== null) {
    if (!Array.isArray(body.args) || body.args.some((a) => typeof a !== "string")) {
      throw new LaunchValidationError("launch args must be an array of strings");
    }
    args = body.args as string[];
  }
  return {
    tool,
    name: name.trim(),
    repo: repo.trim(),
    ...(group ? { group } : {}),
    ...(args ? { args } : {}),
  };
}

/** Deterministic AOE profile name owned by this daemon (keyed on its home). */
export function aoeProfileName(home: string): string {
  let hash = 5381;
  for (let i = 0; i < home.length; i += 1) {
    hash = ((hash << 5) + hash + home.charCodeAt(i)) >>> 0;
  }
  return `synchronize-${hash.toString(16).padStart(8, "0").slice(0, 8)}`;
}

/** AOE title for a session — durable + derivable from the peer row, so `stop` needs no stored map. */
export function aoeTitle(sessionName: string, peerId: string): string {
  return `${sessionName}-${peerId.slice(0, 8)}`;
}

/** Default model for daemon-launched claude sessions. `haiku` resolves to the
 * latest Haiku (claude --model accepts the alias). This is the launch-path
 * default only (foreground `synchronize launch` is unaffected) and is overridden
 * whenever the caller passes its own --model in args. Model selection will
 * become a first-class launch field later (sync-gsx follow-up). */
const DEFAULT_CLAUDE_LAUNCH_MODEL = "haiku";

function withLaunchDefaults(req: LaunchRequest): string[] {
  const args = req.args ?? [];
  if (req.tool === "claude" && !args.includes("--model")) {
    return ["--model", DEFAULT_CLAUDE_LAUNCH_MODEL, ...args];
  }
  return args;
}

/**
 * Resolve a launch request into a backend-ready spec. Pure: no spawning, no
 * id minting — ids are passed in so the caller controls identity.
 */
export function resolveLaunchSpec(
  req: LaunchRequest,
  ids: { launchId: string; peerId: string; home: string },
): LaunchSpec {
  const title = aoeTitle(req.name, ids.peerId);
  return {
    title,
    tool: req.tool,
    command: buildAgentCommand(req.tool, withLaunchDefaults(req)),
    env: buildLaunchEnv({
      launchId: ids.launchId,
      sessionName: req.name,
      peerId: ids.peerId,
      home: ids.home,
    }),
    cwd: req.repo,
    ...(req.group ? { group: req.group } : {}),
  };
}

export interface LaunchServiceOptions {
  backend: SessionBackend;
  /** SYNCHRONIZE_HOME, injected into the agent so it registers to this daemon. */
  home: string;
  /** Override id minting (tests). */
  mintLaunchId?: () => string;
  mintPeerId?: () => string;
  /** Override clock (tests). */
  now?: () => number;
}

/**
 * Owns the launch lifecycle scaffolding: mints ids, records pending launches in
 * memory, drives the backend, and exposes the pending set for reconcile +
 * operator warnings. There is no durable launch table by design.
 */
export class LaunchService {
  private readonly backend: SessionBackend;
  private readonly home: string;
  private readonly mintLaunchId: () => string;
  private readonly mintPeerId: () => string;
  private readonly now: () => number;
  private readonly pendingByLaunch = new Map<string, PendingLaunch>();

  constructor(opts: LaunchServiceOptions) {
    this.backend = opts.backend;
    this.home = opts.home;
    this.mintLaunchId = opts.mintLaunchId ?? (() => crypto.randomUUID());
    this.mintPeerId = opts.mintPeerId ?? (() => crypto.randomUUID());
    this.now = opts.now ?? (() => Date.now());
  }

  async launch(req: LaunchRequest): Promise<LaunchResult> {
    const launchId = this.mintLaunchId();
    const peerId = this.mintPeerId();
    const spec = resolveLaunchSpec(req, { launchId, peerId, home: this.home });
    const pending: PendingLaunch = {
      launchId,
      peerId,
      sessionName: req.name,
      tool: req.tool,
      ...(req.group ? { group: req.group } : {}),
      alias: req.name,
      title: spec.title,
      cwd: req.repo,
      createdAtMs: this.now(),
    };
    // Record intent BEFORE spawning so a fast-registering agent always finds it.
    this.pendingByLaunch.set(launchId, pending);
    try {
      await this.backend.spawn(spec);
    } catch (err) {
      this.pendingByLaunch.delete(launchId);
      throw err;
    }
    const pendingCount = this.pendingByLaunch.size;
    const result: LaunchResult = {
      launchId,
      peerId,
      sessionName: req.name,
      title: spec.title,
      ...(req.group ? { group: req.group } : {}),
      pendingCount,
    };
    const warning = this.pendingWarning();
    if (warning) result.warning = warning;
    return result;
  }

  /** Tear down a backend session by its (derivable) title. */
  async stop(title: string): Promise<void> {
    await this.backend.stop(title);
  }

  /**
   * Look up and remove launch intent, but only if the registering peer matches
   * the peer_id we pinned at launch. A mismatch (someone registering a foreign
   * peer_id under this launch_id) is ignored and the intent is LEFT INTACT so
   * the genuinely-launched agent can still reconcile when it registers.
   */
  consume(launchId: string, peerId: string): PendingLaunch | undefined {
    const pending = this.pendingByLaunch.get(launchId);
    if (!pending || pending.peerId !== peerId) return undefined;
    this.pendingByLaunch.delete(launchId);
    return pending;
  }

  /** Drop pending intent for a backend title (e.g. stopped before it registered). */
  forgetByTitle(title: string): void {
    for (const [launchId, pending] of this.pendingByLaunch) {
      if (pending.title === title) this.pendingByLaunch.delete(launchId);
    }
  }

  /** Current launches that have not yet registered. */
  pending(): PendingLaunch[] {
    return [...this.pendingByLaunch.values()];
  }

  private pendingWarning(): string | undefined {
    const count = this.pendingByLaunch.size;
    if (count === 0) return undefined;
    return `${count} launch${count === 1 ? "" : "es"} not yet registered. Inspect or clear them via the AOE HUD (\`aoe -p <profile> list\`).`;
  }
}
