import { afterAll, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { listPeers, registerPeer } from "../src/api/peers.ts";
import type { Peer } from "../src/api/types.ts";
import { startTestDaemon, type TestDaemon } from "./helpers/daemon.ts";

// End-to-end proof that the daemon honors config.toml [daemon] tunables (not
// just env). The short lease is driven purely through config.toml (via the
// shared harness) with NO SYNCHRONIZE_LEASE_MS env — the capability the config
// resolver unlocks. Also dogfoods the Phase-4 startTestDaemon helper.

const daemons: TestDaemon[] = [];
afterAll(async () => {
  await Promise.all(daemons.map((d) => d.stop().catch(() => {})));
  await Promise.all(daemons.map((d) => rm(d.home, { recursive: true, force: true })));
});

test("daemon honors [daemon] lease_ms from config.toml (peer goes offline on schedule)", async () => {
  const daemon = await startTestDaemon({ config: { daemon: { leaseMs: 400, peerRetentionMs: 60_000 } } });
  daemons.push(daemon);

  const { peer } = (await registerPeer(daemon.client, { sessionName: "cfg-toml", tool: "cli" })) as { peer: Peer };
  const fresh = ((await listPeers(daemon.client)) as { peers: Peer[] }).peers.find((p) => p.peer_id === peer.peer_id);
  expect(fresh?.presence).not.toBe("offline");

  // After the config.toml-driven 400ms lease lapses with no heartbeat => offline.
  await Bun.sleep(700);
  const dead = ((await listPeers(daemon.client)) as { peers: Peer[] }).peers.find((p) => p.peer_id === peer.peer_id);
  expect(dead?.presence).toBe("offline");
});
