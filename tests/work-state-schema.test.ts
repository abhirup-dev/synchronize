import { afterAll, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listPeers, registerPeer } from "../src/api/peers.ts";
import type { Peer } from "../src/api/types.ts";
import { openDatabase } from "../src/db.ts";
import { startTestDaemon } from "./helpers/daemon.ts";

const homes: string[] = [];

afterAll(async () => {
  await Promise.all(homes.map((home) => rm(home, { recursive: true, force: true })));
});

async function freshDb() {
  const dir = await mkdtemp(join(tmpdir(), "sync-work-state-schema-"));
  homes.push(dir);
  return openDatabase(join(dir, "synchronize.db"));
}

function cols(db: Database, table: string): string[] {
  return db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

async function daemonPeer(home: string, peerId: string): Promise<Peer> {
  const daemon = await startTestDaemon({ home });
  try {
    const response = await listPeers(daemon.client);
    return (response.peers as Peer[]).find((peer) => peer.peer_id === peerId)!;
  } finally {
    await daemon.stop();
  }
}

test("v16 adds current work-state columns and history indexes", async () => {
  const { db } = await freshDb();
  const peerCols = cols(db, "peers");
  expect(peerCols).toContain("work_phase");
  expect(peerCols).toContain("work_summary");
  expect(peerCols).toContain("work_scope_json");
  expect(peerCols).toContain("work_task");
  expect(peerCols).toContain("work_trigger_event_id");
  expect(peerCols).toContain("work_started_at");
  expect(peerCols).toContain("work_updated_at");
  expect(peerCols).toContain("work_expires_at");
  expect(peerCols).toContain("work_source");

  expect(cols(db, "peer_work_state_history")).toEqual([
    "history_id",
    "peer_id",
    "phase",
    "summary",
    "scope_json",
    "task",
    "trigger_event_id",
    "correlation_method",
    "source",
    "started_at",
    "updated_at",
    "expires_at",
    "cleared_at",
    "created_at",
  ]);
  const version = db.query<{ version: number }, []>("SELECT version FROM schema_migrations WHERE version = 16").get();
  expect(version?.version).toBe(16);
});

test("peer reads derive work_state only while active and unexpired", async () => {
  const home = await mkdtemp(join(tmpdir(), "sync-work-state-daemon-"));
  homes.push(home);
  const daemon = await startTestDaemon({ home });
  try {
    await registerPeer(daemon.client, { peerId: "peer-work", sessionName: "worker", tool: "claude" });
  } finally {
    await daemon.stop();
  }

  const db = new Database(join(home, "synchronize.db"));
  const startedAt = new Date(Date.now() - 1_000).toISOString();
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  db.query(
    `UPDATE peers
     SET work_phase = 'implementation',
         work_summary = 'Add work-state schema',
         work_scope_json = ?,
         work_task = 'sync-08gl.2.1',
         work_trigger_event_id = NULL,
         work_started_at = ?,
         work_updated_at = ?,
         work_expires_at = ?,
         work_source = 'api'
     WHERE peer_id = 'peer-work'`,
  ).run(JSON.stringify({ kind: "issue", value: "sync-08gl.2.1", label: "schema" }), startedAt, startedAt, expiresAt);

  const active = await daemonPeer(home, "peer-work");
  expect(active.work_state).toMatchObject({
    phase: "implementation",
    summary: "Add work-state schema",
    scope: { kind: "issue", value: "sync-08gl.2.1", label: "schema" },
    task: "sync-08gl.2.1",
    started_at: startedAt,
    updated_at: startedAt,
    expires_at: expiresAt,
    source: "api",
  });

  db.query("UPDATE peers SET work_expires_at = ? WHERE peer_id = 'peer-work'")
    .run(new Date(Date.now() - 60_000).toISOString());
  const expired = await daemonPeer(home, "peer-work");
  expect(expired.work_state).toBeNull();

  db.query("UPDATE peers SET work_expires_at = ?, lifecycle_state = 'archived' WHERE peer_id = 'peer-work'")
    .run(new Date(Date.now() + 60_000).toISOString());
  const archived = await daemonPeer(home, "peer-work");
  expect(archived.work_state).toBeNull();
  db.close();
});
