import { afterEach, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { registerPeer } from "../src/api/peers.ts";
import { startDaemon, type TestDaemon } from "./support/daemon.ts";

// Per-peer web composer drafts (web_drafts, schema v16) — PUT/GET roundtrip,
// thread-key separation, empty-body delete, peer scoping, and the `drafts` SSE
// domain. See docs/plans/web-multi-tab-popout-v0.md.

const homes: string[] = [];

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

async function daemon(): Promise<TestDaemon> {
  const started = await startDaemon();
  homes.push(started.home);
  return started;
}

interface DraftRow {
  room_id: string;
  thread_parent_id: string;
  body: string;
  updated_at: string;
}

async function putDraft(d: TestDaemon, input: Record<string, unknown>): Promise<Response> {
  return fetch(`${d.baseUrl}/web/drafts`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

async function getDrafts(d: TestDaemon, peerId: string): Promise<DraftRow[]> {
  const response = await fetch(`${d.baseUrl}/web/drafts?peer_id=${encodeURIComponent(peerId)}`);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { drafts: DraftRow[] };
  return body.drafts;
}

test("drafts roundtrip per peer: thread keys are separate, empty body deletes, body is untrimmed", async () => {
  const d = await daemon();
  try {
    const alice = (await registerPeer(d.client, { sessionName: "alice", tool: "cli" })).peer;
    const bob = (await registerPeer(d.client, { sessionName: "bob", tool: "cli" })).peer;

    // Main-room draft — whitespace preserved verbatim (mid-composition text).
    const raw = "  draft with trailing newline\n";
    expect((await putDraft(d, { peer_id: alice.peer_id, room_id: "group:1", body: raw })).status).toBe(200);
    // Thread composer draft in the same room — separate key, no clobber.
    expect((await putDraft(d, { peer_id: alice.peer_id, room_id: "group:1", thread_parent_id: "e:5", body: "thread reply" })).status).toBe(200);

    let drafts = await getDrafts(d, alice.peer_id);
    expect(drafts).toHaveLength(2);
    expect(drafts.find((row) => row.thread_parent_id === "")?.body).toBe(raw);
    expect(drafts.find((row) => row.thread_parent_id === "e:5")?.body).toBe("thread reply");

    // Peer scoping: bob sees none of alice's drafts.
    expect(await getDrafts(d, bob.peer_id)).toHaveLength(0);

    // Overwrite updates in place.
    expect((await putDraft(d, { peer_id: alice.peer_id, room_id: "group:1", body: "rewritten" })).status).toBe(200);
    drafts = await getDrafts(d, alice.peer_id);
    expect(drafts.find((row) => row.thread_parent_id === "")?.body).toBe("rewritten");

    // Empty body deletes the row; the thread draft survives.
    expect((await putDraft(d, { peer_id: alice.peer_id, room_id: "group:1", body: "" })).status).toBe(200);
    drafts = await getDrafts(d, alice.peer_id);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.thread_parent_id).toBe("e:5");

    // Non-string body is rejected.
    expect((await putDraft(d, { peer_id: alice.peer_id, room_id: "group:1", body: 42 })).status).toBe(400);
  } finally {
    await d.stop();
  }
});

test("draft writes broadcast the drafts SSE domain without room invalidation", async () => {
  const d = await daemon();
  try {
    const alice = (await registerPeer(d.client, { sessionName: "alice", tool: "cli" })).peer;
    const stream = await fetch(`${d.baseUrl}/web/events`);
    const reader = stream.body!.getReader();
    const decoder = new TextDecoder();
    expect(decoder.decode((await reader.read()).value)).toContain("event: connected");

    expect((await putDraft(d, { peer_id: alice.peer_id, room_id: "group:1", body: "hello" })).status).toBe(200);

    let buffer = "";
    while (!buffer.includes("\n\n")) buffer += decoder.decode((await reader.read()).value);
    expect(buffer).toContain('"type":"state_changed"');
    expect(buffer).toContain('"domains":["drafts"]');
    expect(buffer).toContain(`"peer_id":"${alice.peer_id}"`);
    await reader.cancel();
  } finally {
    await d.stop();
  }
});
