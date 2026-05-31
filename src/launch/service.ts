import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import { copyFile, cp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAgentCommand, buildLaunchEnv, isLaunchTool, type LaunchTool } from "./build.ts";
import type { LaunchSpec, SessionBackend } from "./backend.ts";
import { transitionLaunch, type LaunchLifecycleEvent } from "./lifecycle.ts";
import {
  appendLaunchEvent,
  createLaunchIntent,
  enqueueLaunchWork,
  getLaunchIntent,
  updateLaunchState,
  type LaunchIntentRow,
} from "./store.ts";

/**
 * Ad-hoc launch request (the v0 input). A config-driven resolver would later
 * produce the same `LaunchSpec` — spec *resolution* is kept separate from spec
 * *execution* so config support is additive, not a rewrite.
 */
export interface LaunchRequest {
  tool: LaunchTool;
  /** Group-scoped readable launch alias; backend title is derived separately. */
  name: string;
  /** Working directory for the spawned agent. Required, no magic default. */
  repo: string;
  /** Optional synchronize group to auto-join on register; also the AOE group. */
  group?: string;
  /** Full model identifier for the selected launch tool. */
  model?: string;
  /** Reasoning effort: Claude receives `--effort`, Pi receives `--thinking`. */
  thinking?: string;
  /** Tool-specific passthrough args. Provider/model/thinking args are owned by the launch request. */
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
  const normalizedName = normalizeLaunchAlias(name);
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
  const model = optionalLaunchString(body.model);
  const thinking = optionalLaunchString(body.thinking);
  validateLaunchModel(tool, model, thinking);
  return {
    tool,
    name: normalizedName,
    repo: repo.trim(),
    ...(group ? { group } : {}),
    ...(model ? { model } : {}),
    ...(thinking ? { thinking } : {}),
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

const LAUNCH_ALIAS_MAX = 11;
const LAUNCH_HASH_LENGTH = 8;
const LAUNCH_TITLE_MAX = LAUNCH_HASH_LENGTH + 1 + LAUNCH_ALIAS_MAX;

/**
 * Group-scoped launch alias. The alias is intentionally capped so the full
 * backend title fits inside AOE's 20-character tmux-visible title prefix.
 */
export function normalizeLaunchAlias(input: string): string {
  const alias = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!alias) throw new LaunchValidationError("launch name must contain letters or numbers");
  if (alias.length > LAUNCH_ALIAS_MAX) {
    throw new LaunchValidationError(`launch name must be ${LAUNCH_ALIAS_MAX} characters or fewer after normalization`);
  }
  return alias;
}

export interface LaunchTitleInput {
  launchId: string;
  peerId: string;
  group?: string;
  sessionName: string;
  tool: LaunchTool;
}

/** AOE backend title. Deterministic, human-readable, and <= 20 characters. */
export function aoeTitle(input: LaunchTitleInput): string {
  const alias = normalizeLaunchAlias(input.sessionName);
  const title = `${launchHash(input)}-${alias}`;
  if (title.length > LAUNCH_TITLE_MAX) {
    throw new LaunchValidationError(`AOE title must be ${LAUNCH_TITLE_MAX} characters or fewer`);
  }
  return title;
}

/** Operator command for attaching to an AOE-managed session. */
export function aoeAttachCommand(profile: string, title: string): string {
  return `aoe -p ${shellToken(profile)} session attach ${shellToken(title)}`;
}

const SHELL_SAFE_TOKEN = /^[A-Za-z0-9_./:=-]+$/;

function shellToken(token: string): string {
  if (SHELL_SAFE_TOKEN.test(token)) return token;
  return `'${token.replace(/'/g, "'\\''")}'`;
}

function launchHash(input: LaunchTitleInput): string {
  const canonical = JSON.stringify({
    v: 1,
    launchId: input.launchId,
    peerId: input.peerId,
    group: input.group ?? null,
    sessionName: normalizeLaunchAlias(input.sessionName),
    tool: input.tool,
  });
  return base32(createHash("sha256").update(canonical).digest()).slice(0, LAUNCH_HASH_LENGTH).toLowerCase();
}

function base32(bytes: Buffer): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let output = "";
  let value = 0;
  let bits = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

/** Hard-coded launch models for the first web spawn-form model picker.
 * These names come from the installed CLIs: Claude Code 2.1.158 accepts full
 * Claude model names, and Pi 0.75.3 lists OpenAI Codex models via
 * `pi --provider openai-codex --list-models`.
 *
 * Foreground `synchronize launch` remains a direct passthrough.
 */
export const CLAUDE_LAUNCH_MODELS = {
  sonnet: "claude-sonnet-4-6-20251114",
  haiku: "claude-haiku-4-5-20251001",
  opus: "claude-opus-4-8",
} as const;

export const PI_LAUNCH_MODELS = {
  gpt55: "gpt-5.5",
  gpt54Mini: "gpt-5.4-mini",
} as const;

export const PI_LAUNCH_THINKING_LEVELS = ["low", "medium", "high"] as const;
export const CLAUDE_LAUNCH_THINKING_LEVELS = ["medium", "high"] as const;
export const CLAUDE_LAUNCH_THINKING_BY_MODEL: Record<string, (typeof CLAUDE_LAUNCH_THINKING_LEVELS)[number]> = {
  [CLAUDE_LAUNCH_MODELS.sonnet]: "medium",
  [CLAUDE_LAUNCH_MODELS.haiku]: "high",
  [CLAUDE_LAUNCH_MODELS.opus]: "medium",
};

/**
 * Daemon/AOE launches own provider/model/thinking flags so the UI and MCP
 * paths cannot accidentally pass conflicting model args.
 * Foreground `synchronize launch` remains a direct passthrough. */
const DEFAULT_CLAUDE_LAUNCH_MODEL = CLAUDE_LAUNCH_MODELS.haiku;
const DEFAULT_CLAUDE_LAUNCH_THINKING = "high";
const DEFAULT_PI_LAUNCH_PROVIDER = "openai-codex";
const DEFAULT_PI_LAUNCH_MODEL = PI_LAUNCH_MODELS.gpt54Mini;
const DEFAULT_PI_LAUNCH_THINKING = "high";
const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

const CLAUDE_LAUNCH_MODEL_VALUES = new Set<string>(Object.values(CLAUDE_LAUNCH_MODELS));
const PI_LAUNCH_MODEL_VALUES = new Set<string>(Object.values(PI_LAUNCH_MODELS));
const CLAUDE_LAUNCH_THINKING_VALUES = new Set<string>(CLAUDE_LAUNCH_THINKING_LEVELS);
const PI_LAUNCH_THINKING_VALUES = new Set<string>(PI_LAUNCH_THINKING_LEVELS);

function optionalLaunchString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    throw new LaunchValidationError("launch model and thinking must be non-empty strings when provided");
  }
  return value.trim();
}

function validateLaunchModel(tool: LaunchTool, model: string | undefined, thinking: string | undefined): void {
  if (tool === "claude") {
    if (model && !CLAUDE_LAUNCH_MODEL_VALUES.has(model)) {
      throw new LaunchValidationError(`unsupported claude model: ${model}`);
    }
    if (thinking && !CLAUDE_LAUNCH_THINKING_VALUES.has(thinking)) {
      throw new LaunchValidationError(`unsupported claude thinking level: ${thinking}`);
    }
    return;
  }
  if (model && !PI_LAUNCH_MODEL_VALUES.has(model)) {
    throw new LaunchValidationError(`unsupported pi model: ${model}`);
  }
  if (thinking && !PI_LAUNCH_THINKING_VALUES.has(thinking)) {
    throw new LaunchValidationError(`unsupported pi thinking level: ${thinking}`);
  }
}

function stripOption(args: string[], option: string): string[] {
  const filtered: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === option) {
      index += 1;
      continue;
    }
    if (arg.startsWith(`${option}=`)) {
      continue;
    }
    filtered.push(arg);
  }
  return filtered;
}

function forceClaudeLaunchDefaults(args: string[], model: string, thinking: string): string[] {
  const filtered = stripOption(stripOption(args, "--model"), "--effort");
  return ["--model", model, "--effort", thinking, ...filtered];
}

function forcePiLaunchDefaults(args: string[], model: string, thinking: string): string[] {
  const filtered = stripOption(stripOption(stripOption(args, "--model"), "--provider"), "--thinking");
  return ["--provider", DEFAULT_PI_LAUNCH_PROVIDER, "--model", model, "--thinking", thinking, ...filtered];
}

function withLaunchDefaults(req: LaunchRequest): string[] {
  const args = req.args ?? [];
  if (req.tool === "claude") {
    const model = req.model ?? DEFAULT_CLAUDE_LAUNCH_MODEL;
    const thinking = req.thinking ?? CLAUDE_LAUNCH_THINKING_BY_MODEL[model] ?? DEFAULT_CLAUDE_LAUNCH_THINKING;
    return forceClaudeLaunchDefaults(args, model, thinking);
  }
  if (req.tool === "pi") return forcePiLaunchDefaults(
    args,
    req.model ?? DEFAULT_PI_LAUNCH_MODEL,
    req.thinking ?? DEFAULT_PI_LAUNCH_THINKING,
  );
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
  const title = aoeTitle({
    launchId: ids.launchId,
    peerId: ids.peerId,
    ...(req.group ? { group: req.group } : {}),
    sessionName: req.name,
    tool: req.tool,
  });
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
  /** SQLite enables durable daemon launch mode. Omitted in narrow service tests. */
  db?: Database;
  /** Durable backend metadata surfaced to attach/stop flows. */
  backendProfile?: string;
  /** Override Pi launch-home provisioning (tests). */
  provisionPiRuntime?: (input: { home: string; repoRoot: string }) => Promise<Record<string, string>>;
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
  private readonly db: Database | null;
  private readonly backendProfile: string | null;
  private readonly provisionPiRuntime: (input: { home: string; repoRoot: string }) => Promise<Record<string, string>>;
  private readonly mintLaunchId: () => string;
  private readonly mintPeerId: () => string;
  private readonly now: () => number;
  private readonly pendingByLaunch = new Map<string, PendingLaunch>();

  constructor(opts: LaunchServiceOptions) {
    this.backend = opts.backend;
    this.home = opts.home;
    this.db = opts.db ?? null;
    this.backendProfile = opts.backendProfile ?? null;
    this.provisionPiRuntime = opts.provisionPiRuntime ?? provisionPiLaunchRuntime;
    this.mintLaunchId = opts.mintLaunchId ?? (() => crypto.randomUUID());
    this.mintPeerId = opts.mintPeerId ?? (() => crypto.randomUUID());
    this.now = opts.now ?? (() => Date.now());
  }

  async launch(req: LaunchRequest): Promise<LaunchResult> {
    const launchId = this.mintLaunchId();
    const peerId = this.mintPeerId();
    const spec = resolveLaunchSpec(req, { launchId, peerId, home: this.home });
    if (this.db) {
      const now = this.nowIso();
      const row = createLaunchIntent(this.db, {
        launchId,
        peerId,
        tool: req.tool,
        sessionName: req.name,
        alias: req.name,
        cwd: req.repo,
        backend: "local_aoe",
        backendProfile: this.backendProfile,
        backendTitle: spec.title,
        targetGroup: req.group ?? null,
        model: req.model ?? null,
        thinking: req.thinking ?? null,
        args: req.args ?? null,
        now,
      });
      appendLaunchEvent(this.db, {
        launchId,
        kind: "launch.accepted",
        toState: row.state,
        payload: { tool: req.tool, group: req.group ?? null, backend: "local_aoe" },
        createdAt: now,
      });
      enqueueLaunchWork(this.db, {
        launchId,
        kind: "spawn",
        idempotencyKey: `${launchId}:spawn`,
        nextRunAt: now,
        maxAttempts: 3,
      });
      return this.launchResultFromRow(row);
    }

    if (req.tool === "pi") {
      Object.assign(spec.env, await this.provisionPiRuntime({ home: this.home, repoRoot: REPO_ROOT }));
    }
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

  durableIntent(launchId: string): LaunchIntentRow | null {
    return this.db ? getLaunchIntent(this.db, launchId) : null;
  }

  async runWork(kind: "spawn" | "prompt_confirm", launchId: string): Promise<void> {
    if (!this.db) throw new Error("durable launch work requires a database");
    const row = getLaunchIntent(this.db, launchId);
    if (!row) throw new Error(`launch intent not found: ${launchId}`);
    if (kind === "spawn") {
      await this.runSpawnWork(row);
      return;
    }
    await this.runPromptConfirmWork(row);
  }

  private pendingWarning(): string | undefined {
    const count = this.db
      ? this.db
          .query<{ count: number }, []>(
            `SELECT COUNT(*) AS count
             FROM launch_intents
             WHERE state NOT IN ('running', 'registered_unjoined', 'stale', 'failed', 'stopped')`,
          )
          .get()?.count ?? 0
      : this.pendingByLaunch.size;
    if (count === 0) return undefined;
    return `${count} launch${count === 1 ? "" : "es"} not yet registered. Inspect or clear them via the AOE HUD (\`aoe -p <profile> list\`).`;
  }

  private async runSpawnWork(row: LaunchIntentRow): Promise<void> {
    if (["prompt_waiting", "prompt_accepted", "registered", "reconciling", "joined", "running"].includes(row.state)) return;
    const current = row.state === "accepted" ? this.applyTransition(row, { type: "spawn_started" }) : row;
    try {
      const existing = await this.findBackendSession(row.backend_title);
      if (existing) {
        this.markSpawnSucceeded(getLaunchIntent(this.db!, row.launch_id) ?? current, row.tool === "claude");
        return;
      }
      const spec = await this.specFromRow(row);
      await this.backend.spawn(spec);
      this.markSpawnSucceeded(getLaunchIntent(this.db!, row.launch_id)!, row.tool === "claude");
    } catch (error) {
      if (await this.findBackendSession(row.backend_title)) {
        this.markSpawnSucceeded(getLaunchIntent(this.db!, row.launch_id) ?? current, row.tool === "claude");
        return;
      }
      throw error;
    }
  }

  private markSpawnSucceeded(row: LaunchIntentRow, promptRequired: boolean): void {
    const afterSpawn = this.applyTransition(row, {
      type: "spawn_succeeded",
      promptRequired,
    });
    if (promptRequired) {
      enqueueLaunchWork(this.db!, {
        launchId: row.launch_id,
        kind: "prompt_confirm",
        idempotencyKey: `${row.launch_id}:prompt_confirm`,
        nextRunAt: this.nowIso(),
        maxAttempts: 5,
      });
    } else {
      void afterSpawn;
    }
  }

  private async findBackendSession(title: string): Promise<boolean> {
    try {
      return (await this.backend.list()).some((session) => session.title === title);
    } catch {
      return false;
    }
  }

  private async runPromptConfirmWork(row: LaunchIntentRow): Promise<void> {
    const latest = getLaunchIntent(this.db!, row.launch_id) ?? row;
    if (!["prompt_waiting", "spawned", "prompt_accepted", "registered", "reconciling", "joined", "running"].includes(latest.state)) return;
    if (latest.state === "prompt_accepted" || latest.state === "registered" || latest.state === "reconciling" || latest.state === "joined" || latest.state === "running") return;
    try {
      const accepted = await this.backend.confirmPrompt?.(latest.backend_title);
      if (accepted === false) throw new Error("prompt confirmation attempts exhausted");
      this.applyTransition(getLaunchIntent(this.db!, row.launch_id) ?? latest, { type: "prompt_accepted" });
    } catch (error) {
      throw error;
    }
  }

  private async specFromRow(row: LaunchIntentRow): Promise<LaunchSpec> {
    const args = row.args_json ? (JSON.parse(row.args_json) as string[]) : undefined;
    const spec = resolveLaunchSpec(
      {
        tool: row.tool,
        name: row.session_name,
        repo: row.cwd,
        ...(row.target_group ? { group: row.target_group } : {}),
        ...(row.model ? { model: row.model } : {}),
        ...(row.thinking ? { thinking: row.thinking } : {}),
        ...(args ? { args } : {}),
      },
      { launchId: row.launch_id, peerId: row.peer_id, home: this.home },
    );
    if (row.tool === "pi") {
      Object.assign(spec.env, await this.provisionPiRuntime({ home: this.home, repoRoot: REPO_ROOT }));
    }
    return spec;
  }

  private applyTransition(row: LaunchIntentRow, event: LaunchLifecycleEvent): LaunchIntentRow {
    const transition = transitionLaunch(row.state, event);
    const now = this.nowIso();
    if (!transition.ok) {
      appendLaunchEvent(this.db!, {
        launchId: row.launch_id,
        kind: `launch.invalid.${event.type}`,
        fromState: row.state,
        toState: row.state,
        payload: { error: transition.error },
        createdAt: now,
      });
      return row;
    }
    return updateLaunchState(this.db!, {
      launchId: row.launch_id,
      fromState: transition.from,
      state: transition.to,
      eventKind: event.type,
      payload: {
        ...(transition.reason ? { reason: transition.reason } : {}),
        ...(transition.message ? { message: transition.message } : {}),
      },
      failureCode: event.type === "failed" ? event.reason : null,
      failureMessage: "message" in event ? event.message ?? null : null,
      now,
    });
  }

  private launchResultFromRow(row: LaunchIntentRow): LaunchResult {
    const result: LaunchResult = {
      launchId: row.launch_id,
      peerId: row.peer_id,
      sessionName: row.session_name,
      title: row.backend_title,
      ...(row.target_group ? { group: row.target_group } : {}),
      pendingCount: this.pendingCount(),
    };
    const warning = this.pendingWarning();
    if (warning) result.warning = warning;
    return result;
  }

  private pendingCount(): number {
    if (!this.db) return this.pendingByLaunch.size;
    return this.db
      .query<{ count: number }, []>(
        `SELECT COUNT(*) AS count
         FROM launch_intents
         WHERE state NOT IN ('running', 'registered_unjoined', 'stale', 'failed', 'stopped')`,
      )
      .get()?.count ?? 0;
  }

  private nowIso(): string {
    return new Date(this.now()).toISOString();
  }
}

export async function provisionPiLaunchRuntime(input: { home: string; repoRoot: string }): Promise<Record<string, string>> {
  const piHome = join(input.home, "pi-agent");
  const piSessions = join(input.home, "pi-sessions");
  await mkdir(join(piHome, "extensions"), { recursive: true });
  await mkdir(join(piHome, "skills"), { recursive: true });
  await mkdir(piSessions, { recursive: true });
  await provisionPiAuth(join(piHome, "auth.json"));
  await writeFile(
    join(piHome, "settings.json"),
    `${JSON.stringify({
      defaultProvider: DEFAULT_PI_LAUNCH_PROVIDER,
      defaultModel: DEFAULT_PI_LAUNCH_MODEL,
      defaultThinkingLevel: DEFAULT_PI_LAUNCH_THINKING,
      packages: ["npm:pi-mcp-adapter"],
    }, null, 2)}\n`,
  );
  await writeFile(join(piHome, "mcp.json"), `${JSON.stringify(piMcpConfig(input.repoRoot), null, 2)}\n`);
  await writeFile(
    join(piHome, "extensions", "synchronize.ts"),
    [
      'import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";',
      `import synchronizeExtension from ${JSON.stringify(join(input.repoRoot, "extensions", "pi-synchronize", "src", "index.ts"))};`,
      "",
      "export default function (pi: ExtensionAPI) {",
      "  synchronizeExtension(pi as unknown as Parameters<typeof synchronizeExtension>[0]);",
      "}",
      "",
    ].join("\n"),
  );
  await cp(join(input.repoRoot, "skills", "synchronize-pi"), join(piHome, "skills", "synchronize"), {
    recursive: true,
    force: true,
  });
  await linkPiPackages(piHome);
  return {
    PI_CODING_AGENT_DIR: piHome,
    PI_CODING_AGENT_SESSION_DIR: piSessions,
    SYNCHRONIZE_CLI: join(input.repoRoot, "bin", "synchronize"),
    SYNCHRONIZE_MCP: join(input.repoRoot, "bin", "synchronize-mcp"),
    SYNCHRONIZE_PI_DEBUG: "1",
  };
}

async function provisionPiAuth(target: string): Promise<void> {
  const codexAuth = await piAuthFromCodexAuth(authSourcePath());
  if (codexAuth) {
    await writeFile(target, `${JSON.stringify(codexAuth, null, 2)}\n`);
    return;
  }
  const piAuth = join(homedir(), ".pi", "agent", "auth.json");
  if (!existsSync(piAuth)) {
    throw new Error(`Pi OpenAI Codex auth is unavailable: expected ${authSourcePath()} or ${piAuth}`);
  }
  await copyFile(piAuth, target);
}

function authSourcePath(): string {
  return process.env.SYNCHRONIZE_PI_AUTH_SOURCE ?? join(homedir(), ".codex", "auth.json");
}

async function piAuthFromCodexAuth(path: string): Promise<Record<string, unknown> | null> {
  try {
    const auth = JSON.parse(await readFile(path, "utf8")) as {
      tokens?: { access_token?: unknown; refresh_token?: unknown; account_id?: unknown };
    };
    const access = auth.tokens?.access_token;
    const refresh = auth.tokens?.refresh_token;
    const accountId = auth.tokens?.account_id;
    if (typeof access !== "string" || typeof refresh !== "string" || typeof accountId !== "string") return null;
    const expires = jwtExpiryMs(access);
    if (!expires) return null;
    return {
      "openai-codex": {
        type: "oauth",
        access,
        refresh,
        expires,
        accountId,
      },
    };
  } catch {
    return null;
  }
}

function jwtExpiryMs(token: string): number | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: unknown };
    return typeof claims.exp === "number" ? claims.exp * 1000 : null;
  } catch {
    return null;
  }
}

async function linkPiPackages(piHome: string): Promise<void> {
  const source = join(homedir(), ".pi", "agent", "npm");
  const target = join(piHome, "npm");
  if (!existsSync(source) || existsSync(target)) return;
  try {
    await symlink(source, target, "dir");
  } catch {
    // The package cache is only needed for installed Pi packages such as
    // pi-mcp-adapter. Pi can still boot and receive events without the symlink.
  }
}

function piMcpConfig(repoRoot: string): Record<string, unknown> {
  return {
    mcpServers: {
      synchronize: {
        command: "sh",
        args: ["-c", resilientMcpCommand(repoRoot)],
        env: { SYNCHRONIZE_MCP_MODE: "codex" },
      },
    },
  };
}

function resilientMcpCommand(repoRoot: string): string {
  const configuredCli = shellQuote(join(repoRoot, "bin", "synchronize"));
  const configuredMcp = shellQuote(join(repoRoot, "bin", "synchronize-mcp"));
  return [
    `SYNCHRONIZE_CONFIGURED_CLI=${configuredCli}`,
    `SYNCHRONIZE_CONFIGURED_MCP=${configuredMcp}`,
    'for cli in "${SYNCHRONIZE_CLI:-}" "${SYNCHRONIZE_CONFIGURED_CLI:-}" "$(command -v synchronize 2>/dev/null)"; do',
    '  [ -n "$cli" ] || continue',
    '  [ -x "$cli" ] || continue',
    '  "$cli" status >/dev/null 2>&1 || continue',
    '  for mcp in "${SYNCHRONIZE_MCP:-}" "${SYNCHRONIZE_CONFIGURED_MCP:-}" "$(command -v synchronize-mcp 2>/dev/null)"; do',
    '    [ -n "$mcp" ] || continue',
    '    [ -x "$mcp" ] || continue',
    '    exec "$mcp"',
    "  done",
    "done",
    "exit 1",
  ].join("\n");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
