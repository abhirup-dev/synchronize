import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { copyFile, cp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAgentCommand, buildLaunchEnv, isLaunchTool, type LaunchTool } from "./build.ts";
import type { LaunchSpec, SessionBackend } from "./backend.ts";

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
  /** Tool-specific passthrough args (--provider / --thinking …). Model args are pinned for v0 test launches. */
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
  return {
    tool,
    name: normalizedName,
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

/** Temporary v0 simulation policy for daemon/AOE-launched model sessions.
 * `haiku` resolves to the latest Haiku (claude --model accepts the alias), and
 * Pi uses OpenAI Codex auth with GPT 5.4 mini. Caller-provided provider/model
 * args are ignored here to keep live simulations inexpensive until the launch
 * surface is ready for adaptive model selection.
 * Foreground `synchronize launch` remains a direct passthrough. */
const DEFAULT_CLAUDE_LAUNCH_MODEL = "haiku";
const DEFAULT_PI_LAUNCH_PROVIDER = "openai-codex";
const DEFAULT_PI_LAUNCH_MODEL = "gpt-5.4-mini";
const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

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

function forceLaunchModel(args: string[], model: string): string[] {
  const filtered = stripOption(args, "--model");
  return ["--model", model, ...filtered];
}

function forcePiLaunchDefaults(args: string[]): string[] {
  const filtered = stripOption(stripOption(args, "--model"), "--provider");
  return ["--provider", DEFAULT_PI_LAUNCH_PROVIDER, "--model", DEFAULT_PI_LAUNCH_MODEL, ...filtered];
}

function withLaunchDefaults(req: LaunchRequest): string[] {
  const args = req.args ?? [];
  if (req.tool === "claude") return forceLaunchModel(args, DEFAULT_CLAUDE_LAUNCH_MODEL);
  if (req.tool === "pi") return forcePiLaunchDefaults(args);
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
  private readonly provisionPiRuntime: (input: { home: string; repoRoot: string }) => Promise<Record<string, string>>;
  private readonly mintLaunchId: () => string;
  private readonly mintPeerId: () => string;
  private readonly now: () => number;
  private readonly pendingByLaunch = new Map<string, PendingLaunch>();

  constructor(opts: LaunchServiceOptions) {
    this.backend = opts.backend;
    this.home = opts.home;
    this.provisionPiRuntime = opts.provisionPiRuntime ?? provisionPiLaunchRuntime;
    this.mintLaunchId = opts.mintLaunchId ?? (() => crypto.randomUUID());
    this.mintPeerId = opts.mintPeerId ?? (() => crypto.randomUUID());
    this.now = opts.now ?? (() => Date.now());
  }

  async launch(req: LaunchRequest): Promise<LaunchResult> {
    const launchId = this.mintLaunchId();
    const peerId = this.mintPeerId();
    const spec = resolveLaunchSpec(req, { launchId, peerId, home: this.home });
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

  private pendingWarning(): string | undefined {
    const count = this.pendingByLaunch.size;
    if (count === 0) return undefined;
    return `${count} launch${count === 1 ? "" : "es"} not yet registered. Inspect or clear them via the AOE HUD (\`aoe -p <profile> list\`).`;
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
      defaultThinkingLevel: "low",
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
