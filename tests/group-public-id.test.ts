// Migration v16: groups.public_id. The interesting cases are all about an
// EXISTING database — a fresh one is trivially correct — so these tests build a
// populated db, strip the migration back to its pre-v16 shape, and reopen.
import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newGroupPublicId, openDatabase } from "../src/db.ts";

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function freshDb() {
  const dir = await mkdtemp(join(tmpdir(), "sync-public-id-"));
  dirs.push(dir);
  const path = join(dir, "synchronize.db");
  return { handle: await openDatabase(path), path };
}

function insertGroup(db: Database, name: string): void {
  db.query(`INSERT INTO groups (name, media_dir, public_id) VALUES (?, ?, ?)`).run(name, `/tmp/${name}`, newGroupPublicId());
}

/** Rewind a populated db to its pre-v16 shape: no column, no index, no marker. */
function rewindToPreV16(db: Database): void {
  db.exec(`DROP INDEX IF EXISTS idx_groups_public_id`);
  db.exec(`ALTER TABLE groups DROP COLUMN public_id`);
  db.exec(`DELETE FROM schema_migrations WHERE version = 16`);
}

function publicIds(db: Database): Array<string | null> {
  return db
    .query<{ public_id: string | null }, []>(`SELECT public_id FROM groups ORDER BY group_id`)
    .all()
    .map((row) => row.public_id);
}

test("a populated pre-v16 database is backfilled with unique ids", async () => {
  const { handle, path } = await freshDb();
  for (const name of ["alpha", "beta", "gamma"]) insertGroup(handle.db, name);
  rewindToPreV16(handle.db);
  expect(handle.db.query<{ name: string }, []>(`PRAGMA table_info(groups)`).all().map((c) => c.name)).not.toContain("public_id");
  handle.db.close();

  const { db } = await openDatabase(path);
  const ids = publicIds(db);
  expect(ids).toHaveLength(3);
  expect(ids.every((id) => typeof id === "string" && id.startsWith("g_"))).toBe(true);
  expect(new Set(ids).size).toBe(3);
  expect(db.query<{ version: number }, []>(`SELECT version FROM schema_migrations WHERE version = 16`).get()?.version).toBe(16);
  db.close();
});

test("the backfill is re-runnable: only unset rows are assigned", async () => {
  // An interrupted migration must resume, not reassign — an already-minted
  // address may already be pasted into a message.
  const { handle, path } = await freshDb();
  for (const name of ["alpha", "beta"]) insertGroup(handle.db, name);
  const before = publicIds(handle.db);
  handle.db.exec(`UPDATE groups SET public_id = NULL WHERE name = 'beta'`);
  handle.db.exec(`DELETE FROM schema_migrations WHERE version = 16`);
  handle.db.close();

  const { db } = await openDatabase(path);
  const after = publicIds(db);
  expect(after[0]).toBe(before[0]);
  expect(after[1]).not.toBeNull();
  expect(after[1]).not.toBe(before[1]);
  db.close();
});

test("reopening an already-migrated database changes nothing", async () => {
  const { handle, path } = await freshDb();
  insertGroup(handle.db, "alpha");
  const before = publicIds(handle.db);
  handle.db.close();

  const { db } = await openDatabase(path);
  expect(publicIds(db)).toEqual(before);
  expect(db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM schema_migrations WHERE version = 16`).get()!.n).toBe(1);
  db.close();
});

test("the unique index rejects a duplicate public_id", async () => {
  const { handle } = await freshDb();
  insertGroup(handle.db, "alpha");
  const taken = publicIds(handle.db)[0]!;
  expect(() =>
    handle.db.query(`INSERT INTO groups (name, media_dir, public_id) VALUES ('beta', '/tmp/beta', ?)`).run(taken),
  ).toThrow();
});

test("ephemeral cleanup still drops durable = 0 rows", async () => {
  const { handle } = await freshDb();
  handle.db
    .query(`INSERT INTO groups (name, media_dir, durable, public_id) VALUES ('temp', '/tmp/temp', 0, ?)`)
    .run(newGroupPublicId());
  insertGroup(handle.db, "keep");
  const { pruneEphemeralGroups } = await import("../src/db.ts");
  await pruneEphemeralGroups(handle.db, async () => {});
  expect(handle.db.query<{ name: string }, []>(`SELECT name FROM groups`).all().map((r) => r.name)).toEqual(["keep"]);
});

test("ids are distinct across many mints", () => {
  const ids = new Set(Array.from({ length: 2000 }, newGroupPublicId));
  expect(ids.size).toBe(2000);
});
