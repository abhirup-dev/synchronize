import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveRuntimeConfig, type RuntimeConfig } from "../../src/config.ts";
import type { ClientConfig } from "../../src/client.ts";

// Shared test daemon harness (Phase 4 of config-unification). Consolidates the
// ~10 duplicated Bun.spawn + discovery-poll loops, and — crucially — drives
// daemon tunables through a config.toml dropped in the per-test SYNCHRONIZE_HOME
// instead of a soup of SYNCHRONIZE_* env vars. The only env a test sets is the
// Category-B bootstrap var SYNCHRONIZE_HOME (+ SYNCHRONIZE_PORT=0 so parallel
// test daemons never collide). Genuine env needs (Category-B IPC vars, API
// keys) go through `env`.

// Fields explicitly allow `undefined` so callers can pass optional values
// straight through (e.g. `{ leaseMs: env.leaseMs }`); configToml skips undefined.
export interface DaemonConfigOverrides {
  bind?: string | undefined;
  port?: number | undefined;
  token?: string | undefined;
  leaseMs?: number | undefined;
  peerRetentionMs?: number | undefined;
  sweepIntervalMs?: number | undefined;
}

export interface McpConfigOverrides {
  heartbeatMs?: number | undefined;
}

export interface TestConfigOverrides {
  daemon?: DaemonConfigOverrides;
  mcp?: McpConfigOverrides;
  /** [remote.*] profiles, if a test exercises remote-connection resolution. */
  remotes?: Record<string, { url: string; tokenEnv?: string; token?: string; healthTimeoutMs?: number }>;
  active?: string;
}

export interface TestDaemon {
  home: string;
  baseUrl: string;
  client: ClientConfig;
  stop: () => Promise<void>;
}

export interface StartTestDaemonOptions {
  /** Reuse an existing home; otherwise a fresh temp dir is created. */
  home?: string;
  /** Daemon/mcp/remote settings, written to config.toml (NOT env). */
  config?: TestConfigOverrides;
  /** Genuine env needs only: Category-B IPC vars, OPENROUTER_API_KEY, etc. */
  env?: Record<string, string>;
  /** Override the default random port (0). Rarely needed. */
  port?: string;
}

/** Serialize override config to TOML text the resolver reads. Test-only writer. */
export function configToml(overrides: TestConfigOverrides): string {
  const lines: string[] = [];
  if (overrides.active) lines.push(`active = ${q(overrides.active)}`, "");
  const d = overrides.daemon;
  if (d) {
    lines.push("[daemon]");
    if (d.bind !== undefined) lines.push(`bind = ${q(d.bind)}`);
    if (d.port !== undefined) lines.push(`port = ${d.port}`);
    if (d.token !== undefined) lines.push(`token = ${q(d.token)}`);
    if (d.leaseMs !== undefined) lines.push(`lease_ms = ${d.leaseMs}`);
    if (d.peerRetentionMs !== undefined) lines.push(`peer_retention_ms = ${d.peerRetentionMs}`);
    if (d.sweepIntervalMs !== undefined) lines.push(`sweep_interval_ms = ${d.sweepIntervalMs}`);
    lines.push("");
  }
  if (overrides.mcp?.heartbeatMs !== undefined) {
    lines.push("[mcp]", `heartbeat_ms = ${overrides.mcp.heartbeatMs}`, "");
  }
  for (const [name, profile] of Object.entries(overrides.remotes ?? {})) {
    lines.push(`[remote.${name}]`, `url = ${q(profile.url)}`);
    if (profile.tokenEnv) lines.push(`token_env = ${q(profile.tokenEnv)}`);
    if (profile.token) lines.push(`token = ${q(profile.token)}`);
    if (profile.healthTimeoutMs !== undefined) lines.push(`health_timeout_ms = ${profile.healthTimeoutMs}`);
    lines.push("");
  }
  return lines.join("\n");
}

/** Write config.toml into a home and return its path. */
export async function writeTestConfig(home: string, overrides: TestConfigOverrides): Promise<string> {
  const path = join(home, "config.toml");
  await writeFile(path, configToml(overrides));
  return path;
}

/** Build a resolved RuntimeConfig for in-process unit tests (no file, no env). */
export function testRuntimeConfig(overrides: TestConfigOverrides = {}): RuntimeConfig {
  const text = configToml(overrides);
  const raw = text.trim() ? (Bun.TOML.parse(text) as Record<string, unknown>) : {};
  const config = {
    remotes: overrides.remotes
      ? Object.fromEntries(Object.entries(overrides.remotes).map(([n, p]) => [n, { url: p.url, ...(p.tokenEnv ? { tokenEnv: p.tokenEnv } : {}), ...(p.token ? { token: p.token } : {}), ...(p.healthTimeoutMs !== undefined ? { healthTimeoutMs: p.healthTimeoutMs } : {}) }]))
      : {},
    ...(overrides.active ? { active: overrides.active } : {}),
  };
  return resolveRuntimeConfig(config, raw, {});
}

/** Spawn a daemon subprocess and wait for health. Consolidates the duplicated loops. */
export async function startTestDaemon(options: StartTestDaemonOptions = {}): Promise<TestDaemon> {
  const home = options.home ?? (await mkdtemp(join(tmpdir(), "synchronize-test-")));
  if (options.config) await writeTestConfig(home, options.config);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...options.env,
    SYNCHRONIZE_HOME: home,
    SYNCHRONIZE_PORT: options.port ?? "0",
  };
  const proc = Bun.spawn({
    cmd: [process.execPath, "run", "src/daemon.ts"],
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const discoveryPath = join(home, "daemon.json");
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const discovery = (await Bun.file(discoveryPath).json()) as { baseUrl: string };
      const health = await fetch(`${discovery.baseUrl}/health`).catch(() => null);
      if (health?.ok) {
        return {
          home,
          baseUrl: discovery.baseUrl,
          client: { baseUrl: discovery.baseUrl, token: null, paths: {} as ClientConfig["paths"], started: false },
          stop: async () => {
            proc.kill();
            await proc.exited;
          },
        };
      }
    } catch {
      await Bun.sleep(50);
    }
  }
  proc.kill();
  await proc.exited;
  throw new Error("test daemon did not become healthy within 5s");
}

function q(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
