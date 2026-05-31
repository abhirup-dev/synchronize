import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/db.ts";
import {
  appendLaunchEvent,
  claimNextLaunchWork,
  completeLaunchWork,
  createLaunchIntent,
  enqueueLaunchWork,
  failLaunchWork,
  getLaunchIntent,
  getLaunchIntentByPeer,
  getLaunchWorkByIdempotencyKey,
  listLaunchEvents,
  listLaunchWork,
  updateLaunchState,
} from "../src/launch/store.ts";

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function dbHarness() {
  const dir = await mkdtemp(join(tmpdir(), "sync-launch-store-"));
  dirs.push(dir);
  return openDatabase(join(dir, "synchronize.db"));
}

test("openDatabase creates durable launch lifecycle tables idempotently", async () => {
  const { db, path } = await dbHarness();
  const tables = db
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'launch_%' ORDER BY name")
    .all()
    .map((row) => row.name);
  expect(tables).toEqual(["launch_events", "launch_intents", "launch_work"]);
  expect(db.query<{ version: number }, []>("SELECT version FROM schema_migrations WHERE version = 6").get()?.version).toBe(6);
  db.close();

  const reopened = await openDatabase(path);
  expect(reopened.db.query<{ version: number }, []>("SELECT version FROM schema_migrations WHERE version = 6").get()?.version).toBe(6);
  reopened.db.close();
});

test("launch store inserts intent, appends events, and updates state timestamps", async () => {
  const { db } = await dbHarness();
  const acceptedAt = "2026-05-31T00:00:00.000Z";
  const intent = createLaunchIntent(db, {
    launchId: "launch-1",
    peerId: "peer-1",
    tool: "claude",
    sessionName: "alice",
    alias: "alice",
    cwd: "/repo",
    targetGroup: "release-checks",
    model: "claude-haiku-4-5-20251001",
    thinking: "high",
    args: ["--foo"],
    backend: "local_aoe",
    backendProfile: "synchronize-test",
    backendTitle: "abc12345-alice",
    now: acceptedAt,
  });

  expect(intent).toMatchObject({
    launch_id: "launch-1",
    peer_id: "peer-1",
    tool: "claude",
    state: "accepted",
    target_group: "release-checks",
    backend_title: "abc12345-alice",
    accepted_at: acceptedAt,
  });
  expect(intent.args_json).toBe(JSON.stringify(["--foo"]));
  expect(getLaunchIntent(db, "launch-1")?.backend_profile).toBe("synchronize-test");
  expect(getLaunchIntentByPeer(db, "peer-1")?.launch_id).toBe("launch-1");

  const event = appendLaunchEvent(db, {
    launchId: "launch-1",
    kind: "launch.accepted",
    toState: "accepted",
    payload: { source: "test" },
    createdAt: acceptedAt,
  });
  expect(event.event_id).toBeGreaterThan(0);
  expect(event.payload_json).toBe(JSON.stringify({ source: "test" }));

  const registeredAt = "2026-05-31T00:00:01.000Z";
  const registered = updateLaunchState(db, {
    launchId: "launch-1",
    fromState: "accepted",
    state: "registered",
    eventKind: "registered",
    payload: { hostSessionId: "host-1" },
    now: registeredAt,
  });
  expect(registered.state).toBe("registered");
  expect(registered.registered_at).toBe(registeredAt);
  expect(registered.updated_at).toBe(registeredAt);

  const events = listLaunchEvents(db, "launch-1");
  expect(events.map((row) => row.kind)).toEqual(["launch.accepted", "registered"]);
  expect(events[1]?.from_state).toBe("accepted");
  expect(events[1]?.to_state).toBe("registered");
});

test("launch store records failure metadata and leaves joined_at untouched when running is observed", async () => {
  const { db } = await dbHarness();
  createLaunchIntent(db, {
    launchId: "launch-fail",
    peerId: "peer-fail",
    tool: "claude",
    sessionName: "fail",
    alias: "fail",
    cwd: "/repo",
    backend: "local_aoe",
    backendTitle: "abc12345-fail",
    now: "2026-05-31T00:00:00.000Z",
  });

  const failed = updateLaunchState(db, {
    launchId: "launch-fail",
    fromState: "accepted",
    state: "failed",
    eventKind: "spawn_failed",
    failureCode: "spawn_failed",
    failureMessage: "aoe add failed",
    now: "2026-05-31T00:00:01.000Z",
  });
  expect(failed).toMatchObject({
    state: "failed",
    failure_code: "spawn_failed",
    failure_message: "aoe add failed",
    failed_at: "2026-05-31T00:00:01.000Z",
  });

  createLaunchIntent(db, {
    launchId: "launch-running",
    peerId: "peer-running",
    tool: "pi",
    sessionName: "runner",
    alias: "runner",
    cwd: "/repo",
    backend: "local_aoe",
    backendTitle: "abc12345-run",
    now: "2026-05-31T00:00:00.000Z",
  });
  const running = updateLaunchState(db, {
    launchId: "launch-running",
    fromState: "joined",
    state: "running",
    eventKind: "running_observed",
    now: "2026-05-31T00:00:02.000Z",
  });
  expect(running.state).toBe("running");
  expect(running.joined_at).toBeNull();
  expect(running.updated_at).toBe("2026-05-31T00:00:02.000Z");
});

test("launch work queue enqueues idempotently, claims by lease, completes, and retries", async () => {
  const { db } = await dbHarness();
  createLaunchIntent(db, {
    launchId: "launch-1",
    peerId: "peer-1",
    tool: "pi",
    sessionName: "bob",
    alias: "bob",
    cwd: "/repo",
    backend: "local_aoe",
    backendTitle: "abc12345-bob",
    now: "2026-05-31T00:00:00.000Z",
  });

  const work = enqueueLaunchWork(db, {
    launchId: "launch-1",
    kind: "spawn",
    idempotencyKey: "launch-1:spawn",
    maxAttempts: 2,
    nextRunAt: "2026-05-31T00:00:00.000Z",
  });
  expect(work).toMatchObject({ status: "queued", attempts: 0, max_attempts: 2 });

  const duplicate = enqueueLaunchWork(db, {
    launchId: "launch-1",
    kind: "spawn",
    idempotencyKey: "launch-1:spawn",
    maxAttempts: 2,
    nextRunAt: "2026-05-30T23:59:59.000Z",
  });
  expect(duplicate.work_id).toBe(work.work_id);
  expect(listLaunchWork(db, "launch-1")).toHaveLength(1);

  const claimed = claimNextLaunchWork(db, {
    workerId: "worker-a",
    now: "2026-05-31T00:00:00.000Z",
    leaseExpiresAt: "2026-05-31T00:00:10.000Z",
  });
  expect(claimed).toMatchObject({ status: "running", claimed_by: "worker-a", attempts: 1 });
  expect(claimNextLaunchWork(db, {
    workerId: "worker-b",
    now: "2026-05-31T00:00:05.000Z",
    leaseExpiresAt: "2026-05-31T00:00:15.000Z",
  })).toBeNull();

  const retry = failLaunchWork(db, claimed!.work_id, {
    error: "temporary failure",
    nextRunAt: "2026-05-31T00:00:11.000Z",
    now: "2026-05-31T00:00:10.000Z",
  });
  expect(retry).toMatchObject({ status: "queued", last_error: "temporary failure", attempts: 1 });

  const claimedAgain = claimNextLaunchWork(db, {
    workerId: "worker-b",
    now: "2026-05-31T00:00:11.000Z",
    leaseExpiresAt: "2026-05-31T00:00:21.000Z",
  });
  expect(claimedAgain).toMatchObject({ status: "running", claimed_by: "worker-b", attempts: 2 });

  const done = completeLaunchWork(db, claimedAgain!.work_id, "2026-05-31T00:00:12.000Z");
  expect(done).toMatchObject({ status: "done", claimed_by: null, lease_expires_at: null, last_error: null });
  expect(getLaunchWorkByIdempotencyKey(db, "launch-1:spawn")?.status).toBe("done");
});

test("launch work queue reclaims expired running work and marks max-attempt failure", async () => {
  const { db } = await dbHarness();
  createLaunchIntent(db, {
    launchId: "launch-2",
    peerId: "peer-2",
    tool: "claude",
    sessionName: "carol",
    alias: "carol",
    cwd: "/repo",
    backend: "local_aoe",
    backendTitle: "abc12345-carol",
    now: "2026-05-31T00:00:00.000Z",
  });
  enqueueLaunchWork(db, {
    launchId: "launch-2",
    kind: "prompt_confirm",
    idempotencyKey: "launch-2:prompt",
    maxAttempts: 1,
    nextRunAt: "2026-05-31T00:00:00.000Z",
  });

  const first = claimNextLaunchWork(db, {
    workerId: "worker-a",
    now: "2026-05-31T00:00:00.000Z",
    leaseExpiresAt: "2026-05-31T00:00:02.000Z",
  });
  expect(first).toMatchObject({ status: "running", attempts: 1 });
  expect(claimNextLaunchWork(db, {
    workerId: "worker-b",
    now: "2026-05-31T00:00:03.000Z",
    leaseExpiresAt: "2026-05-31T00:00:13.000Z",
  })).toBeNull();

  const failed = failLaunchWork(db, first!.work_id, {
    error: "prompt never appeared",
    now: "2026-05-31T00:00:03.000Z",
  });
  expect(failed).toMatchObject({ status: "failed", last_error: "prompt never appeared" });
});

test("launch lifecycle rows cascade from launch_intents", async () => {
  const { db } = await dbHarness();
  createLaunchIntent(db, {
    launchId: "launch-cascade",
    peerId: "peer-cascade",
    tool: "claude",
    sessionName: "cascade",
    alias: "cascade",
    cwd: "/repo",
    backend: "local_aoe",
    backendTitle: "abc12345-cas",
    now: "2026-05-31T00:00:00.000Z",
  });
  appendLaunchEvent(db, { launchId: "launch-cascade", kind: "accepted" });
  enqueueLaunchWork(db, {
    launchId: "launch-cascade",
    kind: "spawn",
    idempotencyKey: "launch-cascade:spawn",
    nextRunAt: "2026-05-31T00:00:00.000Z",
  });

  db.query("DELETE FROM launch_intents WHERE launch_id = ?").run("launch-cascade");
  expect(listLaunchEvents(db, "launch-cascade")).toHaveLength(0);
  expect(listLaunchWork(db, "launch-cascade")).toHaveLength(0);
});
