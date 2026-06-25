import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTestDaemon } from "./helpers/daemon.ts";

const homes: string[] = [];

afterEach(async () => {
  for (const home of homes.splice(0)) {
    await rm(home, { recursive: true, force: true });
  }
});

async function startDaemon(home: string): Promise<{ baseUrl: string; stop: () => Promise<void> }> {
  return startTestDaemon({ home });
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

    const badModel = await postLaunch(daemon.baseUrl, { tool: "pi", name: "a", repo: "/r", model: "gpt-4o" });
    expect(badModel.status).toBe(400);
  } finally {
    await daemon.stop();
  }
});
