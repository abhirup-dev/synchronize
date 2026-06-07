import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/db.ts";
import {
  deactivateStoppedLaunchPeer,
  selectExpiredPeerIds,
  selectStoppedLaunchPeerIds,
  type DaemonContext,
} from "../src/daemon.ts";
import { createLaunchIntent } from "../src/launch/store.ts";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function freshDb() {
  const dir = await mkdtemp(join(tmpdir(), "sync-archive-gc-"));
  dirs.push(dir);
  return openDatabase(join(dir, "synchronize.db"));
}

function insertPeer(
  db: Database,
  id: string,
  opts: { lease?: string; lifecycle?: string; deletedAt?: string | null } = {},
) {
  db.query(
    `INSERT INTO peers (peer_id, tool, session_name, machine_id, lease_expires_at, lifecycle_state, deleted_at)
     VALUES (?, 'claude', ?, 'm1', ?, ?, ?)`,
  ).run(
    id,
    id,
    opts.lease ?? "2099-01-01T00:00:00.000Z",
    opts.lifecycle ?? "active",
    opts.deletedAt ?? null,
  );
}

function seedLaunch(db: Database, launchId: string, peerId: string, state: string, now: string) {
  createLaunchIntent(db, {
    launchId,
    peerId,
    tool: "claude",
    sessionName: peerId,
    alias: peerId,
    cwd: "/tmp/wt",
    backend: "aoe",
    backendTitle: `t_${launchId}`,
    state: state as never,
    now,
  });
}

const PAST = "2000-01-01T00:00:00.000Z";
const CUTOFF = "2020-01-01T00:00:00.000Z";

// ---------- l2lt.1: retention sweep exempts archived ----------

test("retention sweep selects an active lease-expired peer", async () => {
  const { db } = await freshDb();
  insertPeer(db, "expired", { lease: PAST });
  expect(selectExpiredPeerIds(db, CUTOFF)).toEqual(["expired"]);
});

test("retention sweep SKIPS an archived lease-expired peer (survives every tick)", async () => {
  const { db } = await freshDb();
  insertPeer(db, "archived", { lease: PAST, lifecycle: "archived" });
  expect(selectExpiredPeerIds(db, CUTOFF)).toEqual([]);
});

test("retention sweep ignores fresh-lease and already-deleted peers", async () => {
  const { db } = await freshDb();
  insertPeer(db, "fresh", { lease: "2099-01-01T00:00:00.000Z" });
  insertPeer(db, "gone", { lease: PAST, deletedAt: "2001-01-01T00:00:00.000Z" });
  expect(selectExpiredPeerIds(db, CUTOFF)).toEqual([]);
});

// ---------- l2lt.2: stopped-launch sweep gates on the latest launch ----------

test("a peer whose only launch is stopped is swept", async () => {
  const { db } = await freshDb();
  insertPeer(db, "p");
  seedLaunch(db, "l1", "p", "stopped", "2024-01-01T00:00:00.000Z");
  expect(selectStoppedLaunchPeerIds(db)).toEqual(["p"]);
});

test("a peer with stopped original + newer running resume is NOT swept", async () => {
  const { db } = await freshDb();
  insertPeer(db, "p");
  seedLaunch(db, "orig", "p", "stopped", "2024-01-01T00:00:00.000Z");
  seedLaunch(db, "resume", "p", "running", "2024-06-01T00:00:00.000Z"); // newer
  expect(selectStoppedLaunchPeerIds(db)).toEqual([]);
});

test("a peer with stopped original + newer in-progress (non-terminal) resume is NOT swept", async () => {
  const { db } = await freshDb();
  insertPeer(db, "p");
  seedLaunch(db, "orig", "p", "stopped", "2024-01-01T00:00:00.000Z");
  seedLaunch(db, "resume", "p", "spawning", "2024-06-01T00:00:00.000Z");
  expect(selectStoppedLaunchPeerIds(db)).toEqual([]);
});

test("an archived peer with a stopped latest launch is still exempt", async () => {
  const { db } = await freshDb();
  insertPeer(db, "p", { lifecycle: "archived" });
  seedLaunch(db, "l1", "p", "stopped", "2024-01-01T00:00:00.000Z");
  expect(selectStoppedLaunchPeerIds(db)).toEqual([]);
});

test("a peer with no launches is never a stopped-launch candidate", async () => {
  const { db } = await freshDb();
  insertPeer(db, "p");
  expect(selectStoppedLaunchPeerIds(db)).toEqual([]);
});

// ---------- l2lt.1: stop path (deactivateStoppedLaunchPeer) is archive-aware ----------

function ctxFor(db: Database): DaemonContext {
  return { db, subscribers: new Map() } as unknown as DaemonContext;
}

test("deactivateStoppedLaunchPeer soft-deletes a normal (active) peer", async () => {
  const { db } = await freshDb();
  insertPeer(db, "p", { lease: "2099-01-01T00:00:00.000Z" });
  const result = deactivateStoppedLaunchPeer(ctxFor(db), "p");
  expect(result).toBe(true);
  const row = db.query<{ deleted_at: string | null }, [string]>("SELECT deleted_at FROM peers WHERE peer_id = ?").get("p")!;
  expect(row.deleted_at).not.toBeNull();
});

test("deactivateStoppedLaunchPeer REFUSES to soft-delete an archived peer (reap is not delete)", async () => {
  const { db } = await freshDb();
  insertPeer(db, "p", { lease: PAST, lifecycle: "archived" });
  const result = deactivateStoppedLaunchPeer(ctxFor(db), "p");
  expect(result).toBe(false);
  const row = db.query<{ deleted_at: string | null }, [string]>("SELECT deleted_at FROM peers WHERE peer_id = ?").get("p")!;
  expect(row.deleted_at).toBeNull(); // identity preserved for resume
});

test("an archived peer keeps its reserved alias when a reap is attempted", async () => {
  const { db } = await freshDb();
  const gid = db.query<{ group_id: number }, []>(`INSERT INTO groups (name, media_dir) VALUES ('g', '/tmp/g') RETURNING group_id`).get()!.group_id;
  insertPeer(db, "pA", { lease: PAST, lifecycle: "archived" });
  insertPeer(db, "pB", { lease: "2099-01-01T00:00:00.000Z" });
  db.query(`INSERT INTO group_members (group_id, peer_id, alias, active, member_state) VALUES (?, 'pA', 'critic', 0, 'archived')`).run(gid);
  // Reap attempt must be a no-op for the archived peer.
  expect(deactivateStoppedLaunchPeer(ctxFor(db), "pA")).toBe(false);
  // Alias still reserved: pB cannot claim it.
  expect(() =>
    db.query(`INSERT INTO group_members (group_id, peer_id, alias, active, member_state) VALUES (?, 'pB', 'critic', 1, 'active')`).run(gid),
  ).toThrow();
});
