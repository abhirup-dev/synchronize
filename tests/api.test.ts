import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listAgentSessions, registerAgentSession, renameAgentSession } from "../src/api/agent-sessions.ts";
import {
  createGroup,
  getGroupHistory,
  joinGroup,
  leaveGroup,
  renameInGroup,
  sendGroupMessage,
} from "../src/api/groups.ts";
import { subscribeToEvents } from "../src/api/events.ts";
import { ackInbox, readInbox, sendDm } from "../src/api/inbox.ts";
import { registerPeer } from "../src/api/peers.ts";
import { findReusablePeer } from "../src/api/status.ts";
import type { ClientConfig } from "../src/client.ts";

const homes: string[] = [];

afterAll(async () => {
  await Promise.all(homes.map((home) => rm(home, { recursive: true, force: true })));
});

test("agent session bindings upsert by native session and rename by peer id", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-agent-session-"));
  homes.push(home);
  const daemon = await startDaemon(home);

  try {
    const registered = await registerAgentSession(daemon.client, {
      hostTool: "claude",
      hostSessionId: "claude-native-1",
      hostSessionFile: "/tmp/claude-native-1.jsonl",
      cwd: "/tmp/project",
      sessionName: "backend-review",
      tool: "claude",
      purpose: "claude session",
      metadata: { source: "startup" },
      launchId: "launch-abc",
    });

    expect(registered.binding.host_session_id).toBe("claude-native-1");
    expect(registered.binding.peer.session_name).toBe("backend-review");
    expect(registered.binding.peer.tool).toBe("claude");

    const renamed = await renameAgentSession(daemon.client, {
      peerId: registered.binding.peer_id,
      sessionName: "backend-renamed",
    });
    expect(renamed.binding.peer_id).toBe(registered.binding.peer_id);
    expect(renamed.binding.peer.session_name).toBe("backend-renamed");

    const byPeer = await listAgentSessions(daemon.client, { peerId: registered.binding.peer_id });
    expect(byPeer.bindings).toHaveLength(1);
    expect(byPeer.bindings[0]).toMatchObject({
      host_tool: "claude",
      host_session_id: "claude-native-1",
      peer_id: registered.binding.peer_id,
    });

    const byLaunch = await listAgentSessions(daemon.client, { launchId: "launch-abc" });
    expect(byLaunch.bindings).toHaveLength(1);
    expect(byLaunch.bindings[0]?.peer_id).toBe(registered.binding.peer_id);

    const upserted = await registerAgentSession(daemon.client, {
      hostTool: "claude",
      hostSessionId: "claude-native-1",
      sessionName: "backend-renamed",
      tool: "claude",
      cwd: "/tmp/project-2",
    });
    expect(upserted.binding.peer_id).toBe(registered.binding.peer_id);
    expect(upserted.binding.cwd).toBe("/tmp/project-2");

    const allClaude = await listAgentSessions(daemon.client, { hostTool: "claude" });
    expect(allClaude.bindings).toHaveLength(1);
  } finally {
    await daemon.stop();
  }
});

test("duplicate session names remain distinct when host session ids differ", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-duplicate-session-name-"));
  homes.push(home);
  const daemon = await startDaemon(home);

  try {
    const first = await registerAgentSession(daemon.client, {
      hostTool: "claude",
      hostSessionId: "claude-duplicate-a",
      sessionName: "same-alias",
      tool: "claude",
    });
    const second = await registerAgentSession(daemon.client, {
      hostTool: "claude",
      hostSessionId: "claude-duplicate-b",
      sessionName: "same-alias",
      tool: "claude",
    });

    expect(first.binding.peer_id).not.toBe(second.binding.peer_id);
    expect(first.binding.peer.session_name).toBe("same-alias");
    expect(second.binding.peer.session_name).toBe("same-alias");

    const bindings = await listAgentSessions(daemon.client, { hostTool: "claude" });
    expect(bindings.bindings.map((binding) => binding.host_session_id).sort()).toEqual([
      "claude-duplicate-a",
      "claude-duplicate-b",
    ]);
  } finally {
    await daemon.stop();
  }
});

async function startDaemon(home: string): Promise<{ client: ClientConfig; stop: () => Promise<void> }> {
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

test("shared API client registers reusable peers and drives DM inbox flow", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-api-"));
  homes.push(home);
  const daemon = await startDaemon(home);

  try {
    const alice = await registerPeer(daemon.client, {
      sessionName: "alice",
      tool: "cli",
      purpose: "sender",
    });
    const bob = await registerPeer(daemon.client, {
      sessionName: "bob",
      tool: "codex",
      purpose: "receiver",
    });
    const reusedBob = await findReusablePeer(daemon.client, { sessionName: "bob", tool: "codex" });

    expect(reusedBob).toBe(bob.peer.peer_id);

    const dm = await sendDm(daemon.client, {
      senderPeerId: alice.peer.peer_id,
      recipientPeerId: bob.peer.peer_id,
      message: "through shared api",
    });
    expect(dm.event).toMatchObject({ body: "through shared api", recipient_peer_id: bob.peer.peer_id });

    const inbox = await readInbox(daemon.client, bob.peer.peer_id);
    expect(inbox.events).toEqual([expect.objectContaining({ event_id: dm.event.event_id })]);

    const ack = await ackInbox(
      daemon.client,
      bob.peer.peer_id,
      inbox.events.map((event) => event.event_id),
    );
    expect(ack.acked).toBe(1);

    const empty = await readInbox(daemon.client, bob.peer.peer_id);
    expect(empty.events).toHaveLength(0);
  } finally {
    await daemon.stop();
  }
});

test("alias is freed on leave and reclaim by a different peer emits an audit event", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-group-reclaim-"));
  homes.push(home);
  const daemon = await startDaemon(home);

  try {
    const alice = await registerPeer(daemon.client, { sessionName: "alice", tool: "cli" });
    const bob = await registerPeer(daemon.client, { sessionName: "bob", tool: "cli" });
    const groupName = "reclaim-room";
    await createGroup(daemon.client, { name: groupName, creatorPeerId: alice.peer.peer_id });

    await joinGroup(daemon.client, { name: groupName, peerId: alice.peer.peer_id, alias: "scribe" });
    await joinGroup(daemon.client, { name: groupName, peerId: bob.peer.peer_id, alias: "watcher" });

    // Same peer rejoining after leave does NOT emit reclaim.
    await leaveGroup(daemon.client, { name: groupName, peerId: alice.peer.peer_id });
    await joinGroup(daemon.client, { name: groupName, peerId: alice.peer.peer_id, alias: "scribe" });

    // A different peer claiming the freed alias DOES emit reclaim.
    await leaveGroup(daemon.client, { name: groupName, peerId: alice.peer.peer_id });
    await joinGroup(daemon.client, { name: groupName, peerId: bob.peer.peer_id, alias: "scribe" });

    const history = await getGroupHistory(daemon.client, { name: groupName, peerId: bob.peer.peer_id });
    const reclaims = history.events.filter((event) => event.type === "group_member_alias_reclaimed");
    expect(reclaims).toHaveLength(1);
    expect(reclaims[0]?.sender_peer_id).toBe(bob.peer.peer_id);
    const body = JSON.parse(reclaims[0]?.body ?? "{}") as { alias: string; previous_peer_id: string };
    expect(body.alias).toBe("scribe");
    expect(body.previous_peer_id).toBe(alice.peer.peer_id);
  } finally {
    await daemon.stop();
  }
});

test("rename_in_group renames the requesting peer and emits an audit event", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-group-rename-"));
  homes.push(home);
  const daemon = await startDaemon(home);

  try {
    const alice = await registerPeer(daemon.client, { sessionName: "alice", tool: "cli" });
    const bob = await registerPeer(daemon.client, { sessionName: "bob", tool: "cli" });
    const groupName = "rename-room";
    await createGroup(daemon.client, { name: groupName, creatorPeerId: alice.peer.peer_id });
    await joinGroup(daemon.client, { name: groupName, peerId: alice.peer.peer_id, alias: "scribe" });
    await joinGroup(daemon.client, { name: groupName, peerId: bob.peer.peer_id, alias: "watcher" });

    const renamed = await renameInGroup(daemon.client, {
      name: groupName,
      peerId: alice.peer.peer_id,
      newAlias: "lead-scribe",
    });
    expect(renamed.member.alias).toBe("lead-scribe");
    expect(renamed.member.peer_id).toBe(alice.peer.peer_id);

    // Collision against another active member is rejected.
    await expect(
      renameInGroup(daemon.client, {
        name: groupName,
        peerId: alice.peer.peer_id,
        newAlias: "watcher",
      }),
    ).rejects.toThrow();

    const history = await getGroupHistory(daemon.client, { name: groupName, peerId: alice.peer.peer_id });
    const renames = history.events.filter((event) => event.type === "group_member_renamed");
    expect(renames).toHaveLength(1);
    const body = JSON.parse(renames[0]?.body ?? "{}") as { old_alias: string; new_alias: string };
    expect(body.old_alias).toBe("scribe");
    expect(body.new_alias).toBe("lead-scribe");
  } finally {
    await daemon.stop();
  }
});

test("summary peers carry host_session_id and TUI display name composes the suffix", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-summary-suffix-"));
  homes.push(home);
  const daemon = await startDaemon(home);
  try {
    const bound = await registerAgentSession(daemon.client, {
      hostTool: "claude",
      hostSessionId: "claude-summary-abc123",
      sessionName: "reviewer",
      tool: "claude",
      purpose: "claude session",
    });
    const plain = await registerPeer(daemon.client, { sessionName: "reviewer-cli", tool: "cli" });

    const summary = (await (await fetch(`${daemon.client.baseUrl}/summary`)).json()) as {
      peers: Array<{
        peer_id: string;
        session_name: string;
        host_session_id: string | null;
      }>;
    };
    const boundRow = summary.peers.find((p) => p.peer_id === bound.binding.peer_id);
    const plainRow = summary.peers.find((p) => p.peer_id === plain.peer.peer_id);
    expect(boundRow?.host_session_id).toBe("claude-summary-abc123");
    expect(plainRow?.host_session_id).toBeNull();

    const { peerDisplayName } = await import("../src/cli/render/summary.ts");
    expect(peerDisplayName(boundRow!)).toBe("reviewer#claude");
    expect(peerDisplayName(plainRow!)).toBe(`reviewer-cli#${plain.peer.peer_id.slice(0, 4)}`);
  } finally {
    await daemon.stop();
  }
});

test("group create rejects case-insensitive name collisions", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-group-case-"));
  homes.push(home);
  const daemon = await startDaemon(home);
  try {
    const owner = await registerPeer(daemon.client, { sessionName: "owner", tool: "cli" });
    await createGroup(daemon.client, { name: "Standup", creatorPeerId: owner.peer.peer_id });
    await expect(
      createGroup(daemon.client, { name: "standup", creatorPeerId: owner.peer.peer_id }),
    ).rejects.toThrow(/case-insensitive/);
    await expect(
      createGroup(daemon.client, { name: "STANDUP", creatorPeerId: owner.peer.peer_id }),
    ).rejects.toThrow(/case-insensitive/);
  } finally {
    await daemon.stop();
  }
});

test("ephemeral groups and their media directories are purged on daemon restart", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-ephemeral-cleanup-"));
  homes.push(home);
  let daemon = await startDaemon(home);
  const groupName = "scratchpad";
  let mediaDir = "";
  try {
    const owner = await registerPeer(daemon.client, { sessionName: "owner", tool: "cli" });
    const created = await createGroup(daemon.client, {
      name: groupName,
      ephemeral: true,
      creatorPeerId: owner.peer.peer_id,
    });
    mediaDir = created.group.media_dir;
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(mediaDir, { recursive: true });
    await writeFile(`${mediaDir}/marker.txt`, "hello");
    const { existsSync } = await import("node:fs");
    expect(existsSync(mediaDir)).toBe(true);
  } finally {
    await daemon.stop();
  }
  daemon = await startDaemon(home);
  try {
    const { existsSync } = await import("node:fs");
    expect(existsSync(mediaDir)).toBe(false);
    const groups = (await (await fetch(`${daemon.client.baseUrl}/groups`)).json()) as {
      groups: Array<{ name: string }>;
    };
    expect(groups.groups.find((g) => g.name === groupName)).toBeUndefined();
  } finally {
    await daemon.stop();
  }
});

test("events.type CHECK constraint rejects unknown event types at the storage layer", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-event-check-"));
  homes.push(home);
  const daemon = await startDaemon(home);

  try {
    // Sanity: a known type inserts fine via the normal DM path.
    const sender = await registerPeer(daemon.client, { sessionName: "sender", tool: "cli" });
    const receiver = await registerPeer(daemon.client, { sessionName: "receiver", tool: "cli" });
    await sendDm(daemon.client, {
      senderPeerId: sender.peer.peer_id,
      recipientPeerId: receiver.peer.peer_id,
      message: "hello",
    });

    // Open the SQLite file directly and try to insert an unknown type. The
    // CHECK constraint should reject it.
    const { Database } = await import("bun:sqlite");
    const db = new Database(`${home}/synchronize.db`);
    expect(() =>
      db.exec("INSERT INTO events (type, body) VALUES ('not_a_real_type', 'x')"),
    ).toThrow();
    db.close();
  } finally {
    await daemon.stop();
  }
});

test("group member listings carry host_session_id when an agent_sessions binding exists", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-group-hostid-"));
  homes.push(home);
  const daemon = await startDaemon(home);

  try {
    const bound = await registerAgentSession(daemon.client, {
      hostTool: "claude",
      hostSessionId: "claude-host-xyz",
      sessionName: "lead",
      tool: "claude",
      purpose: "claude session",
    });
    const plain = await registerPeer(daemon.client, { sessionName: "lead-cli", tool: "cli" });
    const groupName = "hostid-room";
    await createGroup(daemon.client, { name: groupName, creatorPeerId: bound.binding.peer_id });
    await joinGroup(daemon.client, { name: groupName, peerId: bound.binding.peer_id, alias: "claude-lead" });
    await joinGroup(daemon.client, { name: groupName, peerId: plain.peer.peer_id, alias: "cli-lead" });

    const peersResp = await fetch(
      `${daemon.client.baseUrl}/peers?group=${encodeURIComponent(groupName)}`,
    );
    const peersBody = (await peersResp.json()) as {
      peers: Array<{ peer_id: string; host_session_id: string | null }>;
    };
    const boundRow = peersBody.peers.find((row) => row.peer_id === bound.binding.peer_id);
    const plainRow = peersBody.peers.find((row) => row.peer_id === plain.peer.peer_id);
    expect(boundRow?.host_session_id).toBe("claude-host-xyz");
    expect(plainRow?.host_session_id).toBeNull();
  } finally {
    await daemon.stop();
  }
});

async function startPushSink(): Promise<{
  url: (peerId: string) => string;
  hits: Map<string, number>;
  stop: () => Promise<void>;
}> {
  const hits = new Map<string, number>();
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request: Request) {
      const peerId = new URL(request.url).pathname.slice(1);
      hits.set(peerId, (hits.get(peerId) ?? 0) + 1);
      return new Response("ok");
    },
  });
  return {
    url: (peerId: string) => `http://127.0.0.1:${server.port}/${peerId}`,
    hits,
    stop: async () => {
      server.stop(true);
    },
  };
}

async function flushPushQueue(): Promise<void> {
  // notifySubscribers fires-and-forgets; give Bun's event loop a tick to drain
  // the fetch callbacks before asserting on the per-peer hit counters.
  await Bun.sleep(80);
}

test("group message mentions resolve to peer_ids and main-channel push reaches only mentioned peers", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-mentions-"));
  homes.push(home);
  const daemon = await startDaemon(home);
  const sink = await startPushSink();

  try {
    const alice = await registerPeer(daemon.client, { sessionName: "alice", tool: "cli" });
    const bob = await registerPeer(daemon.client, { sessionName: "bob", tool: "cli" });
    const carol = await registerPeer(daemon.client, { sessionName: "carol", tool: "cli" });
    const groupName = "mentions-room";
    await createGroup(daemon.client, { name: groupName, creatorPeerId: alice.peer.peer_id });
    await joinGroup(daemon.client, { name: groupName, peerId: alice.peer.peer_id, alias: "alice" });
    await joinGroup(daemon.client, { name: groupName, peerId: bob.peer.peer_id, alias: "bob" });
    await joinGroup(daemon.client, { name: groupName, peerId: carol.peer.peer_id, alias: "carol" });

    for (const peer of [alice, bob, carol]) {
      await subscribeToEvents(daemon.client, {
        peerId: peer.peer.peer_id,
        callbackUrl: sink.url(peer.peer.peer_id),
        token: "test-token",
      });
    }

    const sent = await sendGroupMessage(daemon.client, {
      name: groupName,
      senderPeerId: alice.peer.peer_id,
      message: "ping @bob and @ghost",
    });
    await flushPushQueue();

    expect(sent.event.mentions_json).toBe(JSON.stringify([bob.peer.peer_id]));
    expect(sent.warnings).toEqual([{ token: "@ghost", reason: "alias_not_in_group" }]);

    // Inbox: durable visibility regardless of mention.
    const bobInbox = await readInbox(daemon.client, bob.peer.peer_id);
    const carolInbox = await readInbox(daemon.client, carol.peer.peer_id);
    expect(bobInbox.events.map((event) => event.event_id)).toContain(sent.event.event_id);
    expect(carolInbox.events.map((event) => event.event_id)).toContain(sent.event.event_id);

    // Push: mentioned only.
    expect(sink.hits.get(bob.peer.peer_id) ?? 0).toBe(1);
    expect(sink.hits.get(carol.peer.peer_id) ?? 0).toBe(0);
    expect(sink.hits.get(alice.peer.peer_id) ?? 0).toBe(0);
  } finally {
    await sink.stop();
    await daemon.stop();
  }
});

test("thread reply push reaches root author and prior thread posters along with new mentions", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-thread-fanout-"));
  homes.push(home);
  const daemon = await startDaemon(home);
  const sink = await startPushSink();

  try {
    const alice = await registerPeer(daemon.client, { sessionName: "alice", tool: "cli" });
    const bob = await registerPeer(daemon.client, { sessionName: "bob", tool: "cli" });
    const carol = await registerPeer(daemon.client, { sessionName: "carol", tool: "cli" });
    const dave = await registerPeer(daemon.client, { sessionName: "dave", tool: "cli" });
    const groupName = "thread-fanout-room";
    await createGroup(daemon.client, { name: groupName, creatorPeerId: alice.peer.peer_id });
    for (const peer of [alice, bob, carol, dave]) {
      await joinGroup(daemon.client, { name: groupName, peerId: peer.peer.peer_id, alias: peer.peer.session_name });
      await subscribeToEvents(daemon.client, {
        peerId: peer.peer.peer_id,
        callbackUrl: sink.url(peer.peer.peer_id),
        token: "test-token",
      });
    }

    const root = await sendGroupMessage(daemon.client, {
      name: groupName,
      senderPeerId: alice.peer.peer_id,
      message: "thread start",
    });
    await sendGroupMessage(daemon.client, {
      name: groupName,
      senderPeerId: bob.peer.peer_id,
      message: "bob chimes in",
      inReplyTo: root.event.event_id,
    });
    await flushPushQueue();
    // Pre-reply state: alice was root author (no mentions); bob's reply
    // should ping alice. Reset for clarity on the next assertion.
    const aliceHitsBeforeReply = sink.hits.get(alice.peer.peer_id) ?? 0;
    expect(aliceHitsBeforeReply).toBe(1);
    expect(sink.hits.get(bob.peer.peer_id) ?? 0).toBe(0);
    expect(sink.hits.get(carol.peer.peer_id) ?? 0).toBe(0);

    // Carol replies and mentions dave. Push should reach: alice (root author),
    // bob (prior thread poster), dave (new mention). Carol is sender, no push.
    const carolReply = await sendGroupMessage(daemon.client, {
      name: groupName,
      senderPeerId: carol.peer.peer_id,
      message: "carol replies @dave",
      inReplyTo: root.event.event_id,
    });
    await flushPushQueue();

    expect(carolReply.event.parent_event_id).toBe(root.event.event_id);
    expect((sink.hits.get(alice.peer.peer_id) ?? 0) - aliceHitsBeforeReply).toBe(1);
    expect(sink.hits.get(bob.peer.peer_id) ?? 0).toBe(1);
    expect(sink.hits.get(dave.peer.peer_id) ?? 0).toBe(1);
    expect(sink.hits.get(carol.peer.peer_id) ?? 0).toBe(0);
  } finally {
    await sink.stop();
    await daemon.stop();
  }
});

test("roster events land in every member's inbox but never push", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-roster-fanout-"));
  homes.push(home);
  const daemon = await startDaemon(home);
  const sink = await startPushSink();

  try {
    const alice = await registerPeer(daemon.client, { sessionName: "alice", tool: "cli" });
    const bob = await registerPeer(daemon.client, { sessionName: "bob", tool: "cli" });
    const groupName = "roster-room";
    await createGroup(daemon.client, { name: groupName, creatorPeerId: alice.peer.peer_id });
    await joinGroup(daemon.client, { name: groupName, peerId: alice.peer.peer_id, alias: "alice" });
    await joinGroup(daemon.client, { name: groupName, peerId: bob.peer.peer_id, alias: "bob" });

    for (const peer of [alice, bob]) {
      await subscribeToEvents(daemon.client, {
        peerId: peer.peer.peer_id,
        callbackUrl: sink.url(peer.peer.peer_id),
        token: "test-token",
      });
    }

    // Rename alice -> alice2: bob must see the rename event in inbox, neither party gets push.
    await renameInGroup(daemon.client, { name: groupName, peerId: alice.peer.peer_id, newAlias: "alice2" });
    // Alice leaves: bob must see the leave event.
    await leaveGroup(daemon.client, { name: groupName, peerId: alice.peer.peer_id });
    await flushPushQueue();

    const bobInbox = await readInbox(daemon.client, bob.peer.peer_id);
    const types = bobInbox.events.map((event) => event.type);
    expect(types).toContain("group_member_renamed");
    expect(types).toContain("group_left");

    // No push for any roster event.
    expect(sink.hits.get(alice.peer.peer_id) ?? 0).toBe(0);
    expect(sink.hits.get(bob.peer.peer_id) ?? 0).toBe(0);
  } finally {
    await sink.stop();
    await daemon.stop();
  }
});

test("thread replies collapse to root and main-channel history excludes them", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-threads-"));
  homes.push(home);
  const daemon = await startDaemon(home);

  try {
    const alice = await registerPeer(daemon.client, { sessionName: "alice", tool: "cli" });
    const bob = await registerPeer(daemon.client, { sessionName: "bob", tool: "cli" });
    const groupName = "thread-room";
    await createGroup(daemon.client, { name: groupName, creatorPeerId: alice.peer.peer_id });
    await joinGroup(daemon.client, { name: groupName, peerId: alice.peer.peer_id, alias: "alice" });
    await joinGroup(daemon.client, { name: groupName, peerId: bob.peer.peer_id, alias: "bob" });

    const root = await sendGroupMessage(daemon.client, {
      name: groupName,
      senderPeerId: alice.peer.peer_id,
      message: "root",
    });
    expect(root.event.parent_event_id).toBeNull();

    const reply1 = await sendGroupMessage(daemon.client, {
      name: groupName,
      senderPeerId: bob.peer.peer_id,
      message: "reply-to-root",
      inReplyTo: root.event.event_id,
    });
    expect(reply1.event.parent_event_id).toBe(root.event.event_id);

    // Reply to reply normalizes to root.
    const reply2 = await sendGroupMessage(daemon.client, {
      name: groupName,
      senderPeerId: alice.peer.peer_id,
      message: "reply-to-reply",
      inReplyTo: reply1.event.event_id,
    });
    expect(reply2.event.parent_event_id).toBe(root.event.event_id);

    // Unrelated main-channel message.
    await sendGroupMessage(daemon.client, {
      name: groupName,
      senderPeerId: alice.peer.peer_id,
      message: "another root",
    });

    // Main-channel history hides thread replies; both roots remain.
    const mainHistory = await getGroupHistory(daemon.client, { name: groupName, peerId: alice.peer.peer_id });
    const mainMessages = mainHistory.events.filter((event) => event.type === "group_message");
    expect(mainMessages.map((event) => event.body)).toEqual(["root", "another root"]);
    expect(mainMessages.every((event) => event.parent_event_id === null)).toBe(true);

    // Thread view returns root + replies in chronological order.
    const threadHistory = await getGroupHistory(daemon.client, {
      name: groupName,
      peerId: alice.peer.peer_id,
      threadOf: root.event.event_id,
    });
    const threadMessages = threadHistory.events.filter((event) => event.type === "group_message");
    expect(threadMessages.map((event) => event.body)).toEqual(["root", "reply-to-root", "reply-to-reply"]);
  } finally {
    await daemon.stop();
  }
});

test("thread_of rejects non-root and non-existent events", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-threads-validation-"));
  homes.push(home);
  const daemon = await startDaemon(home);

  try {
    const alice = await registerPeer(daemon.client, { sessionName: "alice", tool: "cli" });
    const groupName = "thread-validation-room";
    await createGroup(daemon.client, { name: groupName, creatorPeerId: alice.peer.peer_id });
    await joinGroup(daemon.client, { name: groupName, peerId: alice.peer.peer_id, alias: "alice" });

    const root = await sendGroupMessage(daemon.client, {
      name: groupName,
      senderPeerId: alice.peer.peer_id,
      message: "root",
    });
    const reply = await sendGroupMessage(daemon.client, {
      name: groupName,
      senderPeerId: alice.peer.peer_id,
      message: "reply",
      inReplyTo: root.event.event_id,
    });

    await expect(
      getGroupHistory(daemon.client, {
        name: groupName,
        peerId: alice.peer.peer_id,
        threadOf: reply.event.event_id,
      }),
    ).rejects.toThrow();

    await expect(
      getGroupHistory(daemon.client, {
        name: groupName,
        peerId: alice.peer.peer_id,
        threadOf: 999_999,
      }),
    ).rejects.toThrow();

    await expect(
      sendGroupMessage(daemon.client, {
        name: groupName,
        senderPeerId: alice.peer.peer_id,
        message: "orphan",
        inReplyTo: 999_999,
      }),
    ).rejects.toThrow();
  } finally {
    await daemon.stop();
  }
});
