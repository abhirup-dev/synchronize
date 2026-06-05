import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverDaemon } from "../src/client.ts";

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
  const dir = await mkdtemp(join(tmpdir(), "synchronize-pi-client-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("Pi extension discovers remote daemon from SYNCHRONIZE_REMOTE_URL", async () => {
  await withTempDir(async (dir) => {
    await withEnv(
      {
        SYNCHRONIZE_HOME: dir,
        SYNCHRONIZE_REMOTE_URL: "http://100.126.163.80:58412/",
        SYNCHRONIZE_TOKEN: "secret",
      },
      async () => {
        await expect(discoverDaemon()).resolves.toEqual({
          baseUrl: "http://100.126.163.80:58412",
          token: "secret",
          remote: true,
        });
      },
    );
  });
});

test("Pi extension preserves daemon.json discovery when remote URL is unset", async () => {
  await withTempDir(async (dir) => {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "daemon.json"), JSON.stringify({ baseUrl: "http://127.0.0.1:58405" }), "utf8");

    await withEnv(
      {
        SYNCHRONIZE_HOME: dir,
        SYNCHRONIZE_REMOTE_URL: undefined,
        SYNCHRONIZE_TOKEN: undefined,
      },
      async () => {
        await expect(discoverDaemon()).resolves.toEqual({
          baseUrl: "http://127.0.0.1:58405",
          token: null,
        });
      },
    );
  });
});

test("Pi extension rejects malformed remote daemon URLs", async () => {
  await withEnv({ SYNCHRONIZE_REMOTE_URL: "file:///tmp/daemon.json" }, async () => {
    await expect(discoverDaemon()).rejects.toThrow("SYNCHRONIZE_REMOTE_URL must use http or https");
  });
});
