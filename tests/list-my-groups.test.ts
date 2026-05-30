import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClientConfig } from "../src/client.ts";
import { registerAgentSession } from "../src/api/agent-sessions.ts";
import { createGroup, joinGroup, listGroups, listMyGroups } from "../src/api/groups.ts";

const homes: string[] = [];
afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true });
});

async function startDaemon(home: string): Promise<{ client: ClientConfig; stop: () => Promise<void> }> {
  const proc = Bun.spawn({
    cmd: [process.execPath, "run", "src/daemon.ts"],
    env: { ...process.env, SYNCHRONIZE_HOME: home, SYNCHRONIZE_PORT: "0" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const discovery = (await Bun.file(join(home, "daemon.json")).json()) as { baseUrl: string };
      const health = await fetch(`${discovery.baseUrl}/health`).catch(() => null);
      if (health?.ok) {
        return {
          client: { baseUrl: discovery.baseUrl, token: null, paths: {} as ClientConfig["paths"], started: false },
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

test("GET /groups?member returns only the peer's active groups with alias + joined_at", async () => {
  const home = await mkdtemp(join(tmpdir(), "sync-mygroups-"));
  homes.push(home);
  const daemon = await startDaemon(home);
  try {
    const { binding } = await registerAgentSession(daemon.client, {
      hostTool: "claude",
      hostSessionId: "sess-mine-1",
      sessionName: "alice",
    });
    const peerId = binding.peer_id;

    await createGroup(daemon.client, { name: "alpha", creatorPeerId: peerId });
    await createGroup(daemon.client, { name: "beta" }); // peer is NOT a member of beta
    await joinGroup(daemon.client, { name: "alpha", peerId, alias: "alice" });

    const all = await listGroups(daemon.client);
    expect(all.groups.map((g) => g.name).sort()).toEqual(["alpha", "beta"]);

    const mine = await listMyGroups(daemon.client, peerId);
    expect(mine.groups).toHaveLength(1);
    expect(mine.groups[0]?.name).toBe("alpha");
    expect(mine.groups[0]?.alias).toBe("alice");
    expect(typeof mine.groups[0]?.joined_at).toBe("string");
  } finally {
    await daemon.stop();
  }
});
