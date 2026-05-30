import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGroup, joinGroup, leaveGroup } from "../src/api/groups.ts";
import { deletePeer, listPeers, registerPeer } from "../src/api/peers.ts";
import type { ClientConfig } from "../src/client.ts";
import type { GroupMember } from "../src/api/types.ts";

// Reproduction harness for the peer-revival gap (sync-3nu). When a peer is
// soft-deleted (retention sweep after >24h offline, or operator evict) its
// group_members rows are flipped active=0. Re-registering the SAME peer_id
// resurrects the peer row (deleted_at=NULL, fresh lease) — but NOTHING
// re-activates its memberships, so a "revived" agent is online yet silent in
// every group. This proves a bare re-register/retry is insufficient.
// DELETE here stands in for the sweeper's soft-delete (identical DB effect),
// kept deterministic so the test needs no timing.

const homes: string[] = [];
afterAll(async () => {
  await Promise.all(homes.map((home) => rm(home, { recursive: true, force: true })));
});

interface DaemonEnv {
  leaseMs?: number;
  retentionMs?: number;
  sweepIntervalMs?: number;
}

async function startDaemon(env: DaemonEnv = {}): Promise<{ client: ClientConfig; stop: () => Promise<void> }> {
  const home = await mkdtemp(join(tmpdir(), "synchronize-revival-"));
  homes.push(home);
  const proc = Bun.spawn({
    cmd: [process.execPath, "run", "src/daemon.ts"],
    env: {
      ...process.env,
      SYNCHRONIZE_HOME: home,
      SYNCHRONIZE_PORT: "0",
      ...(env.leaseMs !== undefined ? { SYNCHRONIZE_LEASE_MS: String(env.leaseMs) } : {}),
      ...(env.retentionMs !== undefined ? { SYNCHRONIZE_PEER_RETENTION_MS: String(env.retentionMs) } : {}),
      ...(env.sweepIntervalMs !== undefined ? { SYNCHRONIZE_SWEEP_INTERVAL_MS: String(env.sweepIntervalMs) } : {}),
    },
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

async function activeMembers(client: ClientConfig, group: string): Promise<GroupMember[]> {
  const response = (await listPeers(client, { group })) as { peers: GroupMember[] };
  return response.peers;
}

test("a revived (re-registered) peer rejoins its groups — not just the roster", async () => {
  const daemon = await startDaemon();
  try {
    const { peer } = await registerPeer(daemon.client, { sessionName: "pi-member", tool: "pi" });
    await createGroup(daemon.client, { name: "room", creatorPeerId: peer.peer_id });
    await joinGroup(daemon.client, { name: "room", peerId: peer.peer_id, alias: "pim" });

    expect((await activeMembers(daemon.client, "room")).map((m) => m.peer_id)).toContain(peer.peer_id);

    // Soft-delete (sweeper / operator evict equivalent): peer hidden, memberships active=0.
    await deletePeer(daemon.client, peer.peer_id);
    expect((await activeMembers(daemon.client, "room")).map((m) => m.peer_id)).not.toContain(peer.peer_id);

    // The "fix" a bare retry would do: re-register the same peer_id.
    await registerPeer(daemon.client, { peerId: peer.peer_id, sessionName: "pi-member", tool: "pi" });

    // It IS back in the daemon roster (online)...
    const roster = (await listPeers(daemon.client)) as { peers: Array<{ peer_id: string; online?: boolean }> };
    expect(roster.peers.find((p) => p.peer_id === peer.peer_id)?.online).toBe(true);

    // ...but a correct revival must also restore group membership. This is the
    // assertion that fails today (reproduces sync-3nu) and that the fix makes pass.
    expect((await activeMembers(daemon.client, "room")).map((m) => m.peer_id)).toContain(peer.peer_id);
  } finally {
    await daemon.stop();
  }
});

test("revival does NOT reclaim an alias taken by someone else during the gap", async () => {
  const daemon = await startDaemon();
  try {
    const { peer: a } = await registerPeer(daemon.client, { sessionName: "agent-a", tool: "pi" });
    await createGroup(daemon.client, { name: "room", creatorPeerId: a.peer_id });
    await joinGroup(daemon.client, { name: "room", peerId: a.peer_id, alias: "shared" });

    // A dies; B claims A's old alias while A is gone.
    await deletePeer(daemon.client, a.peer_id);
    const { peer: b } = await registerPeer(daemon.client, { sessionName: "agent-b", tool: "pi" });
    await joinGroup(daemon.client, { name: "room", peerId: b.peer_id, alias: "shared" });

    // A re-registers. Its old "shared" membership must stay inactive (B owns the
    // alias now); the unique-active-alias invariant must hold.
    await registerPeer(daemon.client, { peerId: a.peer_id, sessionName: "agent-a", tool: "pi" });

    const members = await activeMembers(daemon.client, "room");
    const shared = members.filter((m) => m.alias === "shared");
    expect(shared).toHaveLength(1);
    expect(shared[0]?.peer_id).toBe(b.peer_id);
    expect(members.map((m) => m.peer_id)).not.toContain(a.peer_id);
  } finally {
    await daemon.stop();
  }
});

test("revival restores only death-deactivated groups, not ones the peer voluntarily left", async () => {
  const daemon = await startDaemon();
  try {
    const { peer } = await registerPeer(daemon.client, { sessionName: "pi-member", tool: "pi" });
    await createGroup(daemon.client, { name: "stay", creatorPeerId: peer.peer_id });
    await createGroup(daemon.client, { name: "quit", creatorPeerId: peer.peer_id });
    await joinGroup(daemon.client, { name: "stay", peerId: peer.peer_id, alias: "pim" });
    await joinGroup(daemon.client, { name: "quit", peerId: peer.peer_id, alias: "pim" });

    // Voluntarily leave "quit" (sets left_at = t1). The 10ms gap GUARANTEES t1 is
    // a distinct millisecond from the death timestamp below — strftime('%f') is
    // ms-resolution and two back-to-back local calls can otherwise collide,
    // which would spuriously reactivate "quit" and flake this assertion.
    await leaveGroup(daemon.client, { name: "quit", peerId: peer.peer_id });
    await Bun.sleep(10);

    // Death: soft-delete sets deleted_at = t2 and stamps the still-active "stay"
    // membership's left_at = t2 (COALESCE leaves "quit" at its earlier t1).
    await deletePeer(daemon.client, peer.peer_id);

    // Revive (bare re-register, same peer_id).
    await registerPeer(daemon.client, { peerId: peer.peer_id, sessionName: "pi-member", tool: "pi" });

    // reactivateMembershipsOnResurrect matches left_at == the cleared deleted_at
    // (t2): "stay" comes back; "quit" (left_at == t1) stays gone. This is the
    // death-vs-voluntary-leave discrimination the stopgap hinges on (sync-d0e).
    expect((await activeMembers(daemon.client, "stay")).map((m) => m.peer_id)).toContain(peer.peer_id);
    expect((await activeMembers(daemon.client, "quit")).map((m) => m.peer_id)).not.toContain(peer.peer_id);
  } finally {
    await daemon.stop();
  }
});

test("a peer swept by the retention sweeper (not DELETE) rejoins its groups on revival", async () => {
  // Death via the REAL sweeper, not the DELETE stand-in: this exercises the
  // production trigger end-to-end, and depends on sweepExpiredPeers writing the
  // SAME timestamp to peers.deleted_at and group_members.left_at (else
  // priorDeletedAt won't match and reactivation silently no-ops).
  const daemon = await startDaemon({ leaseMs: 200, retentionMs: 1, sweepIntervalMs: 250 });
  try {
    const { peer } = await registerPeer(daemon.client, { sessionName: "swept-member", tool: "pi" });
    await createGroup(daemon.client, { name: "room", creatorPeerId: peer.peer_id });
    await joinGroup(daemon.client, { name: "room", peerId: peer.peer_id, alias: "pim" });
    expect((await activeMembers(daemon.client, "room")).map((m) => m.peer_id)).toContain(peer.peer_id);

    // Lease lapses (200ms), expires past retention (1ms); sweeper (250ms) soft-
    // deletes the peer, dropping it from the roster and deactivating its rows.
    const deadline = Date.now() + 4_000;
    let swept = false;
    while (Date.now() < deadline) {
      const roster = (await listPeers(daemon.client)) as { peers: Array<{ peer_id: string }> };
      if (!roster.peers.some((p) => p.peer_id === peer.peer_id)) {
        swept = true;
        break;
      }
      await Bun.sleep(150);
    }
    expect(swept).toBe(true);
    expect((await activeMembers(daemon.client, "room")).map((m) => m.peer_id)).not.toContain(peer.peer_id);

    // Revive: same peer_id re-registers (resurrects + reactivates death rows).
    await registerPeer(daemon.client, { peerId: peer.peer_id, sessionName: "swept-member", tool: "pi" });
    expect((await activeMembers(daemon.client, "room")).map((m) => m.peer_id)).toContain(peer.peer_id);
  } finally {
    await daemon.stop();
  }
});
