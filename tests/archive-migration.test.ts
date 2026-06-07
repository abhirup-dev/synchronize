import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/db.ts";

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function freshDb() {
  const dir = await mkdtemp(join(tmpdir(), "sync-archive-mig-"));
  dirs.push(dir);
  const path = join(dir, "synchronize.db");
  return { handle: await openDatabase(path), path };
}

function cols(db: Database, table: string): string[] {
  return db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

function insertPeer(db: Database, id: string, sessionName = id) {
  db.query(
    `INSERT INTO peers (peer_id, tool, session_name, machine_id, lease_expires_at)
     VALUES (?, 'claude', ?, 'm1', '2099-01-01T00:00:00.000Z')`,
  ).run(id, sessionName);
}

function insertGroup(db: Database, name: string): number {
  db.query(`INSERT INTO groups (name, media_dir) VALUES (?, ?)`).run(name, `/tmp/${name}`);
  return db.query<{ group_id: number }, [string]>(`SELECT group_id FROM groups WHERE name = ?`).get(name)!.group_id;
}

test("v11 adds lifecycle columns to peers and groups with correct defaults", async () => {
  const { handle } = await freshDb();
  const { db } = handle;
  const peerCols = cols(db, "peers");
  expect(peerCols).toContain("lifecycle_state");
  expect(peerCols).toContain("archived_at");
  expect(peerCols).toContain("archived_reason");
  expect(peerCols).toContain("archive_source");
  expect(peerCols).toContain("auto_archive");
  expect(cols(db, "groups")).toContain("auto_archive");

  insertPeer(db, "p1");
  const peer = db
    .query<{ lifecycle_state: string; auto_archive: number | null }, [string]>(
      `SELECT lifecycle_state, auto_archive FROM peers WHERE peer_id = ?`,
    )
    .get("p1")!;
  expect(peer.lifecycle_state).toBe("active");
  expect(peer.auto_archive).toBeNull(); // per-agent override defaults to inherit

  insertGroup(db, "g1");
  const group = db
    .query<{ auto_archive: number }, [string]>(`SELECT auto_archive FROM groups WHERE name = ?`)
    .get("g1")!;
  expect(group.auto_archive).toBe(0);
});

test("v12 adds member_state to group_members and migrations are recorded", async () => {
  const { handle } = await freshDb();
  const { db } = handle;
  expect(cols(db, "group_members")).toContain("member_state");
  const versions = db
    .query<{ version: number }, []>(`SELECT version FROM schema_migrations WHERE version IN (11, 12) ORDER BY version`)
    .all()
    .map((r) => r.version);
  expect(versions).toEqual([11, 12]);
});

test("re-running migrate() (reopen) is an idempotent no-op", async () => {
  const { handle, path } = await freshDb();
  insertPeer(handle.db, "p1");
  const gid = insertGroup(handle.db, "g1");
  handle.db.query(
    `INSERT INTO group_members (group_id, peer_id, alias, active, member_state) VALUES (?, 'p1', 'critic', 1, 'active')`,
  ).run(gid);
  handle.db.close();

  // Reopen → migrate() runs again over the populated DB.
  const reopened = await openDatabase(path);
  const { db } = reopened;
  // Data survived and migrations are still single rows.
  expect(db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM peers`).get()!.n).toBe(1);
  for (const v of [11, 12]) {
    const n = db.query<{ n: number }, [number]>(`SELECT COUNT(*) AS n FROM schema_migrations WHERE version = ?`).get(v)!.n;
    expect(n).toBe(1);
  }
});

test("archived member's alias is NOT reclaimable by another peer in the same group", async () => {
  const { handle } = await freshDb();
  const { db } = handle;
  const gid = insertGroup(db, "g1");
  insertPeer(db, "pA");
  insertPeer(db, "pB");
  db.query(
    `INSERT INTO group_members (group_id, peer_id, alias, active, member_state) VALUES (?, 'pA', 'critic', 1, 'active')`,
  ).run(gid);
  // Archive pA's seat: delivery off, lifecycle archived (invariant held).
  db.query(`UPDATE group_members SET active = 0, member_state = 'archived' WHERE group_id = ? AND peer_id = 'pA'`).run(gid);

  // pB trying to take the reserved alias must fail the unique index.
  expect(() =>
    db.query(
      `INSERT INTO group_members (group_id, peer_id, alias, active, member_state) VALUES (?, 'pB', 'critic', 1, 'active')`,
    ).run(gid),
  ).toThrow();
});

test("a left member frees its alias for another peer", async () => {
  const { handle } = await freshDb();
  const { db } = handle;
  const gid = insertGroup(db, "g1");
  insertPeer(db, "pA");
  insertPeer(db, "pB");
  db.query(
    `INSERT INTO group_members (group_id, peer_id, alias, active, member_state) VALUES (?, 'pA', 'critic', 1, 'active')`,
  ).run(gid);
  db.query(`UPDATE group_members SET active = 0, member_state = 'left' WHERE group_id = ? AND peer_id = 'pA'`).run(gid);

  expect(() =>
    db.query(
      `INSERT INTO group_members (group_id, peer_id, alias, active, member_state) VALUES (?, 'pB', 'critic', 1, 'active')`,
    ).run(gid),
  ).not.toThrow();
});

test("duplicate session_name across peers is still allowed", async () => {
  const { handle } = await freshDb();
  const { db } = handle;
  insertPeer(db, "p1", "research");
  expect(() => insertPeer(db, "p2", "research")).not.toThrow();
});

test("backfill SQL maps the delivery bit to member_state preserving the invariant", async () => {
  const { handle } = await freshDb();
  const { db } = handle;
  const gid = insertGroup(db, "g1");
  insertPeer(db, "pA");
  insertPeer(db, "pB");
  // Simulate pre-backfill rows where member_state defaulted to 'active' but the
  // delivery bit disagrees (as a real pre-v12 row would after the ADD COLUMN).
  db.query(`INSERT INTO group_members (group_id, peer_id, alias, active, member_state) VALUES (?, 'pA', 'a', 1, 'active')`).run(gid);
  db.query(`INSERT INTO group_members (group_id, peer_id, alias, active, member_state) VALUES (?, 'pB', 'b', 0, 'active')`).run(gid);
  // The two backfill statements from migration v12:
  db.exec(`UPDATE group_members SET member_state = 'left' WHERE active = 0`);
  db.exec(`UPDATE group_members SET member_state = 'active' WHERE active = 1`);

  const rows = db
    .query<{ active: number; member_state: string }, []>(`SELECT active, member_state FROM group_members ORDER BY peer_id`)
    .all();
  // Invariant: active=1 IFF member_state='active'.
  for (const row of rows) {
    expect(row.active === 1).toBe(row.member_state === "active");
  }
});
