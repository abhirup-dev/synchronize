import { readFile } from "node:fs/promises";
import {
  ENV_BIND,
  ENV_DAEMON_URL,
  ENV_HEALTH_TIMEOUT_MS,
  ENV_LEASE_MS,
  ENV_MCP_HEARTBEAT_MS,
  ENV_PEER_RETENTION_MS,
  ENV_PORT,
  ENV_REMOTE_URL,
  ENV_SWEEP_INTERVAL_MS,
  ENV_TOKEN,
} from "./constants.ts";

// Client-side multi-machine profiles (~/.synchronize/config.toml). A profile is
// a named remote daemon target; it only POPULATES the existing env contract that
// ensureDaemon() already reads. Explicit env vars always win, so tests and
// one-off overrides are unaffected. This is intentionally a thin, closed schema:
// we parse with Bun.TOML and serialize with a purpose-built writer (no dep).

export interface ProfileSync {
  sshHost?: string;
  paths?: string[];
}

export interface RemoteProfile {
  /** Daemon URL when this profile is used as a client connection target. */
  url?: string;
  /** Name of an env var holding the bearer token (preferred over a literal). */
  tokenEnv?: string;
  /** Literal bearer token. Lower precedence than tokenEnv; avoid in shared files. */
  token?: string;
  healthTimeoutMs?: number;
  /** SSH target when this profile is used as a remote machine. */
  sshHost?: string;
  runtimePath?: string;
  expose?: "ssh-reverse";
  remotePort?: number;
  install?: boolean;
  sync?: ProfileSync;
}

export interface LettaServerProfile {
  remote?: string;
  baseUrl: string;
  apiKey?: string;
  apiKeyEnv?: string;
}

export type AgentEnvValue =
  | string
  | { fromEnv: string }
  | { fromFile: string };

export interface AgentProfile {
  tool: string;
  bin?: string;
  remote?: string;
  server?: string;
  repo?: string;
  model?: string;
  thinking?: string;
  args?: string[];
  env?: Record<string, AgentEnvValue>;
  sessionName?: string;
  agentId?: string;
  conversationId?: string;
  pollMs?: number;
}

export interface SynchronizeConfig {
  active?: string;
  remotes: Record<string, RemoteProfile>;
  lettaServers?: Record<string, LettaServerProfile>;
  agents?: Record<string, AgentProfile>;
}

/** A connection resolved from env + profile, ready for ensureDaemon. */
export interface ResolvedConnection {
  remoteUrl: string | null;
  token: string | null;
  healthTimeoutMs: number | null;
}

export function emptyConfig(): SynchronizeConfig {
  return { remotes: {}, lettaServers: {}, agents: {} };
}

/**
 * Parse raw TOML text into a normalized config. Unknown/malformed shapes are
 * skipped defensively rather than thrown — a broken profile must never crash a
 * client whose connection comes from env or local discovery.
 */
export function parseConfig(text: string): SynchronizeConfig {
  let raw: unknown;
  try {
    raw = Bun.TOML.parse(text);
  } catch (error) {
    throw new Error(`config.toml is not valid TOML: ${error instanceof Error ? error.message : String(error)}`);
  }
  return normalizeConfig(raw);
}

export function normalizeConfig(raw: unknown): SynchronizeConfig {
  const config = emptyConfig();
  if (!isRecord(raw)) return config;
  if (typeof raw.active === "string" && raw.active.length > 0) config.active = raw.active;

  const remotes = raw.remote;
  if (isRecord(remotes)) {
    for (const [name, value] of Object.entries(remotes)) {
      const profile = normalizeProfile(value);
      if (profile) config.remotes[name] = profile;
    }
  }
  // Drop a dangling `active` that names no real profile so callers can trust it.
  if (config.active && !config.remotes[config.active]) delete config.active;
  const letta = raw.letta;
  if (isRecord(letta) && isRecord(letta.server)) {
    for (const [name, value] of Object.entries(letta.server)) {
      const server = normalizeLettaServer(value);
      if (server) config.lettaServers![name] = server;
    }
  }
  const agents = raw.agent;
  if (isRecord(agents)) {
    for (const [name, value] of Object.entries(agents)) {
      const agent = normalizeAgent(value);
      if (agent) config.agents![name] = agent;
    }
  }
  return config;
}

function normalizeProfile(value: unknown): RemoteProfile | null {
  if (!isRecord(value)) return null;
  const url = typeof value.url === "string" ? value.url.trim() : "";
  const profile: RemoteProfile = {};
  if (url) profile.url = url;
  if (typeof value.token_env === "string" && value.token_env) profile.tokenEnv = value.token_env;
  if (typeof value.token === "string" && value.token) profile.token = value.token;
  if (typeof value.health_timeout_ms === "number" && Number.isFinite(value.health_timeout_ms) && value.health_timeout_ms > 0) {
    profile.healthTimeoutMs = Math.trunc(value.health_timeout_ms);
  }
  if (typeof value.ssh_host === "string" && value.ssh_host) profile.sshHost = value.ssh_host;
  if (typeof value.runtime_path === "string" && value.runtime_path) profile.runtimePath = value.runtime_path;
  if (value.expose === "ssh-reverse") profile.expose = "ssh-reverse";
  if (typeof value.remote_port === "number" && Number.isFinite(value.remote_port) && value.remote_port > 0) {
    profile.remotePort = Math.trunc(value.remote_port);
  }
  if (typeof value.install === "boolean") profile.install = value.install;
  const sync = normalizeSync(value.sync);
  if (sync) profile.sync = sync;
  return profile.url || profile.sshHost || profile.runtimePath || profile.expose || profile.remotePort !== undefined ? profile : null;
}

function normalizeSync(value: unknown): ProfileSync | null {
  if (!isRecord(value)) return null;
  const sync: ProfileSync = {};
  if (typeof value.ssh_host === "string" && value.ssh_host) sync.sshHost = value.ssh_host;
  if (Array.isArray(value.paths)) {
    const paths = value.paths.filter((p): p is string => typeof p === "string" && p.length > 0);
    if (paths.length > 0) sync.paths = paths;
  }
  return sync.sshHost || sync.paths ? sync : null;
}

function normalizeLettaServer(value: unknown): LettaServerProfile | null {
  if (!isRecord(value)) return null;
  const baseUrl = typeof value.base_url === "string" ? value.base_url.trim() : "";
  if (!baseUrl) return null;
  const server: LettaServerProfile = { baseUrl };
  if (typeof value.remote === "string" && value.remote) server.remote = value.remote;
  if (typeof value.api_key === "string" && value.api_key) server.apiKey = value.api_key;
  if (typeof value.api_key_env === "string" && value.api_key_env) server.apiKeyEnv = value.api_key_env;
  return server;
}

function normalizeAgent(value: unknown): AgentProfile | null {
  if (!isRecord(value)) return null;
  const tool = typeof value.tool === "string" ? value.tool.trim() : "";
  if (!tool) return null;
  const agent: AgentProfile = { tool };
  if (typeof value.bin === "string" && value.bin) agent.bin = value.bin;
  if (typeof value.remote === "string" && value.remote) agent.remote = value.remote;
  if (typeof value.server === "string" && value.server) agent.server = value.server;
  if (typeof value.repo === "string" && value.repo) agent.repo = value.repo;
  if (typeof value.model === "string" && value.model) agent.model = value.model;
  if (typeof value.thinking === "string" && value.thinking) agent.thinking = value.thinking;
  if (Array.isArray(value.args)) {
    const args = value.args.filter((arg): arg is string => typeof arg === "string");
    if (args.length > 0) agent.args = args;
  }
  const env = normalizeAgentEnv(value.env);
  if (env) agent.env = env;
  if (typeof value.session_name === "string" && value.session_name) agent.sessionName = value.session_name;
  if (typeof value.agent_id === "string" && value.agent_id) agent.agentId = value.agent_id;
  if (typeof value.conversation_id === "string" && value.conversation_id) agent.conversationId = value.conversation_id;
  if (typeof value.poll_ms === "number" && Number.isFinite(value.poll_ms) && value.poll_ms > 0) {
    agent.pollMs = Math.trunc(value.poll_ms);
  }
  return agent;
}

function normalizeAgentEnv(value: unknown): Record<string, AgentEnvValue> | null {
  if (!isRecord(value)) return null;
  const env: Record<string, AgentEnvValue> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!key) continue;
    if (typeof raw === "string") {
      env[key] = raw;
      continue;
    }
    if (!isRecord(raw)) continue;
    if (typeof raw.from_env === "string" && raw.from_env) {
      env[key] = { fromEnv: raw.from_env };
      continue;
    }
    if (typeof raw.from_file === "string" && raw.from_file) {
      env[key] = { fromFile: raw.from_file };
    }
  }
  return Object.keys(env).length > 0 ? env : null;
}

/** Load+parse the config file. A missing file is an empty config, not an error. */
export async function loadConfig(configPath: string): Promise<SynchronizeConfig> {
  let text: string;
  try {
    text = await readFile(configPath, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return emptyConfig();
    throw error;
  }
  return parseConfig(text);
}

/** Resolve the named profile, the active one, or null. */
export function resolveProfile(config: SynchronizeConfig, name?: string): RemoteProfile | null {
  const key = name ?? config.active;
  if (!key) return null;
  return config.remotes[key] ?? null;
}

export function resolveAgentProfile(config: SynchronizeConfig, name: string): AgentProfile | null {
  return config.agents?.[name] ?? null;
}

export function resolveLettaServerProfile(config: SynchronizeConfig, name: string): LettaServerProfile | null {
  return config.lettaServers?.[name] ?? null;
}

/**
 * Resolve the effective connection from env + active profile.
 *
 * Precedence (highest first): explicit env var > active profile > unset.
 * "unset" means the caller falls back to local daemon discovery/auto-start.
 */
export function resolveConnection(
  config: SynchronizeConfig,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedConnection {
  const profile = resolveProfile(config);
  const envUrl = env[ENV_REMOTE_URL]?.trim() || env[ENV_DAEMON_URL]?.trim();
  const remoteUrl = envUrl || profile?.url || null;

  const envToken = env[ENV_TOKEN]?.trim();
  const profileToken = profile ? (profile.tokenEnv ? env[profile.tokenEnv]?.trim() : undefined) ?? profile.token : undefined;
  const token = envToken || profileToken || null;

  const envTimeout = numericEnv(env[ENV_HEALTH_TIMEOUT_MS]);
  const healthTimeoutMs = envTimeout ?? profile?.healthTimeoutMs ?? null;

  return { remoteUrl, token, healthTimeoutMs };
}

/** Pure: add/replace a profile, optionally making it active. */
export function upsertProfile(
  config: SynchronizeConfig,
  name: string,
  profile: RemoteProfile,
  options: { makeActive?: boolean } = {},
): SynchronizeConfig {
  const next: SynchronizeConfig = { remotes: { ...config.remotes, [name]: profile } };
  if (config.lettaServers) next.lettaServers = config.lettaServers;
  if (config.agents) next.agents = config.agents;
  if (config.active) next.active = config.active;
  if (options.makeActive || !next.active) next.active = name;
  return next;
}

/** Pure: remove a profile, clearing `active` if it pointed at the removed one. */
export function removeProfile(config: SynchronizeConfig, name: string): SynchronizeConfig {
  const remotes = { ...config.remotes };
  delete remotes[name];
  const next: SynchronizeConfig = { remotes };
  if (config.lettaServers) next.lettaServers = config.lettaServers;
  if (config.agents) next.agents = config.agents;
  if (config.active && config.active !== name) next.active = config.active;
  return next;
}

/** Pure: set the active profile. Throws if the name is unknown. */
export function setActiveProfile(config: SynchronizeConfig, name: string): SynchronizeConfig {
  if (!config.remotes[name]) {
    throw new Error(`No such profile: ${name}. Known: ${Object.keys(config.remotes).join(", ") || "(none)"}`);
  }
  return { ...config, active: name };
}

/**
 * Serialize a config to deterministic TOML. Purpose-built for this closed
 * schema (Bun parses TOML but does not stringify it).
 */
export function serializeConfig(config: SynchronizeConfig): string {
  const lines: string[] = [];
  if (config.active) lines.push(`active = ${tomlString(config.active)}`, "");
  for (const name of Object.keys(config.remotes).sort()) {
    const profile = config.remotes[name];
    if (!profile) continue;
    lines.push(`[remote.${name}]`);
    if (profile.url) lines.push(`url = ${tomlString(profile.url)}`);
    if (profile.tokenEnv) lines.push(`token_env = ${tomlString(profile.tokenEnv)}`);
    if (profile.token) lines.push(`token = ${tomlString(profile.token)}`);
    if (profile.healthTimeoutMs !== undefined) lines.push(`health_timeout_ms = ${profile.healthTimeoutMs}`);
    if (profile.sshHost) lines.push(`ssh_host = ${tomlString(profile.sshHost)}`);
    if (profile.runtimePath) lines.push(`runtime_path = ${tomlString(profile.runtimePath)}`);
    if (profile.expose) lines.push(`expose = ${tomlString(profile.expose)}`);
    if (profile.remotePort !== undefined) lines.push(`remote_port = ${profile.remotePort}`);
    if (profile.install !== undefined) lines.push(`install = ${profile.install}`);
    if (profile.sync) {
      lines.push("", `[remote.${name}.sync]`);
      if (profile.sync.sshHost) lines.push(`ssh_host = ${tomlString(profile.sync.sshHost)}`);
      if (profile.sync.paths) lines.push(`paths = [${profile.sync.paths.map(tomlString).join(", ")}]`);
    }
    lines.push("");
  }
  for (const name of Object.keys(config.lettaServers ?? {}).sort()) {
    const server = config.lettaServers?.[name];
    if (!server) continue;
    lines.push(`[letta.server.${name}]`);
    if (server.remote) lines.push(`remote = ${tomlString(server.remote)}`);
    lines.push(`base_url = ${tomlString(server.baseUrl)}`);
    if (server.apiKey) lines.push(`api_key = ${tomlString(server.apiKey)}`);
    if (server.apiKeyEnv) lines.push(`api_key_env = ${tomlString(server.apiKeyEnv)}`);
    lines.push("");
  }
  for (const name of Object.keys(config.agents ?? {}).sort()) {
    const agent = config.agents?.[name];
    if (!agent) continue;
    lines.push(`[agent.${name}]`);
    lines.push(`tool = ${tomlString(agent.tool)}`);
    if (agent.bin) lines.push(`bin = ${tomlString(agent.bin)}`);
    if (agent.remote) lines.push(`remote = ${tomlString(agent.remote)}`);
    if (agent.server) lines.push(`server = ${tomlString(agent.server)}`);
    if (agent.repo) lines.push(`repo = ${tomlString(agent.repo)}`);
    if (agent.model) lines.push(`model = ${tomlString(agent.model)}`);
    if (agent.thinking) lines.push(`thinking = ${tomlString(agent.thinking)}`);
    if (agent.args) lines.push(`args = [${agent.args.map(tomlString).join(", ")}]`);
    if (agent.sessionName) lines.push(`session_name = ${tomlString(agent.sessionName)}`);
    if (agent.agentId) lines.push(`agent_id = ${tomlString(agent.agentId)}`);
    if (agent.conversationId) lines.push(`conversation_id = ${tomlString(agent.conversationId)}`);
    if (agent.pollMs !== undefined) lines.push(`poll_ms = ${agent.pollMs}`);
    if (agent.env && Object.keys(agent.env).length > 0) {
      lines.push("", `[agent.${name}.env]`);
      for (const key of Object.keys(agent.env).sort()) {
        lines.push(`${key} = ${tomlAgentEnvValue(agent.env[key]!)}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n").replace(/\n+$/, "\n");
}

function tomlAgentEnvValue(value: AgentEnvValue): string {
  if (typeof value === "string") return tomlString(value);
  if ("fromEnv" in value) return `{ from_env = ${tomlString(value.fromEnv)} }`;
  return `{ from_file = ${tomlString(value.fromFile)} }`;
}

function tomlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function numericEnv(raw: string | undefined): number | null {
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

// ---------------------------------------------------------------------------
// Runtime config resolver (Phase 1 of docs/plans/config-unification.md).
//
// One typed RuntimeConfig resolved as defaults < config.toml < env (env always
// wins). Category-A operator config lives here; Category-B per-process IPC vars
// (HOME, PEER_ID, LAUNCH_ID, SESSION_NAME, MCP_MODE, …) deliberately stay env.
//
// Phase 1 introduces the resolver and tests it WITHOUT migrating consumers, so
// the existing eager constants in constants.ts remain authoritative until their
// call sites move (Phases 2–3). Default literals are mirrored here on purpose;
// Phase 2 collapses the duplication once daemon/mcp read from this resolver.
// ---------------------------------------------------------------------------

export interface DaemonConfig {
  bind: string;
  /** Null means "let the daemon decide" (its existing DEFAULT_PORT / 0=random logic). */
  port: number | null;
  token: string | null;
  leaseMs: number;
  peerRetentionMs: number;
  sweepIntervalMs: number;
}

export interface McpConfig {
  heartbeatMs: number;
}

export interface RuntimeConfig {
  daemon: DaemonConfig;
  mcp: McpConfig;
  /** Client → daemon connection (env > active profile > unset). */
  connection: ResolvedConnection;
  active?: string;
  remotes: Record<string, RemoteProfile>;
  agents: Record<string, AgentProfile>;
}

export const CONFIG_DEFAULTS = {
  daemon: {
    bind: "127.0.0.1",
    leaseMs: 3 * 24 * 60 * 60_000,
    peerRetentionMs: 24 * 60 * 60_000,
    sweepIntervalMs: 60 * 60_000,
  },
  mcp: { heartbeatMs: 15_000 },
} as const;

/** Build a RuntimeConfig from an already-parsed config + env. Pure + testable. */
export function resolveRuntimeConfig(
  config: SynchronizeConfig,
  rawSections: Record<string, unknown> = {},
  env: NodeJS.ProcessEnv = process.env,
): RuntimeConfig {
  const daemonToml = section(rawSections.daemon);
  const mcpToml = section(rawSections.mcp);
  return {
    daemon: {
      bind: pickString(env[ENV_BIND], daemonToml.bind, CONFIG_DEFAULTS.daemon.bind),
      port: pickNumberOrNull(env[ENV_PORT], daemonToml.port),
      token: pickString(env[ENV_TOKEN], daemonToml.token, "") || null,
      leaseMs: pickPositive(env[ENV_LEASE_MS], daemonToml.lease_ms, CONFIG_DEFAULTS.daemon.leaseMs),
      peerRetentionMs: pickPositive(env[ENV_PEER_RETENTION_MS], daemonToml.peer_retention_ms, CONFIG_DEFAULTS.daemon.peerRetentionMs),
      sweepIntervalMs: pickPositive(env[ENV_SWEEP_INTERVAL_MS], daemonToml.sweep_interval_ms, CONFIG_DEFAULTS.daemon.sweepIntervalMs),
    },
    mcp: {
      heartbeatMs: pickPositive(env[ENV_MCP_HEARTBEAT_MS], mcpToml.heartbeat_ms, CONFIG_DEFAULTS.mcp.heartbeatMs),
    },
    connection: resolveConnection(config, env),
    ...(config.active ? { active: config.active } : {}),
    remotes: config.remotes,
    agents: config.agents ?? {},
  };
}

/** Load+parse config.toml and resolve the full RuntimeConfig. Missing file => defaults. */
export async function loadRuntimeConfig(
  configPath: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<RuntimeConfig> {
  let raw: unknown = {};
  try {
    raw = Bun.TOML.parse(await readFile(configPath, "utf8"));
  } catch (error) {
    if (!isMissingFile(error)) {
      throw new Error(`config.toml is not valid TOML: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const config = normalizeConfig(raw);
  return resolveRuntimeConfig(config, isRecord(raw) ? raw : {}, env);
}

function section(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function pickString(envVal: string | undefined, tomlVal: unknown, def: string): string {
  const e = envVal?.trim();
  if (e) return e;
  if (typeof tomlVal === "string" && tomlVal.trim()) return tomlVal.trim();
  return def;
}

function pickPositive(envVal: string | undefined, tomlVal: unknown, def: number): number {
  const e = numericEnv(envVal);
  if (e !== null) return e;
  if (typeof tomlVal === "number" && Number.isFinite(tomlVal) && tomlVal > 0) return Math.trunc(tomlVal);
  return def;
}

function pickNumberOrNull(envVal: string | undefined, tomlVal: unknown): number | null {
  const raw = envVal?.trim();
  if (raw !== undefined && raw !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return Math.trunc(n); // 0 is valid (random port)
  }
  if (typeof tomlVal === "number" && Number.isFinite(tomlVal) && tomlVal >= 0) return Math.trunc(tomlVal);
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT");
}
