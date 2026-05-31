import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NotificationBridge } from "../src/mcp/codex-notifier.ts";
import { emitMcpNotification } from "../src/mcp/notifications.ts";
import type { ClientConfig } from "../src/client.ts";

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

test("MCP notification emitter uses Codex standard notifications/message and Claude channel method", async () => {
  const event = {
    event_id: 1,
    type: "dm",
    sender_peer_id: "a",
    recipient_peer_id: "b",
    group_id: null,
    body: "hello",
    media_id: null,
    parent_event_id: null,
    mentions_json: null,
    created_at: new Date().toISOString(),
  };
  const calls: unknown[] = [];
  const sink = {
    notification: async (notification: unknown) => {
      calls.push(notification);
    },
    sendLoggingMessage: async (params: unknown) => {
      calls.push({ method: "notifications/message", params });
    },
  };

  await emitMcpNotification(sink, "codex", event);
  await emitMcpNotification(sink, "claude", event);

  expect(calls).toEqual([
    expect.objectContaining({ method: "notifications/message" }),
    expect.objectContaining({
      method: "notifications/claude/channel",
      params: expect.objectContaining({
        content: "hello",
        meta: expect.objectContaining({ event_id: "1", type: "dm", from_id: "a", sent_at: event.created_at }),
      }),
    }),
  ]);
  const claudeCall = calls[1] as { params: { meta: Record<string, unknown> } };
  expect(claudeCall.params.meta).not.toHaveProperty("source");
  expect(Object.values(claudeCall.params.meta).every((value) => typeof value === "string")).toBe(true);
});

test("Codex NotificationBridge polls one peer event stream and keeps a bounded buffer", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-mcp-"));
  homes.push(home);
  const daemon = await startDaemon(home);

  try {
    const alice = await json<{ peer: { peer_id: string } }>(daemon.baseUrl, "/peers/register", {
      method: "POST",
      body: JSON.stringify({ session_name: "alice", tool: "codex" }),
    });
    const bob = await json<{ peer: { peer_id: string } }>(daemon.baseUrl, "/peers/register", {
      method: "POST",
      body: JSON.stringify({ session_name: "bob", tool: "codex" }),
    });
    const emitted: unknown[] = [];
    const bridge = new NotificationBridge({
      peerId: bob.peer.peer_id,
      mode: "codex",
      client: { baseUrl: daemon.baseUrl, token: null, paths: {} as ClientConfig["paths"], started: false },
      limit: 2,
      activeMs: 10,
      idleMs: 10,
      emit: async (_mode, event) => {
        emitted.push(event);
      },
    });
    bridge.start();

    for (const message of ["one", "two", "three"]) {
      await json(daemon.baseUrl, "/dm", {
        method: "POST",
        body: JSON.stringify({
          sender_peer_id: alice.peer.peer_id,
          recipient_peer_id: bob.peer.peer_id,
          message,
        }),
      });
    }

    const deadline = Date.now() + 2_000;
    while (emitted.length < 3 && Date.now() < deadline) await Bun.sleep(20);
    bridge.stop();

    expect(emitted).toHaveLength(3);
    expect(bridge.buffer.map((event) => event.body)).toEqual(["two", "three"]);
  } finally {
    await daemon.stop();
  }
});
