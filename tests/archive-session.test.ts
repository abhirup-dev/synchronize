import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/db.ts";
import { markPeerArchived, planArchive, planResume } from "../src/daemon.ts";
import { createLaunchIntent } from "../src/launch/store.ts";

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code ?? "no_code";
  }
  return "no_throw";
}

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function freshDb() {
  const dir = await mkdtemp(join(tmpdir(), "sync-archive-session-"));
  dirs.push(dir);
  return openDatabase(join(dir, "synchronize.db"));
}

function insertPeer(db: Database, id: string) {
  db.query(
    `INSERT INTO peers (peer_id, tool, session_name, machine_id, lease_expires_at)
     VALUES (?, 'claude', ?, 'm1', '2099-01-01T00:00:00.000Z')`,
  ).run(id, id);
}

function insertGroup(db: Database, name: string): number {
  return db.query<{ group_id: number }, [string, string]>(
    `INSERT INTO groups (name, media_dir) VALUES (?, ?) RETURNING group_id`,
  ).get(name, `/tmp/${name}`)!.group_id;
}

function joinMember(db: Database, gid: number, peerId: string, alias: string) {
  db.query(
    `INSERT INTO group_members (group_id, peer_id, alias, active, member_state) VALUES (?, ?, ?, 1, 'active')`,
  ).run(gid, peerId, alias);
}

// ---------- markPeerArchived (state apply) ----------

test("markPeerArchived flips the peer to archived with reason + source and reserves seats", async () => {
  const { db } = await freshDb();
  insertPeer(db, "p");
  const g1 = insertGroup(db, "g1");
  const g2 = insertGroup(db, "g2");
  joinMember(db, g1, "p", "critic");
  joinMember(db, g2, "p", "planner");

  const reserved = markPeerArchived(db, "p", { reason: "checkpoint", source: "manual" });
  expect(reserved).toEqual([
    { group: "g1", alias: "critic" },
    { group: "g2", alias: "planner" },
  ]);

  const peer = db
    .query<{ lifecycle_state: string; archived_reason: string; archive_source: string; archived_at: string | null; deleted_at: string | null }, [string]>(
      "SELECT lifecycle_state, archived_reason, archive_source, archived_at, deleted_at FROM peers WHERE peer_id = ?",
    )
    .get("p")!;
  expect(peer.lifecycle_state).toBe("archived");
  expect(peer.archived_reason).toBe("checkpoint");
  expect(peer.archive_source).toBe("manual");
  expect(peer.archived_at).not.toBeNull();
  expect(peer.deleted_at).toBeNull(); // archive is NOT delete

  // Every membership: active=0, member_state='archived', invariant intact, left_at NULL.
  const rows = db
    .query<{ active: number; member_state: string; left_at: string | null }, [string]>(
      "SELECT active, member_state, left_at FROM group_members WHERE peer_id = ?",
    )
    .all("p");
  for (const row of rows) {
    expect(row.active).toBe(0);
    expect(row.member_state).toBe("archived");
    expect(row.left_at).toBeNull(); // archived member did not "leave"
  }
});

test("an archived seat is reserved against other peers; a left seat is not", async () => {
  const { db } = await freshDb();
  insertPeer(db, "pA");
  insertPeer(db, "pB");
  const gid = insertGroup(db, "g1");
  joinMember(db, gid, "pA", "critic");
  markPeerArchived(db, "pA", { source: "manual" });

  // pB cannot take the reserved (archived) alias.
  expect(() => joinMember(db, gid, "pB", "critic")).toThrow();
});

// ---------- planArchive (classification + enumeration) ----------

test("planArchive returns null for an unknown peer", async () => {
  const { db } = await freshDb();
  expect(planArchive(db, "nope")).toBeNull();
});

test("planArchive marks a launch-owned peer as AOE with its backend title", async () => {
  const { db } = await freshDb();
  insertPeer(db, "p");
  createLaunchIntent(db, {
    launchId: "l1",
    peerId: "p",
    tool: "claude",
    sessionName: "p",
    alias: "p",
    cwd: "/tmp/wt",
    backend: "local_aoe",
    backendTitle: "aoe_p_l1",
    state: "running" as never,
    now: "2024-01-01T00:00:00.000Z",
  });
  const plan = planArchive(db, "p")!;
  expect(plan.isAoe).toBe(true);
  expect(plan.backendTitle).toBe("aoe_p_l1");
  expect(plan.alreadyArchived).toBe(false);
});

test("planArchive marks a non-launch peer as non-AOE and reads its pid + aliases", async () => {
  const { db } = await freshDb();
  insertPeer(db, "p");
  const gid = insertGroup(db, "g1");
  joinMember(db, gid, "p", "critic");
  db.query(
    `INSERT INTO agent_sessions (binding_id, peer_id, host_tool, host_session_id, pid)
     VALUES ('b1', 'p', 'claude', 'hs1', 4242)`,
  ).run();
  const plan = planArchive(db, "p")!;
  expect(plan.isAoe).toBe(false);
  expect(plan.backendTitle).toBeNull();
  expect(plan.pid).toBe(4242);
  expect(plan.aliases).toEqual([{ group: "g1", alias: "critic" }]);
});

test("planArchive reflects an already-archived peer", async () => {
  const { db } = await freshDb();
  insertPeer(db, "p");
  markPeerArchived(db, "p", { source: "manual" });
  expect(planArchive(db, "p")!.alreadyArchived).toBe(true);
});

// ---------- planResume (resume gates) ----------

test("planResume rejects a non-archived peer with peer_not_archived", async () => {
  const { db } = await freshDb();
  insertPeer(db, "p");
  expect(codeOf(() => planResume(db, "p"))).toBe("peer_not_archived");
});

test("planResume rejects an archived peer with no captured host session as resume_not_launchable", async () => {
  const { db } = await freshDb();
  insertPeer(db, "p");
  markPeerArchived(db, "p", { source: "manual" });
  expect(codeOf(() => planResume(db, "p"))).toBe("resume_not_launchable");
});

test("planResume gathers the resume target for an archived session with a host session", async () => {
  const { db } = await freshDb();
  insertPeer(db, "p");
  const gid = insertGroup(db, "g1");
  joinMember(db, gid, "p", "critic");
  db.query(
    `INSERT INTO agent_sessions (binding_id, peer_id, host_tool, host_session_id, cwd, git_branch, pid)
     VALUES ('b1', 'p', 'claude', 'hs-9', '/tmp/wt', 'feat-x', 777)`,
  ).run();
  markPeerArchived(db, "p", { source: "manual" });
  const plan = planResume(db, "p");
  expect(plan.hostSessionId).toBe("hs-9");
  expect(plan.cwd).toBe("/tmp/wt");
  expect(plan.gitBranch).toBe("feat-x");
  expect(plan.pid).toBe(777);
  expect(plan.alias).toBe("critic");
  expect(plan.group).toBe("g1");
});
