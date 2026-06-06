import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/cli/commands/remote.ts";
import { loadConfig } from "../src/config.ts";

// Drives `synchronize remote` against a throwaway SYNCHRONIZE_HOME, asserting the
// on-disk config.toml is what ensureDaemon would later read. Captures stdout so
// `ls`/`show` output can be asserted; restores it (and SYNCHRONIZE_HOME) after.

const dirs: string[] = [];
let home: string;
let logs: string[];
const realLog = console.log;
const realHome = process.env.SYNCHRONIZE_HOME;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "sync-cli-remote-"));
  dirs.push(home);
  process.env.SYNCHRONIZE_HOME = home;
  logs = [];
  console.log = (...args: unknown[]) => logs.push(args.join(" "));
});

afterEach(() => {
  console.log = realLog;
  if (realHome === undefined) delete process.env.SYNCHRONIZE_HOME;
  else process.env.SYNCHRONIZE_HOME = realHome;
});

afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

test("remote add writes a profile and makes the first one active", async () => {
  await run(["add", "hub", "--url", "http://100.126.163.80:58412", "--token-env", "SYNCHRONIZE_TOKEN", "--ssh-host", "vpsme"]);
  const config = await loadConfig(join(home, "config.toml"));
  expect(config.active).toBe("hub");
  expect(config.remotes.hub).toEqual({
    url: "http://100.126.163.80:58412",
    tokenEnv: "SYNCHRONIZE_TOKEN",
    sync: { sshHost: "vpsme" },
  });
});

test("remote add/use/ls/show/remove lifecycle round-trips through disk", async () => {
  await run(["add", "hub", "--url", "http://hub:1"]);
  await run(["add", "laptop", "--url", "http://laptop:1"]);

  // adding a second profile must not steal active
  let config = await loadConfig(join(home, "config.toml"));
  expect(config.active).toBe("hub");

  await run(["use", "laptop"]);
  config = await loadConfig(join(home, "config.toml"));
  expect(config.active).toBe("laptop");

  logs = [];
  await run(["ls"]);
  const lsOut = logs.join("\n");
  expect(lsOut).toContain("* laptop"); // active marker on laptop
  expect(lsOut).toContain("  hub");

  logs = [];
  await run(["show"]); // active = laptop
  const shown = JSON.parse(logs.join("\n"));
  expect(shown.name).toBe("laptop");
  expect(shown.active).toBe(true);
  expect(shown.resolved_connection.remoteUrl).toBe("http://laptop:1");

  await run(["remove", "laptop"]);
  config = await loadConfig(join(home, "config.toml"));
  expect(config.remotes.laptop).toBeUndefined();
  expect(config.active).toBeUndefined(); // removed the active one
  expect(config.remotes.hub).toBeDefined();
});

test("remote show reflects an env override in resolved_connection", async () => {
  await run(["add", "hub", "--url", "http://hub:1"]);
  process.env.SYNCHRONIZE_REMOTE_URL = "http://override:9999";
  try {
    logs = [];
    await run(["show"]);
    const shown = JSON.parse(logs.join("\n"));
    expect(shown.profile.url).toBe("http://hub:1"); // profile is unchanged
    expect(shown.resolved_connection.remoteUrl).toBe("http://override:9999"); // env wins
  } finally {
    delete process.env.SYNCHRONIZE_REMOTE_URL;
  }
});
