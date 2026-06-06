import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listPeers, registerPeer } from "../src/api/peers.ts";
import type { ClientConfig } from "../src/client.ts";
import type { Peer } from "../src/api/types.ts";

// End-to-end proof that the daemon honors config.toml [daemon] tunables (not
// just env). We drive a short lease purely through a config.toml dropped into
// SYNCHRONIZE_HOME — NO SYNCHRONIZE_LEASE_MS env — and assert the peer goes
// offline on schedule. This is the new capability the config resolver unlocks.

const homes: string[] = [];
afterAll(async () => {
  await Promise.all(homes.map((home) => rm(home, { recursive: true, force: true })));
});

async function startDaemonWithConfigToml(toml: string): Promise<{ client: ClientConfig; stop: () => Promise<void> }> {
  const home = await mkdtemp(join(tmpdir(), "synchronize-cfgtoml-"));
  homes.push(home);
  await writeFile(join(home, "config.toml"), toml);
  // Deliberately do NOT set SYNCHRONIZE_LEASE_MS/etc — the value must come from
  // config.toml. Strip any inherited ones so the test is hermetic.
  const env: NodeJS.ProcessEnv = { ...process.env, SYNCHRONIZE_HOME: home, SYNCHRONIZE_PORT: "0" };
  delete env.SYNCHRONIZE_LEASE_MS;
  delete env.SYNCHRONIZE_PEER_RETENTION_MS;
  delete env.SYNCHRONIZE_SWEEP_INTERVAL_MS;
  const proc = Bun.spawn({ cmd: [process.execPath, "run", "src/daemon.ts"], env, stdout: "pipe", stderr: "pipe" });
  const discoveryPath = join(home, "daemon.json");
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const discovery = (await Bun.file(discoveryPath).json()) as { baseUrl: string };
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

test("daemon honors [daemon] lease_ms from config.toml (peer goes offline on schedule)", async () => {
  const daemon = await startDaemonWithConfigToml(`[daemon]\nlease_ms = 400\npeer_retention_ms = 60000\n`);
  try {
    const { peer } = (await registerPeer(daemon.client, { sessionName: "cfg-toml", tool: "cli" })) as { peer: Peer };
    // Fresh lease => online.
    const fresh = ((await listPeers(daemon.client)) as { peers: Peer[] }).peers.find((p) => p.peer_id === peer.peer_id);
    expect(fresh?.presence).not.toBe("offline");
    // After the (config.toml-driven) 400ms lease lapses with no heartbeat => offline.
    await Bun.sleep(700);
    const dead = ((await listPeers(daemon.client)) as { peers: Peer[] }).peers.find((p) => p.peer_id === peer.peer_id);
    expect(dead?.presence).toBe("offline");
  } finally {
    await daemon.stop();
  }
});
