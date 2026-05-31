import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/db.ts";
import { deactivateStoppedLaunchPeer, reconcileLaunch, upsertPeer, type DaemonContext } from "../src/daemon.ts";
import { LaunchService } from "../src/launch/service.ts";
import type { SessionBackend } from "../src/launch/backend.ts";
import { createLaunchIntent, getLaunchIntent, listLaunchEvents, updateLaunchState } from "../src/launch/store.ts";

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

const noopBackend: SessionBackend = {
  ensureReady: async () => {},
  spawn: async () => {},
  stop: async () => {},
  list: async () => [],
};

async function harness() {
  const dir = await mkdtemp(join(tmpdir(), "sync-reconcile-"));
  dirs.push(dir);
  const { db } = await openDatabase(join(dir, "db.sqlite"));
  let nextId = 0;
  const launchService = new LaunchService({
    backend: noopBackend,
    home: dir,
    mintLaunchId: () => `L${++nextId}`,
    mintPeerId: () => `peer-${nextId}0000000`,
  });
  const ctx = {
    db,
    paths: { mediaPath: join(dir, "media") },
    launchService,
    subscribers: new Map(),
    webStateClients: new Set(),
    stateVersion: 0,
  } as unknown as DaemonContext;
  return { ctx, db, launchService };
}

function registerPeer(db: Parameters<typeof upsertPeer>[0], peerId: string, sessionName: string) {
  upsertPeer(db, {
    peerId,
    tool: "claude",
    sessionName,
    purpose: null,
    machineId: "test",
    leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
}

function memberOf(db: any, group: string, peerId: string): { alias: string; active: number } | null {
  const g = db.query("SELECT group_id FROM groups WHERE name = ?").get(group) as { group_id: number } | null;
  if (!g) return null;
  return db.query("SELECT alias, active FROM group_members WHERE group_id = ? AND peer_id = ?").get(g.group_id, peerId);
}

test("reconcile auto-joins a launched peer to its group, creating the group", async () => {
  const { ctx, db, launchService } = await harness();
  const res = await launchService.launch({ tool: "claude", name: "alice", repo: "/r", group: "alpha" });
  registerPeer(db, res.peerId, "alice");

  reconcileLaunch(ctx, res.launchId, res.peerId);

  const member = memberOf(db, "alpha", res.peerId);
  expect(member).not.toBeNull();
  expect(member?.alias).toBe("alice");
  expect(member?.active).toBe(1);
  // intent consumed
  expect(launchService.pending()).toHaveLength(0);
});

test("reconcile joins fresh (history_from = join event, not full backlog)", async () => {
  const { ctx, db, launchService } = await harness();
  const res = await launchService.launch({ tool: "claude", name: "alice", repo: "/r", group: "alpha" });
  registerPeer(db, res.peerId, "alice");
  reconcileLaunch(ctx, res.launchId, res.peerId);
  const g = db.query("SELECT group_id FROM groups WHERE name = 'alpha'").get() as { group_id: number };
  const row = db
    .query("SELECT join_event_id, history_from_event_id FROM group_members WHERE group_id = ? AND peer_id = ?")
    .get(g.group_id, res.peerId) as { join_event_id: number; history_from_event_id: number };
  expect(row.history_from_event_id).toBe(row.join_event_id);
});

test("reconcile is a no-op for standalone launches (no group)", async () => {
  const { ctx, db, launchService } = await harness();
  const res = await launchService.launch({ tool: "pi", name: "solo", repo: "/r" });
  registerPeer(db, res.peerId, "solo");
  reconcileLaunch(ctx, res.launchId, res.peerId);
  const groups = db.query("SELECT COUNT(*) AS n FROM groups").get() as { n: number };
  expect(groups.n).toBe(0);
});

test("reconcile is a no-op when launch_id is unknown or null", async () => {
  const { ctx, db } = await harness();
  registerPeer(db, "peer-x0000000", "x");
  expect(() => reconcileLaunch(ctx, "does-not-exist", "peer-x0000000")).not.toThrow();
  expect(() => reconcileLaunch(ctx, null, "peer-x0000000")).not.toThrow();
});

test("reconcile with a foreign peer_id does NOT join and preserves intent for the real agent", async () => {
  const { ctx, db, launchService } = await harness();
  const res = await launchService.launch({ tool: "claude", name: "alice", repo: "/r", group: "alpha" });
  // An imposter registers a different peer_id under the same launch_id.
  registerPeer(db, "imposter-00000000", "imposter");
  reconcileLaunch(ctx, res.launchId, "imposter-00000000");
  expect(memberOf(db, "alpha", "imposter-00000000")).toBeNull();
  expect(launchService.pending()).toHaveLength(1); // intent intact

  // The genuinely-launched agent (pinned peer_id) then registers and joins.
  registerPeer(db, res.peerId, "alice");
  reconcileLaunch(ctx, res.launchId, res.peerId);
  expect(memberOf(db, "alpha", res.peerId)?.active).toBe(1);
  expect(launchService.pending()).toHaveLength(0);
});

test("active alias collision => join_failed: session stays unjoined, no throw", async () => {
  const { ctx, db, launchService } = await harness();
  // First alice joins alpha.
  const a = await launchService.launch({ tool: "claude", name: "alice", repo: "/r", group: "alpha" });
  registerPeer(db, a.peerId, "alice");
  reconcileLaunch(ctx, a.launchId, a.peerId);
  expect(memberOf(db, "alpha", a.peerId)?.active).toBe(1);

  // Second, different peer, same alias 'alice', same active group.
  const b = await launchService.launch({ tool: "claude", name: "alice", repo: "/r", group: "alpha" });
  registerPeer(db, b.peerId, "alice");
  expect(() => reconcileLaunch(ctx, b.launchId, b.peerId)).not.toThrow();

  // b is NOT an active member (the collision blocked the join).
  expect(memberOf(db, "alpha", b.peerId)).toBeNull();
  // intent still consumed (no retry storm)
  expect(launchService.pending()).toHaveLength(0);
});

test("re-running reconcile after a successful join is idempotent", async () => {
  const { ctx, db, launchService } = await harness();
  const res = await launchService.launch({ tool: "claude", name: "alice", repo: "/r", group: "alpha" });
  registerPeer(db, res.peerId, "alice");
  reconcileLaunch(ctx, res.launchId, res.peerId);
  // launch_id already consumed; a second call is a no-op and must not throw.
  expect(() => reconcileLaunch(ctx, res.launchId, res.peerId)).not.toThrow();
  const g = db.query("SELECT group_id FROM groups WHERE name = 'alpha'").get() as { group_id: number };
  const joins = db
    .query("SELECT COUNT(*) AS n FROM events WHERE group_id = ? AND type = 'group_joined'")
    .get(g.group_id) as { n: number };
  expect(joins.n).toBe(1);
});

test("durable reconcile joins after in-memory pending state is gone", async () => {
  const { ctx, db } = await harness();
  createLaunchIntent(db, {
    launchId: "durable-1",
    peerId: "peer-durable",
    tool: "claude",
    sessionName: "dora",
    alias: "dora",
    cwd: "/repo",
    targetGroup: "release",
    backend: "local_aoe",
    backendTitle: "abc12345-dora",
    now: "2026-05-31T00:00:00.000Z",
  });
  updateLaunchState(db, {
    launchId: "durable-1",
    fromState: "accepted",
    state: "prompt_accepted",
    eventKind: "prompt_accepted",
    now: "2026-05-31T00:00:01.000Z",
  });
  registerPeer(db, "peer-durable", "dora");

  reconcileLaunch(ctx, "durable-1", "peer-durable");

  expect(memberOf(db, "release", "peer-durable")).toMatchObject({ alias: "dora", active: 1 });
  expect(getLaunchIntent(db, "durable-1")).toMatchObject({
    state: "running",
    registered_at: expect.any(String),
    joined_at: expect.any(String),
  });
  expect(listLaunchEvents(db, "durable-1").map((event) => event.kind)).toContain("join_succeeded");
  expect(ctx.launchService.pending()).toHaveLength(0);
});

test("durable reconcile preserves intent on peer mismatch and lets the real peer join later", async () => {
  const { ctx, db } = await harness();
  createLaunchIntent(db, {
    launchId: "durable-2",
    peerId: "peer-real",
    tool: "claude",
    sessionName: "erin",
    alias: "erin",
    cwd: "/repo",
    targetGroup: "release",
    backend: "local_aoe",
    backendTitle: "abc12345-erin",
    now: "2026-05-31T00:00:00.000Z",
  });
  updateLaunchState(db, {
    launchId: "durable-2",
    fromState: "accepted",
    state: "prompt_accepted",
    eventKind: "prompt_accepted",
    now: "2026-05-31T00:00:01.000Z",
  });

  registerPeer(db, "peer-fake", "imposter");
  reconcileLaunch(ctx, "durable-2", "peer-fake");
  expect(memberOf(db, "release", "peer-fake")).toBeNull();
  expect(getLaunchIntent(db, "durable-2")?.state).toBe("prompt_accepted");
  expect(listLaunchEvents(db, "durable-2").map((event) => event.kind)).toContain("launch.peer_mismatch");

  registerPeer(db, "peer-real", "erin");
  reconcileLaunch(ctx, "durable-2", "peer-real");
  expect(memberOf(db, "release", "peer-real")).toMatchObject({ alias: "erin", active: 1 });
  expect(getLaunchIntent(db, "durable-2")?.state).toBe("running");
});

test("stopped launch cleanup soft-deletes peer and deactivates group membership", async () => {
  const { ctx, db, launchService } = await harness();
  const res = await launchService.launch({ tool: "claude", name: "alice", repo: "/r", group: "alpha" });
  registerPeer(db, res.peerId, "alice");
  reconcileLaunch(ctx, res.launchId, res.peerId);
  expect(memberOf(db, "alpha", res.peerId)).toMatchObject({ alias: "alice", active: 1 });

  expect(deactivateStoppedLaunchPeer(ctx, res.peerId)).toBe(true);
  expect(memberOf(db, "alpha", res.peerId)).toMatchObject({ alias: "alice", active: 0 });
  const peer = db
    .query("SELECT deleted_at, lease_expires_at FROM peers WHERE peer_id = ?")
    .get(res.peerId) as { deleted_at: string | null; lease_expires_at: string };
  expect(peer.deleted_at).toBeTruthy();
  const deletedAt = peer.deleted_at;
  if (!deletedAt) throw new Error("expected stopped launch peer to be soft-deleted");
  expect(peer.lease_expires_at).toBe(deletedAt);
  expect(deactivateStoppedLaunchPeer(ctx, res.peerId)).toBe(false);
});
