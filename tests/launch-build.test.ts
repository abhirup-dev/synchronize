import { expect, test } from "bun:test";
import { buildAgentCommand, buildLaunchEnv, isLaunchTool } from "../src/launch/build.ts";
import { ENV_HOME, ENV_HOOK_ENABLE, ENV_LAUNCH_ID, ENV_PEER_ID, ENV_SESSION_NAME } from "../src/constants.ts";

test("isLaunchTool accepts only claude and pi", () => {
  expect(isLaunchTool("claude")).toBe(true);
  expect(isLaunchTool("pi")).toBe(true);
  expect(isLaunchTool("codex")).toBe(false);
  expect(isLaunchTool("")).toBe(false);
});

test("buildAgentCommand for claude injects dev-channel + skip-permission flags (live push; prompt auto-dismissed by backend)", () => {
  const cmd = buildAgentCommand("claude", []);
  expect(cmd[0]).toBe("claude");
  expect(cmd).toContain("--dangerously-skip-permissions");
  expect(cmd).toContain("--dangerously-load-development-channels");
  expect(cmd).toContain("server:synchronize");
});

test("buildAgentCommand for claude does not duplicate flags already present", () => {
  const cmd = buildAgentCommand("claude", ["--dangerously-skip-permissions", "--dangerously-load-development-channels", "server:other", "--model", "opus"]);
  expect(cmd.filter((a) => a === "--dangerously-skip-permissions")).toHaveLength(1);
  expect(cmd.filter((a) => a === "--dangerously-load-development-channels")).toHaveLength(1);
  expect(cmd).toContain("--model");
  expect(cmd).toContain("opus");
});

test("buildAgentCommand for pi passes args through verbatim", () => {
  const cmd = buildAgentCommand("pi", ["--provider", "openai-codex", "--model", "gpt-5.4-mini"]);
  expect(cmd).toEqual(["pi", "--provider", "openai-codex", "--model", "gpt-5.4-mini"]);
});

test("buildLaunchEnv always sets hook-enable + launch id, omits optional keys when absent", () => {
  const env = buildLaunchEnv({ launchId: "lid-1" });
  expect(env[ENV_HOOK_ENABLE]).toBe("1");
  expect(env[ENV_LAUNCH_ID]).toBe("lid-1");
  expect(env[ENV_SESSION_NAME]).toBeUndefined();
  expect(env[ENV_PEER_ID]).toBeUndefined();
  expect(env[ENV_HOME]).toBeUndefined();
});

test("buildLaunchEnv includes session name, peer id, and home when provided", () => {
  const env = buildLaunchEnv({ launchId: "lid-2", sessionName: "alice", peerId: "peer-9", home: "/tmp/sync-home" });
  expect(env[ENV_SESSION_NAME]).toBe("alice");
  expect(env[ENV_PEER_ID]).toBe("peer-9");
  expect(env[ENV_HOME]).toBe("/tmp/sync-home");
});
