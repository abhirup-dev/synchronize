import { expect, test } from "bun:test";
import { buildAgentResumeCommand } from "../src/launch/build.ts";

test("claude resume emits --resume <id> and never --fork-session", () => {
  const cmd = buildAgentResumeCommand("claude", { hostSessionId: "0c2b-abcd" }, []);
  expect(cmd[0]).toBe("claude");
  expect(cmd).toContain("--resume");
  expect(cmd[cmd.indexOf("--resume") + 1]).toBe("0c2b-abcd");
  expect(cmd).not.toContain("--fork-session");
  // Keeps the standard launch flags so the resumed session behaves like a launch.
  expect(cmd).toContain("--dangerously-skip-permissions");
  expect(cmd).toContain("--dangerously-load-development-channels");
});

test("claude resume preserves caller-supplied flags after --resume", () => {
  const cmd = buildAgentResumeCommand("claude", { hostSessionId: "id1" }, ["--model", "opus"]);
  expect(cmd).toContain("--model");
  expect(cmd[cmd.indexOf("--model") + 1]).toBe("opus");
  expect(cmd.indexOf("--resume")).toBeLessThan(cmd.indexOf("--model"));
});

test("pi resume uses --session (not -r) and prefers the session file when present", () => {
  const byId = buildAgentResumeCommand("pi", { hostSessionId: "sess-1" }, []);
  expect(byId).toEqual(["pi", "--session", "sess-1"]);
  expect(byId).not.toContain("-r");

  const byFile = buildAgentResumeCommand("pi", { hostSessionId: "sess-1", hostSessionFile: "/sessions/sess-1.json" }, ["--provider", "x"]);
  expect(byFile).toEqual(["pi", "--session", "/sessions/sess-1.json", "--provider", "x"]);
});
