import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseConfig } from "../src/config.ts";
import { resolveConfiguredAgentLaunchProfile } from "../src/launch/profiles.ts";

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

test("resolveConfiguredAgentLaunchProfile resolves env descriptors without leaking source values into config", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sync-agent-profile-"));
  dirs.push(dir);
  const tokenPath = join(dir, "token.txt");
  await writeFile(tokenPath, "file-secret\n");
  const config = parseConfig(`
[agent.glaude]
tool = "claude"
bin = "/opt/bin/claude"
repo = "/repo"
args = ["--profile-arg"]
session_name = "reviewer"

[agent.glaude.env]
LITERAL = "literal-value"
FROM_ENV = { from_env = "SOURCE_TOKEN" }
FROM_FILE = { from_file = "${tokenPath}" }
`);

  const profile = resolveConfiguredAgentLaunchProfile(config, "glaude", { SOURCE_TOKEN: "env-secret" } as NodeJS.ProcessEnv);

  expect(profile.tool).toBe("claude");
  expect(profile.bin).toBe("/opt/bin/claude");
  expect(profile.repo).toBe("/repo");
  expect(profile.args).toEqual(["--profile-arg"]);
  expect(profile.sessionName).toBe("reviewer");
  expect(profile.env).toEqual({
    LITERAL: "literal-value",
    FROM_ENV: "env-secret",
    FROM_FILE: "file-secret",
  });
});

test("resolveConfiguredAgentLaunchProfile rejects built-in profile names", () => {
  const config = parseConfig(`
[agent.claude]
tool = "claude"
`);
  expect(() => resolveConfiguredAgentLaunchProfile(config, "claude")).toThrow(/conflicts with built-in launch tool names/);
});
