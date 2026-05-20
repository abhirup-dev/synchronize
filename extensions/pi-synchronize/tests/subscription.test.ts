import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PiEventSubscription } from "../src/subscription.ts";
import type { Event } from "../src/client.ts";
import { formatExternalEvent, mapEventToDelivery } from "../src/delivery.ts";

const homes: string[] = [];

afterAll(async () => {
  await Promise.all(homes.map((home) => rm(home, { recursive: true, force: true })));
});

async function startDaemon(home: string): Promise<{ baseUrl: string; stop: () => Promise<void> }> {
  const proc = Bun.spawn({
    cmd: [process.execPath, "run", "src/daemon.ts"],
    env: { ...process.env, SYNCHRONIZE_HOME: home, SYNCHRONIZE_PORT: "0" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const discoveryPath = join(home, "daemon.json");
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const discovery = await Bun.file(discoveryPath).json();
      const health = await fetch(`${discovery.baseUrl}/health`).catch(() => null);
      if (health?.ok) {
        return {
          baseUrl: discovery.baseUrl,
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

async function json<T>(baseUrl: string, path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const body = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(body));
  return body as T;
}

test("PiEventSubscription receives a DM pushed by the daemon and invokes onEvent", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-pi-"));
  homes.push(home);
  const daemon = await startDaemon(home);

  try {
    const alice = await json<{ peer: { peer_id: string } }>(daemon.baseUrl, "/peers/register", {
      method: "POST",
      body: JSON.stringify({ session_name: "alice", tool: "codex" }),
    });
    const pi = await json<{ peer: { peer_id: string } }>(daemon.baseUrl, "/peers/register", {
      method: "POST",
      body: JSON.stringify({ session_name: "pi-test", tool: "pi" }),
    });

    const received: Event[] = [];
    const sub = new PiEventSubscription({
      peerId: pi.peer.peer_id,
      client: { baseUrl: daemon.baseUrl, token: null },
      onEvent: async (event) => {
        received.push(event);
      },
    });
    await sub.start();

    await json(daemon.baseUrl, "/dm", {
      method: "POST",
      body: JSON.stringify({
        sender_peer_id: alice.peer.peer_id,
        recipient_peer_id: pi.peer.peer_id,
        message: "tests failed, please look",
      }),
    });

    const deadline = Date.now() + 2_000;
    while (received.length < 1 && Date.now() < deadline) await Bun.sleep(20);
    sub.stop();

    expect(received).toHaveLength(1);
    expect(received[0]?.body).toBe("tests failed, please look");
    expect(received[0]?.type).toBe("dm");
  } finally {
    await daemon.stop();
  }
});

test("formatExternalEvent wraps body in <synchronize_event> with attributes", () => {
  const event: Event = {
    event_id: 42,
    type: "dm",
    sender_peer_id: "peer-a",
    recipient_peer_id: "peer-b",
    group_id: null,
    body: "/help me out",
    media_id: null,
    created_at: "2026-05-21T10:00:00.000Z",
  };
  const wrapped = formatExternalEvent(event);
  expect(wrapped.startsWith("<synchronize_event ")).toBe(true);
  expect(wrapped).toContain('type="dm"');
  expect(wrapped).toContain('event_id="42"');
  expect(wrapped).toContain('from="peer-a"');
  expect(wrapped).toContain("/help me out");
  expect(wrapped.endsWith("</synchronize_event>")).toBe(true);
});

test("mapEventToDelivery returns undefined when idle, steer when streaming on DM", () => {
  const event: Event = {
    event_id: 1,
    type: "dm",
    sender_peer_id: "a",
    recipient_peer_id: "b",
    group_id: null,
    body: "hi",
    media_id: null,
    created_at: new Date().toISOString(),
  };
  expect(mapEventToDelivery(event, { isIdle: () => true })).toBeUndefined();
  expect(mapEventToDelivery(event, { isIdle: () => false })).toBe("steer");
  expect(mapEventToDelivery({ ...event, type: "media_shared" }, { isIdle: () => false })).toBe("followUp");
});
