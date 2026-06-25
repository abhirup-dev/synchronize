import { expect, test } from "bun:test";
import { configToml, testRuntimeConfig } from "./helpers/daemon.ts";
import { CONFIG_DEFAULTS, parseConfig } from "../src/config.ts";

// Unit tests for the shared test harness itself — the config.toml it emits must
// be valid TOML the resolver understands, and testRuntimeConfig must reflect the
// overrides. (startTestDaemon is exercised by the suites that consume it.)

test("configToml emits valid TOML the resolver parses back", () => {
  const toml = configToml({
    daemon: { bind: "100.64.0.1", port: 0, token: "tok", leaseMs: 400, peerRetentionMs: 60000, sweepIntervalMs: 1000 },
    mcp: { heartbeatMs: 250 },
    remotes: { hub: { url: "http://h:1", tokenEnv: "SYNCHRONIZE_TOKEN" } },
    active: "hub",
  });
  // Round-trips through the real config parser (profiles section).
  const config = parseConfig(toml);
  expect(config.active).toBe("hub");
  expect(config.remotes.hub).toEqual({ url: "http://h:1", tokenEnv: "SYNCHRONIZE_TOKEN" });
  // And the [daemon]/[mcp] keys are present for the resolver.
  expect(toml).toContain("lease_ms = 400");
  expect(toml).toContain("heartbeat_ms = 250");
});

test("testRuntimeConfig reflects overrides and falls back to defaults", () => {
  const rc = testRuntimeConfig({ daemon: { leaseMs: 1234 } });
  expect(rc.daemon.leaseMs).toBe(1234); // override
  expect(rc.daemon.peerRetentionMs).toBe(CONFIG_DEFAULTS.daemon.peerRetentionMs); // default
  expect(rc.mcp.heartbeatMs).toBe(CONFIG_DEFAULTS.mcp.heartbeatMs);
});

test("testRuntimeConfig with no overrides is all defaults", () => {
  const rc = testRuntimeConfig();
  expect(rc.daemon.bind).toBe(CONFIG_DEFAULTS.daemon.bind);
  expect(rc.daemon.port).toBeNull();
  expect(rc.remotes).toEqual({});
});

test("testRuntimeConfig resolves remote profiles into the connection", () => {
  const rc = testRuntimeConfig({ remotes: { hub: { url: "http://h:1", token: "t" } }, active: "hub" });
  expect(rc.connection).toEqual({ remoteUrl: "http://h:1", token: "t", healthTimeoutMs: null });
});
