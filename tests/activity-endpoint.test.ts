// Real-daemon coverage for GET /activity/:peerId — the observer feed. Exercises
// the actual SQL against SQLite (the stubbed-fetch web tests can't): the
// events LEFT JOIN inbox, the computed `awaiting` boolean, and — critically —
// the DM-visibility clause that must keep private agent↔agent DMs out of the
// observer's feed.

import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
        return { baseUrl: discovery.baseUrl, stop: async () => { proc.kill(); await proc.exited; } };
      }
    } catch {
      await Bun.sleep(50);
    }
  }
  proc.kill();
  await proc.exited;
  throw new Error("daemon did not start");
}

async function json<T>(baseUrl: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) throw new Error(`${init?.method ?? "GET"} ${path} -> ${response.status}`);
  return (await response.json()) as T;
}

interface ActivityEvent {
  event_id: number;
  type: string;
  body: string | null;
  group_id: number | null;
  awaiting: number;
}

test("GET /activity is an observer feed: group events + awaiting, no private DM leak", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-activity-"));
  homes.push(home);
  const daemon = await startDaemon(home);
  try {
    // The human's web peer (constant id, observer).
    const web = await json<{ peer: { peer_id: string } }>(daemon.baseUrl, "/web/session", { method: "POST" });
    const me = web.peer.peer_id;

    const reg = (name: string, tool: string) =>
      json<{ peer: { peer_id: string } }>(daemon.baseUrl, "/peers/register", {
        method: "POST",
        body: JSON.stringify({ session_name: name, tool }),
      });
    const alice = await reg("alice", "codex");
    const bob = await reg("bob", "claude");

    await json(daemon.baseUrl, "/groups", {
      method: "POST",
      body: JSON.stringify({ name: "room", creator_peer_id: alice.peer.peer_id }),
    });
    // Web human joins as "you" so it receives inbox fanout (awaiting source).
    await json(daemon.baseUrl, "/groups/room/join", {
      method: "POST",
      body: JSON.stringify({ peer_id: me, alias: "you" }),
    });
    await json(daemon.baseUrl, "/groups/room/join", {
      method: "POST",
      body: JSON.stringify({ peer_id: alice.peer.peer_id, alias: "alice" }),
    });
    await json(daemon.baseUrl, "/groups/room/join", {
      method: "POST",
      body: JSON.stringify({ peer_id: bob.peer.peer_id, alias: "bob" }),
    });

    // alice: a plain message and an @you mention in the group.
    await json(daemon.baseUrl, "/groups/room/messages", {
      method: "POST",
      body: JSON.stringify({ sender_peer_id: alice.peer.peer_id, message: "status update for the room" }),
    });
    await json(daemon.baseUrl, "/groups/room/messages", {
      method: "POST",
      body: JSON.stringify({ sender_peer_id: alice.peer.peer_id, message: "@you can you review this?" }),
    });

    // A PRIVATE DM between two other agents — must never reach the observer.
    const secret = await json<{ event: { event_id: number } }>(daemon.baseUrl, "/dm", {
      method: "POST",
      body: JSON.stringify({ sender_peer_id: alice.peer.peer_id, recipient_peer_id: bob.peer.peer_id, message: "private alice->bob" }),
    });

    const feed = await json<{ events: ActivityEvent[]; awaiting_count: number; peers: Array<{ peer_id: string }> }>(
      daemon.baseUrl,
      `/activity/${encodeURIComponent(me)}`,
    );
    const bodies = feed.events.map((e) => e.body);

    // Both group messages are visible to the observer…
    expect(bodies).toContain("status update for the room");
    expect(bodies.some((b) => b?.includes("can you review this?"))).toBe(true);
    // …and awaiting (web is a member → inbox rows, unacked).
    expect(feed.events.every((e) => e.group_id !== null && e.awaiting === 1)).toBe(true);
    expect(feed.awaiting_count).toBeGreaterThanOrEqual(2);
    expect(feed.peers.map((p) => p.peer_id)).toContain(alice.peer.peer_id);
    // The private A↔B DM is ABSENT (the discriminator).
    expect(feed.events.some((e) => e.event_id === secret.event.event_id)).toBe(false);
    expect(bodies.some((b) => b?.includes("private alice->bob"))).toBe(false);

    // filter=awaiting keeps only un-acked items; ack one and it drops out.
    const firstId = feed.events[0]!.event_id;
    await json(daemon.baseUrl, `/peers/${encodeURIComponent(me)}/inbox/ack`, {
      method: "POST",
      body: JSON.stringify({ event_ids: [firstId] }),
    });
    const awaiting = await json<{ events: ActivityEvent[] }>(
      daemon.baseUrl,
      `/activity/${encodeURIComponent(me)}?filter=awaiting`,
    );
    expect(awaiting.events.some((e) => e.event_id === firstId)).toBe(false);
  } finally {
    await daemon.stop();
  }
});
