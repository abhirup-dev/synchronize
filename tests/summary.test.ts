import { afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/db.ts";
import {
  defaultStrategyFromEnv,
  getCachedSummary,
  loadSummaryResponse,
  selectEvents,
  strategyFromInput,
  summarizeThread,
  type SummarizerCaller,
} from "../src/summarize/index.ts";
import { PROMPT_VERSION } from "../src/llm/index.ts";
import { createGroup, joinGroup, sendGroupMessage } from "../src/api/groups.ts";
import { registerPeer } from "../src/api/peers.ts";
import { getThreadSummary, postThreadSummary } from "../src/api/threads.ts";
import type { ClientConfig } from "../src/client.ts";

const homes: string[] = [];

afterAll(async () => {
  await Promise.all(homes.map((home) => rm(home, { recursive: true, force: true })));
});

// ─── Unit: strategy parsing ───────────────────────────────────────────────

describe("strategyFromInput", () => {
  test("defaults to first_k(3) when nothing supplied", () => {
    expect(strategyFromInput({})).toEqual({ strategy: "first_k", params: { k: 3 } });
  });

  test("respects explicit first_k k", () => {
    expect(strategyFromInput({ strategy: "first_k", k: 7 })).toEqual({
      strategy: "first_k",
      params: { k: 7 },
    });
  });

  test("first_last uses provided first_k/last_k", () => {
    expect(strategyFromInput({ strategy: "first_last", first_k: 2, last_k: 4 })).toEqual({
      strategy: "first_last",
      params: { first_k: 2, last_k: 4 },
    });
  });

  test("all carries no params", () => {
    expect(strategyFromInput({ strategy: "all" })).toEqual({ strategy: "all", params: {} });
  });
});

describe("defaultStrategyFromEnv", () => {
  test("falls back to first_k(3) with no env", () => {
    expect(defaultStrategyFromEnv({})).toEqual({ strategy: "first_k", params: { k: 3 } });
  });

  test("reads SYNCHRONIZE_SUMMARY_STRATEGY=first_last with first/last knobs", () => {
    expect(
      defaultStrategyFromEnv({
        SYNCHRONIZE_SUMMARY_STRATEGY: "first_last",
        SYNCHRONIZE_SUMMARY_FIRST_K: "2",
        SYNCHRONIZE_SUMMARY_LAST_K: "5",
      }),
    ).toEqual({ strategy: "first_last", params: { first_k: 2, last_k: 5 } });
  });

  test("invalid SYNCHRONIZE_SUMMARY_K falls back to default", () => {
    expect(defaultStrategyFromEnv({ SYNCHRONIZE_SUMMARY_K: "not-a-number" })).toEqual({
      strategy: "first_k",
      params: { k: 3 },
    });
  });
});

// ─── Unit: selectEvents shapes ────────────────────────────────────────────

interface FakeEvent {
  event_id: number;
  sender_peer_id: string | null;
  body: string | null;
  parent_event_id: number | null;
  reply_to_event_id: number | null;
  created_at: string;
}

function evt(id: number, parent: number | null = null): FakeEvent {
  return {
    event_id: id,
    sender_peer_id: `peer-${id}`,
    body: `body-${id}`,
    parent_event_id: parent,
    reply_to_event_id: parent,
    created_at: `2026-05-31T00:00:${String(id).padStart(2, "0")}Z`,
  };
}

describe("selectEvents", () => {
  // Root + 5 replies, ids 1..6.
  const events: FakeEvent[] = [
    evt(1),
    evt(2, 1),
    evt(3, 1),
    evt(4, 1),
    evt(5, 1),
    evt(6, 1),
  ];

  test("all returns every event", () => {
    expect(selectEvents(events as never, { strategy: "all", params: {} }).map((e) => e.event_id)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
  });

  test("first_k includes root and first K replies", () => {
    expect(
      selectEvents(events as never, { strategy: "first_k", params: { k: 2 } }).map((e) => e.event_id),
    ).toEqual([1, 2, 3]);
  });

  test("last_k includes root and last K replies", () => {
    expect(
      selectEvents(events as never, { strategy: "last_k", params: { k: 2 } }).map((e) => e.event_id),
    ).toEqual([1, 5, 6]);
  });

  test("first_last includes root + first first_k + last last_k, deduped", () => {
    expect(
      selectEvents(events as never, { strategy: "first_last", params: { first_k: 2, last_k: 2 } }).map((e) => e.event_id),
    ).toEqual([1, 2, 3, 5, 6]);
  });

  test("first_last collapses when overlap covers all replies", () => {
    expect(
      selectEvents(events as never, { strategy: "first_last", params: { first_k: 4, last_k: 4 } }).map((e) => e.event_id),
    ).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test("empty input returns empty", () => {
    expect(selectEvents([] as never, { strategy: "all", params: {} })).toEqual([]);
  });
});

// ─── Unit: summarizeThread + loadSummaryResponse (no daemon, no LLM) ─────

async function seedMiniDb(home: string): Promise<{ db: Database; root: number; lastReply: number }> {
  const { db } = await openDatabase(join(home, "synchronize.db"));
  // Minimal fixture: one group, two peers, root + 2 replies.
  db.exec(`
    INSERT INTO groups (group_id, name, media_dir) VALUES (1, 'g', '/tmp/g-media');
    INSERT INTO peers (peer_id, tool, session_name, machine_id, lease_expires_at)
      VALUES ('p1', 'codex', 'alice', 'm', '2099-01-01T00:00:00Z'),
             ('p2', 'claude', 'bob',   'm', '2099-01-01T00:00:00Z');
    INSERT INTO group_members (group_id, peer_id, alias) VALUES (1, 'p1', 'alice'), (1, 'p2', 'bob');
    INSERT INTO events (type, sender_peer_id, group_id, body, parent_event_id, created_at)
      VALUES ('group_message', 'p1', 1, 'kick-off question', NULL, '2026-05-31T01:00:00Z');
    INSERT INTO events (type, sender_peer_id, group_id, body, parent_event_id, created_at)
      VALUES ('group_message', 'p2', 1, 'first reply',  1, '2026-05-31T01:01:00Z');
    INSERT INTO events (type, sender_peer_id, group_id, body, parent_event_id, created_at)
      VALUES ('group_message', 'p1', 1, 'second reply', 1, '2026-05-31T01:02:00Z');
  `);
  return { db, root: 1, lastReply: 3 };
}

function stubCaller(text: string): SummarizerCaller {
  return async () => ({
    text,
    model: "stub:fake-model",
    inputTokens: 1,
    outputTokens: 1,
    elapsedMs: 1,
  });
}

describe("summarizeThread + loadSummaryResponse", () => {
  test("writes a row with the LLM result; subsequent read is ready and not stale", async () => {
    const home = await mkdtemp(join(tmpdir(), "synchronize-summarize-unit-"));
    homes.push(home);
    const { db, root, lastReply } = await seedMiniDb(home);

    const before = loadSummaryResponse(db, root, true);
    expect(before.status).toBe("pending");
    expect(before.summary).toBeNull();

    const row = await summarizeThread(db, stubCaller("a one-line summary"), root);
    expect(row.summary).toBe("a one-line summary");
    expect(row.model).toBe("stub:fake-model");
    expect(row.prompt_version).toBe(PROMPT_VERSION);
    expect(row.covered_last_event_id).toBe(lastReply);
    expect(row.covered_event_count).toBe(3);

    const after = loadSummaryResponse(db, root, true);
    expect(after.status).toBe("ready");
    expect(after.summary).toBe("a one-line summary");
    expect(after.stale).toBe(false);
    db.close();
  });

  test("disabled => loadSummaryResponse reports disabled regardless of row presence", async () => {
    const home = await mkdtemp(join(tmpdir(), "synchronize-summarize-disabled-"));
    homes.push(home);
    const { db, root } = await seedMiniDb(home);
    await summarizeThread(db, stubCaller("cached"), root);
    const r = loadSummaryResponse(db, root, false);
    expect(r.status).toBe("disabled");
    expect(r.summary).toBeNull();
    db.close();
  });

  test("LWW: re-summarizing with a different strategy overwrites the row", async () => {
    const home = await mkdtemp(join(tmpdir(), "synchronize-summarize-lww-"));
    homes.push(home);
    const { db, root } = await seedMiniDb(home);
    await summarizeThread(db, stubCaller("first pass"), root, {
      strategy: { strategy: "first_k", params: { k: 3 } },
    });
    await summarizeThread(db, stubCaller("second pass"), root, {
      strategy: { strategy: "all", params: {} },
    });
    const row = getCachedSummary(db, root)!;
    expect(row.summary).toBe("second pass");
    expect(row.strategy).toBe("all");
    expect(JSON.parse(row.strategy_params_json)).toEqual({});
    db.close();
  });

  test("staleness: adding a new reply marks the cached row stale", async () => {
    const home = await mkdtemp(join(tmpdir(), "synchronize-summarize-stale-"));
    homes.push(home);
    const { db, root } = await seedMiniDb(home);
    await summarizeThread(db, stubCaller("v1"), root);
    expect(loadSummaryResponse(db, root, true).stale).toBe(false);

    db.exec(`
      INSERT INTO events (type, sender_peer_id, group_id, body, parent_event_id, created_at)
        VALUES ('group_message', 'p2', 1, 'late reply', 1, '2026-05-31T02:00:00Z');
    `);
    expect(loadSummaryResponse(db, root, true).stale).toBe(true);
    db.close();
  });

  test("staleness: prompt_version bump invalidates the cache", async () => {
    const home = await mkdtemp(join(tmpdir(), "synchronize-summarize-promptver-"));
    homes.push(home);
    const { db, root } = await seedMiniDb(home);
    await summarizeThread(db, stubCaller("v1"), root);
    // Simulate "this row was written under an older prompt".
    db.exec(`UPDATE thread_summaries SET prompt_version = 0 WHERE root_event_id = ${root}`);
    expect(loadSummaryResponse(db, root, true).stale).toBe(true);
    db.close();
  });

  test("staleness: strategy changes invalidate the cache", async () => {
    const home = await mkdtemp(join(tmpdir(), "synchronize-summarize-strategy-"));
    homes.push(home);
    const { db, root } = await seedMiniDb(home);
    await summarizeThread(db, stubCaller("v1"), root);
    expect(loadSummaryResponse(db, root, true, { strategy: "first_k", params: { k: 3 } }).stale).toBe(false);
    expect(loadSummaryResponse(db, root, true, { strategy: "all", params: {} }).stale).toBe(true);
    db.close();
  });

  test("empty summary throws (worker treats it as a failure and backs off)", async () => {
    const home = await mkdtemp(join(tmpdir(), "synchronize-summarize-empty-"));
    homes.push(home);
    const { db, root } = await seedMiniDb(home);
    await expect(summarizeThread(db, stubCaller("   "), root)).rejects.toThrow(/empty summary/);
    expect(getCachedSummary(db, root)).toBeNull();
    db.close();
  });
});

// ─── Integration: routes (no LLM path) ────────────────────────────────────
//
// Tests that don't need a real provider — they verify the disabled/pending/503
// paths over real HTTP through a spawned daemon. The actual LLM-calling paths
// are covered by the unit tests above (with the stub caller) and by the live
// smoke test gated behind SYNCHRONIZE_SUMMARY_LIVE_TEST.

async function startDaemon(
  home: string,
  env: Record<string, string> = {},
): Promise<{ client: ClientConfig; stop: () => Promise<void> }> {
  const proc = Bun.spawn({
    cmd: [process.execPath, "run", "src/daemon.ts"],
    env: { ...process.env, SYNCHRONIZE_HOME: home, SYNCHRONIZE_PORT: "0", ...env },
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

async function seedThread(client: ClientConfig): Promise<number> {
  const alice = await registerPeer(client, { sessionName: "alice", tool: "codex" });
  const bob = await registerPeer(client, { sessionName: "bob", tool: "claude" });
  await createGroup(client, { name: "g", creatorPeerId: alice.peer.peer_id });
  await joinGroup(client, { name: "g", peerId: alice.peer.peer_id, alias: "alice" });
  await joinGroup(client, { name: "g", peerId: bob.peer.peer_id, alias: "bob" });
  const root = await sendGroupMessage(client, {
    name: "g",
    senderPeerId: alice.peer.peer_id,
    message: "kickoff",
  });
  await sendGroupMessage(client, {
    name: "g",
    senderPeerId: bob.peer.peer_id,
    message: "ack",
    inReplyTo: root.event.event_id,
  });
  return root.event.event_id;
}

// Bun.spawn inherits the parent env. Make sure OPENROUTER_API_KEY is unset
// in the env we pass so the daemon stays in disabled mode for these tests.
function disabledEnv(): Record<string, string> {
  return { OPENROUTER_API_KEY: "" };
}

test("GET /threads/:id/summary returns disabled when no provider key is set", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-summary-disabled-"));
  homes.push(home);
  const daemon = await startDaemon(home, disabledEnv());
  try {
    const root = await seedThread(daemon.client);
    const response = await getThreadSummary(daemon.client, root);
    expect(response.status).toBe("disabled");
    expect(response.summary).toBeNull();
    expect(response.stale).toBe(false);
  } finally {
    await daemon.stop();
  }
});

test("POST /threads/:id/summary returns 503 when no provider key is set", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-summary-503-"));
  homes.push(home);
  const daemon = await startDaemon(home, disabledEnv());
  try {
    const root = await seedThread(daemon.client);
    let captured: { status: number; code: string } | null = null;
    try {
      await postThreadSummary(daemon.client, { rootEventId: root, strategy: "all" });
    } catch (err) {
      const e = err as { status: number; code: string };
      captured = { status: e.status, code: e.code };
    }
    expect(captured?.status).toBe(503);
    expect(captured?.code).toBe("summarize_disabled");
  } finally {
    await daemon.stop();
  }
});

test("GET returns pending when feature is on but no row has been written", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-summary-pending-"));
  homes.push(home);
  // Set a key value, but disable the worker by making the poll interval huge
  // so the test doesn't race against a background tick.
  const daemon = await startDaemon(home, {
    OPENROUTER_API_KEY: "test-key-not-used",
    SYNCHRONIZE_SUMMARY_POLL_INTERVAL_MS: "3600000",
  });
  try {
    const root = await seedThread(daemon.client);
    const response = await getThreadSummary(daemon.client, root);
    expect(response.status).toBe("pending");
    expect(response.summary).toBeNull();
  } finally {
    await daemon.stop();
  }
});

// ─── Optional live smoke test (real OpenRouter call) ─────────────────────
// Gated behind SYNCHRONIZE_SUMMARY_LIVE_TEST=1 + a real OPENROUTER_API_KEY so
// the default suite never makes a network call. Useful for verifying provider
// wiring after a model/SDK bump.

const liveTest =
  process.env.SYNCHRONIZE_SUMMARY_LIVE_TEST === "1" && (process.env.OPENROUTER_API_KEY ?? "").length > 10
    ? test
    : test.skip;

liveTest("live: POST writes a real summary, GET serves it cached", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-summary-live-"));
  homes.push(home);
  const daemon = await startDaemon(home, { SYNCHRONIZE_SUMMARY_POLL_INTERVAL_MS: "3600000" });
  try {
    const root = await seedThread(daemon.client);
    const fresh = await postThreadSummary(daemon.client, { rootEventId: root, strategy: "first_k", k: 3 });
    expect(fresh.status).toBe("ready");
    expect(fresh.summary?.length ?? 0).toBeGreaterThan(0);
    const cached = await getThreadSummary(daemon.client, root);
    expect(cached.summary).toBe(fresh.summary);
  } finally {
    await daemon.stop();
  }
});
