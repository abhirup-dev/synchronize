import { afterEach, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { startTestDaemon, type TestDaemon } from "./helpers/daemon.ts";

const homes: string[] = [];

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

async function daemon(): Promise<TestDaemon> {
  const started = await startTestDaemon();
  homes.push(started.home);
  return started;
}

function json(body: unknown): RequestInit {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

async function post(baseUrl: string, path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, json(body));
}

async function flushPushQueue(): Promise<void> {
  await Bun.sleep(100);
}

async function readStateChange(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<Record<string, unknown>> {
  const decoder = new TextDecoder();
  let buffer = "";
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value);
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      if (!frame.includes("event: state_changed")) continue;
      const data = frame.split("\n").find((line) => line.startsWith("data: "))?.slice("data: ".length);
      if (!data) continue;
      return JSON.parse(data) as Record<string, unknown>;
    }
  }
  throw new Error("timed out waiting for state_changed SSE frame");
}

test("subscriber callback failure removes the callback before the next event", async () => {
  const d = await daemon();
  const hits: Array<{ token: string | null; body: unknown }> = [];
  const sink = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      hits.push({
        token: request.headers.get("x-synchronize-subscription-token"),
        body: await request.json().catch(() => null),
      });
      return new Response("fail", { status: 500 });
    },
  });

  try {
    await post(d.baseUrl, "/peers/register", { peer_id: "peer:alice", session_name: "alice", tool: "codex" });
    await post(d.baseUrl, "/peers/register", { peer_id: "peer:bob", session_name: "bob", tool: "codex" });
    expect((await post(d.baseUrl, "/subscriptions", {
      peer_id: "peer:bob",
      callback_url: `http://127.0.0.1:${sink.port}/callback`,
      token: "phase0-token",
    })).status).toBe(201);

    expect((await post(d.baseUrl, "/dm", { sender_peer_id: "peer:alice", recipient_peer_id: "peer:bob", message: "first" })).status).toBe(201);
    await flushPushQueue();
    expect(hits).toHaveLength(1);
    expect(hits[0]?.token).toBe("phase0-token");
    expect(hits[0]?.body).toMatchObject({ event: { body: "first", recipient_peer_id: "peer:bob" } });

    expect((await post(d.baseUrl, "/dm", { sender_peer_id: "peer:alice", recipient_peer_id: "peer:bob", message: "second" })).status).toBe(201);
    await flushPushQueue();
    expect(hits).toHaveLength(1);
  } finally {
    sink.stop(true);
    await d.stop();
  }
});

test("/web/events sends connected and cancellation does not retain a dead writer", async () => {
  const d = await daemon();
  try {
    const stream = await fetch(`${d.baseUrl}/web/events`);
    expect(stream.status).toBe(200);
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    expect(stream.body).not.toBeNull();

    const reader = stream.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain('event: connected\ndata: {"cursor":0,"type":"connected","domains":[]}');
    await reader.cancel();

    // Characterizes the current cleanup path: after the reader is cancelled,
    // later web-state fanout must not throw, wedge the daemon, or block fresh
    // SSE clients from connecting.
    expect((await post(d.baseUrl, "/peers/register", { peer_id: "peer:sse", session_name: "sse", tool: "codex" })).status).toBe(201);
    expect((await fetch(`${d.baseUrl}/health`)).status).toBe(200);

    const nextStream = await fetch(`${d.baseUrl}/web/events`);
    const nextReader = nextStream.body!.getReader();
    const nextFirst = await nextReader.read();
    expect(new TextDecoder().decode(nextFirst.value)).toContain("event: connected");
    await nextReader.cancel();
  } finally {
    await d.stop();
  }
});

test("/web/events emits granular peer presence and work-state domains with agent payloads", async () => {
  const d = await daemon();
  try {
    expect((await post(d.baseUrl, "/peers/register", { peer_id: "peer:delta", session_name: "delta", tool: "claude" })).status).toBe(201);
    const stream = await fetch(`${d.baseUrl}/web/events`);
    const reader = stream.body!.getReader();
    await reader.read(); // connected frame

    expect((await fetch(`${d.baseUrl}/peers/peer%3Adelta/heartbeat`, { method: "PATCH" })).status).toBe(200);
    const heartbeat = await readStateChange(reader);
    expect(heartbeat.domains).toEqual(["peer_presence"]);
    expect(heartbeat.peer_id).toBe("peer:delta");
    expect(heartbeat.agent).toMatchObject({ peer_id: "peer:delta", work_state_status: { state: "absent" } });

    expect((await post(d.baseUrl, "/peers/work-state", {
      peer_id: "peer:delta",
      phase: "testing",
      summary: "Verify granular SSE",
      ttl_minutes: 1,
    })).status).toBe(200);
    const workState = await readStateChange(reader);
    expect(workState.domains).toEqual(["work_state"]);
    expect(workState.agent).toMatchObject({ peer_id: "peer:delta", work_state: { phase: "testing" } });

    expect((await post(d.baseUrl, "/peers/activity", { peer_id: "peer:delta", state: "idle" })).status).toBe(200);
    const activity = await readStateChange(reader);
    expect(activity.domains).toEqual(["peer_presence"]);
    expect(activity.agent).toMatchObject({ peer_id: "peer:delta", presence: "idle" });
    await reader.cancel();
  } finally {
    await d.stop();
  }
});
