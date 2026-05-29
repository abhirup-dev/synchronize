import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerAgentSession } from "../src/api/agent-sessions.ts";
import { deletePeer, heartbeatPeer, listPeers, registerPeer, setPeerActivity } from "../src/api/peers.ts";
import type { ClientConfig } from "../src/client.ts";
import type { Peer } from "../src/api/types.ts";

// Agent-presence harness. Each daemon is spawned with custom lease / retention
// / sweep-interval env so a test can synthetically emulate a real session
// lifecycle (join → working → idle → offline → resume → sweep) entirely over
// the REST surface that the Pi extension and Claude hooks drive. No real agent
// processes — the activity pushes and lease lapses ARE the emulation.
// See session-tracker/plan-agent-ttl-presence-v0.md.

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
  const home = await mkdtemp(join(tmpdir(), "synchronize-presence-"));
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

async function rosterPeer(client: ClientConfig, peerId: string): Promise<Peer | undefined> {
  const response = (await listPeers(client)) as { peers: Peer[] };
  return response.peers.find((peer) => peer.peer_id === peerId);
}

test("instrumented agent: join → working → idle transitions drive presence", async () => {
  const daemon = await startDaemon({ leaseMs: 60_000 });
  try {
    const { peer } = await registerPeer(daemon.client, { sessionName: "pi-agent", tool: "pi" });
    // Freshly registered agent is initializing until the first activity push.
    expect((await rosterPeer(daemon.client, peer.peer_id))?.presence).toBe("initializing");

    await setPeerActivity(daemon.client, { peerId: peer.peer_id, state: "working" });
    expect((await rosterPeer(daemon.client, peer.peer_id))?.presence).toBe("working");

    await setPeerActivity(daemon.client, { peerId: peer.peer_id, state: "idle" });
    const idle = await rosterPeer(daemon.client, peer.peer_id);
    expect(idle?.presence).toBe("idle");
    expect(idle?.online).toBe(true);
  } finally {
    await daemon.stop();
  }
});

test("Claude host-session activity form resolves the peer (no peer_id needed)", async () => {
  const daemon = await startDaemon({ leaseMs: 60_000 });
  try {
    const { binding } = await registerAgentSession(daemon.client, {
      hostTool: "claude",
      hostSessionId: "claude-presence-1",
      sessionName: "claude-agent",
      tool: "claude",
      purpose: "claude session",
    });
    // SessionStart-registered agent starts initializing.
    expect((await rosterPeer(daemon.client, binding.peer_id))?.presence).toBe("initializing");

    await setPeerActivity(daemon.client, {
      hostTool: "claude",
      hostSessionId: "claude-presence-1",
      state: "working",
    });
    expect((await rosterPeer(daemon.client, binding.peer_id))?.presence).toBe("working");
  } finally {
    await daemon.stop();
  }
});

test("uninstrumented peer (cli) shows generic online, never initializing", async () => {
  const daemon = await startDaemon({ leaseMs: 60_000 });
  try {
    const { peer } = await registerPeer(daemon.client, { sessionName: "cli-tool", tool: "cli" });
    const row = await rosterPeer(daemon.client, peer.peer_id);
    expect(row?.activity_state ?? null).toBeNull();
    expect(row?.presence).toBe("online");
  } finally {
    await daemon.stop();
  }
});

test("short lease: a peer that stops heartbeating goes offline (the only crash detector)", async () => {
  const daemon = await startDaemon({ leaseMs: 400, retentionMs: 60_000 });
  try {
    const { peer } = await registerPeer(daemon.client, { sessionName: "crash-agent", tool: "pi" });
    expect((await rosterPeer(daemon.client, peer.peer_id))?.online).toBe(true);

    // Emulate the process dying: stop heartbeating, wait past the lease window.
    await Bun.sleep(700);
    const dead = await rosterPeer(daemon.client, peer.peer_id);
    expect(dead?.online).toBe(false);
    expect(dead?.presence).toBe("offline");
    // Within retention it is still listed (offline, not swept) for audit.
    expect(dead).toBeDefined();
  } finally {
    await daemon.stop();
  }
});

test("heartbeat and activity pushes both refresh the lease (proof-of-life)", async () => {
  const daemon = await startDaemon({ leaseMs: 500, retentionMs: 60_000 });
  try {
    const { peer } = await registerPeer(daemon.client, { sessionName: "busy-agent", tool: "pi" });

    // A heartbeat keeps it online across what would otherwise be a lapse.
    await Bun.sleep(300);
    await heartbeatPeer(daemon.client, peer.peer_id);
    await Bun.sleep(300);
    expect((await rosterPeer(daemon.client, peer.peer_id))?.online).toBe(true);

    // An activity push also refreshes the lease — a busy agent cannot offline.
    await setPeerActivity(daemon.client, { peerId: peer.peer_id, state: "working" });
    await Bun.sleep(300);
    const stillBusy = await rosterPeer(daemon.client, peer.peer_id);
    expect(stillBusy?.online).toBe(true);
    expect(stillBusy?.presence).toBe("working");
  } finally {
    await daemon.stop();
  }
});

test("resume: re-registering the same host session revives the same peer after offline", async () => {
  const daemon = await startDaemon({ leaseMs: 400, retentionMs: 60_000 });
  try {
    const first = await registerAgentSession(daemon.client, {
      hostTool: "claude",
      hostSessionId: "claude-resume-1",
      sessionName: "resumable",
      tool: "claude",
      purpose: "claude session",
    });
    const peerId = first.binding.peer_id;

    // Let the lease lapse — the session "ended" (no clean delete, lease-only).
    await Bun.sleep(700);
    expect((await rosterPeer(daemon.client, peerId))?.online).toBe(false);

    // Resume: same host_session_id → same peer, fresh lease, back online.
    const resumed = await registerAgentSession(daemon.client, {
      hostTool: "claude",
      hostSessionId: "claude-resume-1",
      sessionName: "resumable",
      tool: "claude",
      purpose: "claude session",
      metadata: { source: "resume" },
    });
    expect(resumed.binding.peer_id).toBe(peerId);
    expect((await rosterPeer(daemon.client, peerId))?.online).toBe(true);
  } finally {
    await daemon.stop();
  }
});

test("sweeper soft-deletes a peer once its lease has been expired past retention", async () => {
  const daemon = await startDaemon({ leaseMs: 200, retentionMs: 1, sweepIntervalMs: 250 });
  try {
    const { peer } = await registerPeer(daemon.client, { sessionName: "stale-agent", tool: "pi" });
    expect(await rosterPeer(daemon.client, peer.peer_id)).toBeDefined();

    // Lease lapses (200ms) and is then expired beyond retention (1ms); the
    // sweeper (every 250ms) soft-deletes it, so it leaves the default roster.
    const deadline = Date.now() + 4_000;
    let swept = false;
    while (Date.now() < deadline) {
      if (!(await rosterPeer(daemon.client, peer.peer_id))) {
        swept = true;
        break;
      }
      await Bun.sleep(150);
    }
    expect(swept).toBe(true);
  } finally {
    await daemon.stop();
  }
});

test("resume revives a host-session peer even after the sweeper soft-deleted it", async () => {
  const daemon = await startDaemon({ leaseMs: 200, retentionMs: 1, sweepIntervalMs: 250 });
  try {
    const first = await registerAgentSession(daemon.client, {
      hostTool: "claude",
      hostSessionId: "claude-swept-1",
      sessionName: "long-gone",
      tool: "claude",
      purpose: "claude session",
    });
    const peerId = first.binding.peer_id;

    // Wait for the sweeper to hide the dead peer.
    const deadline = Date.now() + 4_000;
    while (Date.now() < deadline && (await rosterPeer(daemon.client, peerId))) await Bun.sleep(150);
    expect(await rosterPeer(daemon.client, peerId)).toBeUndefined();

    // Resume after sweep: same host session → same peer_id, back in the roster.
    const resumed = await registerAgentSession(daemon.client, {
      hostTool: "claude",
      hostSessionId: "claude-swept-1",
      sessionName: "long-gone",
      tool: "claude",
      purpose: "claude session",
      metadata: { source: "resume" },
    });
    expect(resumed.binding.peer_id).toBe(peerId);
    expect((await rosterPeer(daemon.client, peerId))?.online).toBe(true);
  } finally {
    await daemon.stop();
  }
});

test("infinite-lease web peer survives the sweeper while a short-lease agent is swept", async () => {
  const daemon = await startDaemon({ leaseMs: 200, retentionMs: 1, sweepIntervalMs: 250 });
  try {
    const web = await registerPeer(daemon.client, { sessionName: "web-ui", tool: "web" });
    const agent = await registerPeer(daemon.client, { sessionName: "ephemeral", tool: "pi" });

    // Give the sweeper several ticks to act on the expired agent peer.
    const deadline = Date.now() + 4_000;
    while (Date.now() < deadline && (await rosterPeer(daemon.client, agent.peer.peer_id))) await Bun.sleep(150);

    expect(await rosterPeer(daemon.client, agent.peer.peer_id)).toBeUndefined();
    const webRow = await rosterPeer(daemon.client, web.peer.peer_id);
    expect(webRow?.online).toBe(true);
    expect(webRow?.presence).toBe("online");
  } finally {
    await daemon.stop();
  }
});

test("activity endpoint rejects an unknown state", async () => {
  const daemon = await startDaemon({ leaseMs: 60_000 });
  try {
    const { peer } = await registerPeer(daemon.client, { sessionName: "agent", tool: "pi" });
    const response = await fetch(`${daemon.client.baseUrl}/peers/activity`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ peer_id: peer.peer_id, state: "thinking" }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("invalid_activity_state");
  } finally {
    await daemon.stop();
  }
});

test("operator delete still works (the one allowed delete path)", async () => {
  const daemon = await startDaemon({ leaseMs: 60_000 });
  try {
    const { peer } = await registerPeer(daemon.client, { sessionName: "evict-me", tool: "pi" });
    expect(await rosterPeer(daemon.client, peer.peer_id)).toBeDefined();
    await deletePeer(daemon.client, peer.peer_id);
    expect(await rosterPeer(daemon.client, peer.peer_id)).toBeUndefined();
  } finally {
    await daemon.stop();
  }
});
