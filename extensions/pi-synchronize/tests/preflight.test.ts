import { expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureSynchronizeCliReady } from "../src/preflight.ts";

async function withEnv<T>(env: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "synchronize-pi-preflight-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("Pi extension preflight runs synchronize status before registration", async () => {
  await withTempDir(async (dir) => {
    const fakeCli = join(dir, "synchronize");
    const logPath = join(dir, "calls.log");
    await writeFile(
      fakeCli,
      [
        "#!/bin/sh",
        'printf "%s\\n" "$*" >> "$SYNC_LOG"',
        '[ "$1" = "status" ] && exit 0',
        "exit 9",
        "",
      ].join("\n"),
      "utf8",
    );
    await chmod(fakeCli, 0o755);

    await withEnv(
      {
        PATH: "/usr/bin:/bin",
        SYNCHRONIZE_CLI: fakeCli,
        SYNCHRONIZE_CONFIGURED_CLI: join(dir, "missing-configured-synchronize"),
        SYNC_LOG: logPath,
      },
      async () => {
        await expect(ensureSynchronizeCliReady()).resolves.toBe(fakeCli);
      },
    );

    expect(await readFile(logPath, "utf8")).toBe("status\n");
  });
});

test("Pi extension preflight ignores broken configured path and fails quietly", async () => {
  await withTempDir(async (dir) => {
    const fakeCli = join(dir, "synchronize");
    const logPath = join(dir, "calls.log");
    await writeFile(
      fakeCli,
      [
        "#!/bin/sh",
        'printf "%s\\n" "$*" >> "$SYNC_LOG"',
        "exit 9",
        "",
      ].join("\n"),
      "utf8",
    );
    await chmod(fakeCli, 0o755);

    await withEnv(
      {
        PATH: "/usr/bin:/bin",
        SYNCHRONIZE_CLI: fakeCli,
        SYNCHRONIZE_CONFIGURED_CLI: join(dir, "missing-configured-synchronize"),
        SYNC_LOG: logPath,
      },
      async () => {
        await expect(ensureSynchronizeCliReady()).rejects.toThrow("no working synchronize CLI found");
      },
    );

    expect(await readFile(logPath, "utf8")).toBe("status\n");
  });
});
