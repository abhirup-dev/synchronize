import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG_DEFAULTS, loadRuntimeConfig, normalizeConfig, resolveRuntimeConfig } from "../src/config.ts";

const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

const empty = { remotes: {} };

test("resolveRuntimeConfig: defaults when no toml and no env", () => {
  const rc = resolveRuntimeConfig(empty, {}, {} as NodeJS.ProcessEnv);
  expect(rc.daemon).toEqual({
    bind: CONFIG_DEFAULTS.daemon.bind,
    port: null,
    token: null,
    leaseMs: CONFIG_DEFAULTS.daemon.leaseMs,
    peerRetentionMs: CONFIG_DEFAULTS.daemon.peerRetentionMs,
    sweepIntervalMs: CONFIG_DEFAULTS.daemon.sweepIntervalMs,
  });
  expect(rc.mcp.heartbeatMs).toBe(CONFIG_DEFAULTS.mcp.heartbeatMs);
});

test("resolveRuntimeConfig: config.toml sections override defaults", () => {
  const raw = {
    daemon: { bind: "100.64.0.1", port: 58412, token: "t", lease_ms: 1000, peer_retention_ms: 2000, sweep_interval_ms: 3000 },
    mcp: { heartbeat_ms: 500 },
  };
  const rc = resolveRuntimeConfig(normalizeConfig(raw), raw, {} as NodeJS.ProcessEnv);
  expect(rc.daemon).toEqual({
    bind: "100.64.0.1",
    port: 58412,
    token: "t",
    leaseMs: 1000,
    peerRetentionMs: 2000,
    sweepIntervalMs: 3000,
  });
  expect(rc.mcp.heartbeatMs).toBe(500);
});

test("resolveRuntimeConfig: env overrides config.toml (env always wins)", () => {
  const raw = { daemon: { bind: "100.64.0.1", port: 58412, lease_ms: 1000 }, mcp: { heartbeat_ms: 500 } };
  const env = {
    SYNCHRONIZE_BIND: "0.0.0.0",
    SYNCHRONIZE_PORT: "9999",
    SYNCHRONIZE_LEASE_MS: "60000",
    SYNCHRONIZE_MCP_HEARTBEAT_MS: "1000",
  } as NodeJS.ProcessEnv;
  const rc = resolveRuntimeConfig(normalizeConfig(raw), raw, env);
  expect(rc.daemon.bind).toBe("0.0.0.0");
  expect(rc.daemon.port).toBe(9999);
  expect(rc.daemon.leaseMs).toBe(60000);
  expect(rc.mcp.heartbeatMs).toBe(1000);
});

test("port: 0 (random) is a valid value, distinct from unset (null)", () => {
  expect(resolveRuntimeConfig(empty, {}, { SYNCHRONIZE_PORT: "0" } as NodeJS.ProcessEnv).daemon.port).toBe(0);
  expect(resolveRuntimeConfig(empty, { daemon: { port: 0 } }, {} as NodeJS.ProcessEnv).daemon.port).toBe(0);
  expect(resolveRuntimeConfig(empty, {}, {} as NodeJS.ProcessEnv).daemon.port).toBeNull();
});

test("invalid/zero ms env falls through to toml then default", () => {
  const raw = { daemon: { lease_ms: 1234 } };
  // negative env => ignored => toml wins
  expect(resolveRuntimeConfig(normalizeConfig(raw), raw, { SYNCHRONIZE_LEASE_MS: "-5" } as NodeJS.ProcessEnv).daemon.leaseMs).toBe(1234);
  // garbage env, no toml => default
  expect(resolveRuntimeConfig(empty, {}, { SYNCHRONIZE_LEASE_MS: "abc" } as NodeJS.ProcessEnv).daemon.leaseMs).toBe(CONFIG_DEFAULTS.daemon.leaseMs);
});

test("runtime config folds in the connection/profile section", () => {
  const raw = {
    active: "hub",
    remote: { hub: { url: "http://h:1", token: "tok" } },
  };
  const rc = resolveRuntimeConfig(normalizeConfig(raw), raw, {} as NodeJS.ProcessEnv);
  expect(rc.active).toBe("hub");
  expect(rc.connection).toEqual({ remoteUrl: "http://h:1", token: "tok", healthTimeoutMs: null });
});

test("loadRuntimeConfig: missing file => all defaults", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sync-rc-"));
  dirs.push(dir);
  const rc = await loadRuntimeConfig(join(dir, "config.toml"), {} as NodeJS.ProcessEnv);
  expect(rc.daemon.bind).toBe(CONFIG_DEFAULTS.daemon.bind);
  expect(rc.remotes).toEqual({});
});

test("loadRuntimeConfig: reads daemon + remote sections from disk", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sync-rc-"));
  dirs.push(dir);
  const path = join(dir, "config.toml");
  await writeFile(
    path,
    `[daemon]\nbind = "100.64.0.1"\nport = 58412\nlease_ms = 777\n\n[remote.hub]\nurl = "http://h:1"\n`,
  );
  const rc = await loadRuntimeConfig(path, {} as NodeJS.ProcessEnv);
  expect(rc.daemon.bind).toBe("100.64.0.1");
  expect(rc.daemon.port).toBe(58412);
  expect(rc.daemon.leaseMs).toBe(777);
  expect(rc.remotes.hub?.url).toBe("http://h:1");
});
