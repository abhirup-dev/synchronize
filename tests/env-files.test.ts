import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "bun:test";
import { loadDaemonEnvFiles } from "../src/env-files.ts";
import type { RuntimePaths } from "../src/paths.ts";

function runtimePaths(home: string): RuntimePaths {
  return {
    home,
    dbPath: join(home, "synchronize.db"),
    mediaPath: join(home, "media"),
    discoveryPath: join(home, "daemon.json"),
    lockPath: join(home, "daemon.lock"),
    logPath: join(home, "daemon.log"),
    errLogPath: join(home, "daemon.err.log"),
    cliIdentityPath: join(home, "cli-peer.json"),
  };
}

test("daemon env files fill missing spawn env without overriding explicit env", async () => {
  const repo = await mkdtemp(join(tmpdir(), "synchronize-env-repo-"));
  const home = await mkdtemp(join(tmpdir(), "synchronize-env-home-"));
  await mkdir(join(repo, ".env"), { recursive: true });
  await mkdir(join(home, ".env"), { recursive: true });
  await writeFile(
    join(repo, ".env", "daemon.env"),
    [
      "# repo daemon secrets",
      "OPENROUTER_API_KEY=repo-key",
      "SYNCHRONIZE_LLM_MODEL=\"google/gemini-2.5-flash-lite\"",
      "EXPLICIT=from-file",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(join(home, ".env", "daemon.env"), "OPENROUTER_API_KEY=home-key\nHOME_ONLY=1\n", "utf8");

  const loaded = await loadDaemonEnvFiles(runtimePaths(home), repo, { EXPLICIT: "from-shell" });

  expect(loaded).toEqual({
    OPENROUTER_API_KEY: "repo-key",
    SYNCHRONIZE_LLM_MODEL: "google/gemini-2.5-flash-lite",
    HOME_ONLY: "1",
  });
});
