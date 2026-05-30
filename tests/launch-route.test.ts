import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const homes: string[] = [];

afterEach(async () => {
  for (const home of homes.splice(0)) {
    await rm(home, { recursive: true, force: true });
  }
});

async function startDaemon(home: string): Promise<{ baseUrl: string; stop: () => Promise<void> }> {
  const proc = Bun.spawn({
    cmd: [process.execPath, "run", "src/daemon.ts"],
    env: { ...process.env, SYNCHRONIZE_HOME: home, SYNCHRONIZE_PORT: "0" },
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
          baseUrl: discovery.baseUrl,
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
  throw new Error("daemon did not start");
}

async function postLaunch(baseUrl: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}/agent-sessions/launch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

test("POST /agent-sessions/launch rejects invalid bodies with 400 invalid_launch", async () => {
  const home = await mkdtemp(join(tmpdir(), "sync-launch-route-"));
  homes.push(home);
  const daemon = await startDaemon(home);
  try {
    const badTool = await postLaunch(daemon.baseUrl, { tool: "codex", name: "a", repo: "/r" });
    expect(badTool.status).toBe(400);
    expect(badTool.json?.error?.code).toBe("invalid_launch");

    const missingRepo = await postLaunch(daemon.baseUrl, { tool: "claude", name: "a" });
    expect(missingRepo.status).toBe(400);

    const emptyName = await postLaunch(daemon.baseUrl, { tool: "claude", name: "", repo: "/r" });
    expect(emptyName.status).toBe(400);

    const badArgs = await postLaunch(daemon.baseUrl, { tool: "pi", name: "a", repo: "/r", args: [1, 2] });
    expect(badArgs.status).toBe(400);
  } finally {
    await daemon.stop();
  }
});
