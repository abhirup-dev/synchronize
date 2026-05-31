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
  listGroups,
  patchGroup,
  renameInGroup,
  sendGroupMessage,
} from "../src/api/groups.ts";
import { subscribeToEvents } from "../src/api/events.ts";
import { ackInbox, readInbox, sendDm } from "../src/api/inbox.ts";
import { deletePeer, listPeers, registerPeer, setPeerActivity } from "../src/api/peers.ts";
import { queryEvents } from "../src/api/query.ts";
import { listEventReactions, reactToEvent } from "../src/api/reactions.ts";
import { findReusablePeer } from "../src/api/status.ts";
import { getThread, getThreadStatus, listThreads } from "../src/api/threads.ts";
import type { ClientConfig } from "../src/client.ts";
import type { Event } from "../src/api/types.ts";
import { aoeAttachCommand, aoeProfileName, aoeTitle } from "../src/launch/service.ts";

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
    const dave = await registerPeer(daemon.client, { sessionName: "dave", tool: "cli" });
    const groupName = "mentions-room";
    await createGroup(daemon.client, { name: groupName, creatorPeerId: alice.peer.peer_id });
    await joinGroup(daemon.client, { name: groupName, peerId: alice.peer.peer_id, alias: "alice" });
    await joinGroup(daemon.client, { name: groupName, peerId: bob.peer.peer_id, alias: "bob" });
    await joinGroup(daemon.client, { name: groupName, peerId: carol.peer.peer_id, alias: "carol" });
    await joinGroup(daemon.client, { name: groupName, peerId: dave.peer.peer_id, alias: "ui-claude2" });

    for (const peer of [alice, bob, carol, dave]) {
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

    const punctuated = await sendGroupMessage(daemon.client, {
      name: groupName,
      senderPeerId: alice.peer.peer_id,
      message: "ping @ui-claude2.",
    });
    await flushPushQueue();

    expect(punctuated.event.mentions_json).toBe(JSON.stringify([dave.peer.peer_id]));
    expect(punctuated.warnings).toEqual([]);
    expect(sink.hits.get(dave.peer.peer_id) ?? 0).toBe(1);
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

test("group description persists at create, surfaces in listGroups, and is mutable via patch", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-group-description-"));
  homes.push(home);
  const daemon = await startDaemon(home);

  try {
    const alice = await registerPeer(daemon.client, { sessionName: "alice", tool: "cli" });
    const createdWith = await createGroup(daemon.client, {
      name: "described-room",
      creatorPeerId: alice.peer.peer_id,
      description: "  topic at create  ",
    });
    expect(createdWith.group.description).toBe("topic at create");

    const list = await listGroups(daemon.client);
    expect(list.groups.find((g) => g.name === "described-room")?.description).toBe("topic at create");

    const updated = await patchGroup(daemon.client, { name: "described-room", description: "new topic" });
    expect(updated.group.description).toBe("new topic");

    const cleared = await patchGroup(daemon.client, { name: "described-room", description: null });
    expect(cleared.group.description).toBeNull();

    // Empty string is normalized to null (cleared).
    const blank = await patchGroup(daemon.client, { name: "described-room", description: "   " });
    expect(blank.group.description).toBeNull();

    // Groups created without description default to null.
    const noTopic = await createGroup(daemon.client, { name: "plain-room", creatorPeerId: alice.peer.peer_id });
    expect(noTopic.group.description).toBeNull();
  } finally {
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

test("self-mentions are filtered from mentions_json so persisted state matches delivered state", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-self-mention-"));
  homes.push(home);
  const daemon = await startDaemon(home);

  try {
    const alice = await registerPeer(daemon.client, { sessionName: "alice", tool: "cli" });
    const bob = await registerPeer(daemon.client, { sessionName: "bob", tool: "cli" });
    const groupName = "self-mention-room";
    await createGroup(daemon.client, { name: groupName, creatorPeerId: alice.peer.peer_id });
    await joinGroup(daemon.client, { name: groupName, peerId: alice.peer.peer_id, alias: "alice" });
    await joinGroup(daemon.client, { name: groupName, peerId: bob.peer.peer_id, alias: "bob" });

    // Pure self-mention: only @alice in the body, sender is alice. mentions_json
    // must be null — the sender is never advertised as a notification target.
    const onlySelf = await sendGroupMessage(daemon.client, {
      name: groupName,
      senderPeerId: alice.peer.peer_id,
      message: "self-only @alice ping",
    });
    expect(onlySelf.event.mentions_json).toBeNull();
    expect(onlySelf.delivery.pushed_to).toEqual([]);
    expect(onlySelf.delivery.inbox_only).toEqual([bob.peer.peer_id]);

    // Mixed mentions: @alice (self) is dropped, @bob remains.
    const mixed = await sendGroupMessage(daemon.client, {
      name: groupName,
      senderPeerId: alice.peer.peer_id,
      message: "mixed @alice and @bob",
    });
    expect(mixed.event.mentions_json).toBe(JSON.stringify([bob.peer.peer_id]));
    expect(mixed.delivery.pushed_to).toEqual([bob.peer.peer_id]);
  } finally {
    await daemon.stop();
  }
});

test("idempotent re-join with same alias returns already_member without emitting a phantom group_joined event", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-idempotent-join-"));
  homes.push(home);
  const daemon = await startDaemon(home);

  try {
    const alice = await registerPeer(daemon.client, { sessionName: "alice", tool: "cli" });
    const groupName = "idempotent-join-room";
    await createGroup(daemon.client, { name: groupName, creatorPeerId: alice.peer.peer_id });

    const first = await joinGroup(daemon.client, { name: groupName, peerId: alice.peer.peer_id, alias: "alice" });
    expect(first.event).not.toBeNull();
    expect(first.already_member).toBeUndefined();
    const firstJoinEventId = first.event!.event_id;

    const second = await joinGroup(daemon.client, { name: groupName, peerId: alice.peer.peer_id, alias: "alice" });
    expect(second.event).toBeNull();
    expect(second.already_member).toBe(true);
    expect(second.member.join_event_id).toBe(firstJoinEventId);

    // Only ONE group_joined event in history, not two.
    const history = await getGroupHistory(daemon.client, { name: groupName, peerId: alice.peer.peer_id });
    const joins = history.events.filter((event) => event.type === "group_joined");
    expect(joins).toHaveLength(1);
    expect(joins[0]?.event_id).toBe(firstJoinEventId);
  } finally {
    await daemon.stop();
  }
});

test("idempotent leave when peer is not a group member returns already_left without emitting an event", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-idempotent-leave-"));
  homes.push(home);
  const daemon = await startDaemon(home);

  try {
    const alice = await registerPeer(daemon.client, { sessionName: "alice", tool: "cli" });
    const bob = await registerPeer(daemon.client, { sessionName: "bob", tool: "cli" });
    const carol = await registerPeer(daemon.client, { sessionName: "carol", tool: "cli" });
    const groupName = "idempotent-leave-room";
    await createGroup(daemon.client, { name: groupName, creatorPeerId: alice.peer.peer_id });
    await joinGroup(daemon.client, { name: groupName, peerId: alice.peer.peer_id, alias: "alice" });
    // Carol joins and stays — needed because history reads require an active
    // member, and we want to verify event counts after alice has left.
    await joinGroup(daemon.client, { name: groupName, peerId: carol.peer.peer_id, alias: "carol" });

    // Bob never joined — leave is a no-op.
    const neverJoined = await leaveGroup(daemon.client, { name: groupName, peerId: bob.peer.peer_id });
    expect(neverJoined.ok).toBe(true);
    expect(neverJoined.event).toBeNull();
    expect(neverJoined.already_left).toBe(true);

    // Alice leaves, then tries to leave again — second call is also a no-op.
    const firstLeave = await leaveGroup(daemon.client, { name: groupName, peerId: alice.peer.peer_id });
    expect(firstLeave.event).not.toBeNull();
    expect(firstLeave.already_left).toBeUndefined();

    const secondLeave = await leaveGroup(daemon.client, { name: groupName, peerId: alice.peer.peer_id });
    expect(secondLeave.ok).toBe(true);
    expect(secondLeave.event).toBeNull();
    expect(secondLeave.already_left).toBe(true);

    // Read history as carol (still an active member) to verify exactly one
    // group_left event exists despite multiple no-op leave calls.
    const history = await getGroupHistory(daemon.client, { name: groupName, peerId: carol.peer.peer_id });
    const lefts = history.events.filter((event) => event.type === "group_left");
    expect(lefts).toHaveLength(1);
  } finally {
    await daemon.stop();
  }
});

test("alias reclaim surfaces reclaimed_from on the join response so callers don't need to poll events", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-reclaim-response-"));
  homes.push(home);
  const daemon = await startDaemon(home);

  try {
    const alice = await registerPeer(daemon.client, { sessionName: "alice", tool: "cli" });
    const bob = await registerPeer(daemon.client, { sessionName: "bob", tool: "cli" });
    const groupName = "reclaim-response-room";
    await createGroup(daemon.client, { name: groupName, creatorPeerId: alice.peer.peer_id });

    await joinGroup(daemon.client, { name: groupName, peerId: alice.peer.peer_id, alias: "scribe" });
    await leaveGroup(daemon.client, { name: groupName, peerId: alice.peer.peer_id });

    const reclaim = await joinGroup(daemon.client, { name: groupName, peerId: bob.peer.peer_id, alias: "scribe" });
    expect(reclaim.reclaimed_from).toBeDefined();
    expect(reclaim.reclaimed_from?.previous_peer_id).toBe(alice.peer.peer_id);
    // event_id points at the reclaim audit event itself, which sits just
    // before the group_joined event (lower id).
    expect(reclaim.event).not.toBeNull();
    expect(reclaim.reclaimed_from!.event_id).toBeLessThan(reclaim.event!.event_id);

    // A same-peer re-join (no different-peer takeover) carries no reclaimed_from.
    await leaveGroup(daemon.client, { name: groupName, peerId: bob.peer.peer_id });
    const sameRejoin = await joinGroup(daemon.client, { name: groupName, peerId: bob.peer.peer_id, alias: "scribe" });
    expect(sameRejoin.reclaimed_from).toBeUndefined();
  } finally {
    await daemon.stop();
  }
});

test("group message response always returns warnings array and a delivery split for verification", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-warnings-delivery-"));
  homes.push(home);
  const daemon = await startDaemon(home);

  try {
    const alice = await registerPeer(daemon.client, { sessionName: "alice", tool: "cli" });
    const bob = await registerPeer(daemon.client, { sessionName: "bob", tool: "cli" });
    const carol = await registerPeer(daemon.client, { sessionName: "carol", tool: "cli" });
    const groupName = "warnings-delivery-room";
    await createGroup(daemon.client, { name: groupName, creatorPeerId: alice.peer.peer_id });
    for (const peer of [alice, bob, carol]) {
      await joinGroup(daemon.client, { name: groupName, peerId: peer.peer.peer_id, alias: peer.peer.session_name });
    }

    // Clean send: no mentions, no warnings expected. warnings MUST be `[]`
    // (empty array), never undefined — agents shouldn't have to defensive-optional.
    const clean = await sendGroupMessage(daemon.client, {
      name: groupName,
      senderPeerId: alice.peer.peer_id,
      message: "hello everyone",
    });
    expect(clean.warnings).toEqual([]);
    expect(clean.delivery.pushed_to).toEqual([]);
    expect(clean.delivery.inbox_only.sort()).toEqual([bob.peer.peer_id, carol.peer.peer_id].sort());

    // Mention + unresolved alias: warnings has the unresolved token; delivery
    // splits pushed (mentioned) and inbox_only (active but not mentioned).
    const withMentions = await sendGroupMessage(daemon.client, {
      name: groupName,
      senderPeerId: alice.peer.peer_id,
      message: "ping @bob and @ghost",
    });
    expect(withMentions.warnings).toEqual([{ token: "@ghost", reason: "alias_not_in_group" }]);
    expect(withMentions.delivery.pushed_to).toEqual([bob.peer.peer_id]);
    expect(withMentions.delivery.inbox_only).toEqual([carol.peer.peer_id]);
  } finally {
    await daemon.stop();
  }
});

test("events lookup endpoint enforces visibility by group membership and history_from boundary", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-events-lookup-"));
  homes.push(home);
  const daemon = await startDaemon(home);

  try {
    const alice = await registerPeer(daemon.client, { sessionName: "alice", tool: "cli" });
    const bob = await registerPeer(daemon.client, { sessionName: "bob", tool: "cli" });
    const carol = await registerPeer(daemon.client, { sessionName: "carol", tool: "cli" });
    const groupName = "events-lookup-room";
    await createGroup(daemon.client, { name: groupName, creatorPeerId: alice.peer.peer_id });
    await joinGroup(daemon.client, { name: groupName, peerId: alice.peer.peer_id, alias: "alice" });

    const sent = await sendGroupMessage(daemon.client, {
      name: groupName,
      senderPeerId: alice.peer.peer_id,
      message: "before bob joins",
    });

    // Bob joins AFTER the message — fresh=false default still cuts him off at
    // history_from = current event_id, so the earlier message is invisible.
    await joinGroup(daemon.client, { name: groupName, peerId: bob.peer.peer_id, alias: "bob", fresh: true });

    // Alice (in-group, sent it) can fetch.
    const aliceFetch = await fetch(
      `${daemon.client.baseUrl}/events/${sent.event.event_id}?peer_id=${alice.peer.peer_id}`,
    );
    expect(aliceFetch.status).toBe(200);
    const aliceBody = (await aliceFetch.json()) as { event: { event_id: number } };
    expect(aliceBody.event.event_id).toBe(sent.event.event_id);

    // Bob is in the group but the event is before his history_from boundary — 404.
    const bobFetch = await fetch(
      `${daemon.client.baseUrl}/events/${sent.event.event_id}?peer_id=${bob.peer.peer_id}`,
    );
    expect(bobFetch.status).toBe(404);

    // Carol is not in the group at all — 404.
    const carolFetch = await fetch(
      `${daemon.client.baseUrl}/events/${sent.event.event_id}?peer_id=${carol.peer.peer_id}`,
    );
    expect(carolFetch.status).toBe(404);

    // Missing peer_id query parameter — 400.
    const noPeer = await fetch(`${daemon.client.baseUrl}/events/${sent.event.event_id}`);
    expect(noPeer.status).toBe(400);

    // Nonexistent event id — 404.
    const ghost = await fetch(`${daemon.client.baseUrl}/events/999999?peer_id=${alice.peer.peer_id}`);
    expect(ghost.status).toBe(404);
  } finally {
    await daemon.stop();
  }
});

test("main-channel history rows carry reply_count and last_reply_event_id for thread discovery", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-history-thread-meta-"));
  homes.push(home);
  const daemon = await startDaemon(home);

  try {
    const alice = await registerPeer(daemon.client, { sessionName: "alice", tool: "cli" });
    const groupName = "history-thread-meta-room";
    await createGroup(daemon.client, { name: groupName, creatorPeerId: alice.peer.peer_id });
    await joinGroup(daemon.client, { name: groupName, peerId: alice.peer.peer_id, alias: "alice" });

    const withReplies = await sendGroupMessage(daemon.client, {
      name: groupName,
      senderPeerId: alice.peer.peer_id,
      message: "this one will have replies",
    });
    const withoutReplies = await sendGroupMessage(daemon.client, {
      name: groupName,
      senderPeerId: alice.peer.peer_id,
      message: "this one is a leaf",
    });

    const reply1 = await sendGroupMessage(daemon.client, {
      name: groupName,
      senderPeerId: alice.peer.peer_id,
      message: "reply 1",
      inReplyTo: withReplies.event.event_id,
    });
    const reply2 = await sendGroupMessage(daemon.client, {
      name: groupName,
      senderPeerId: alice.peer.peer_id,
      message: "reply 2",
      inReplyTo: withReplies.event.event_id,
    });

    const history = await getGroupHistory(daemon.client, { name: groupName, peerId: alice.peer.peer_id });
    const rowsByEventId = new Map<number, Event & { reply_count?: number; last_reply_event_id?: number | null }>();
    for (const row of history.events as unknown as Array<Event & { reply_count?: number; last_reply_event_id?: number | null }>) {
      rowsByEventId.set(row.event_id, row);
    }

    const rootRow = rowsByEventId.get(withReplies.event.event_id);
    expect(rootRow?.reply_count).toBe(2);
    expect(rootRow?.last_reply_event_id).toBe(Math.max(reply1.event.event_id, reply2.event.event_id));

    const leafRow = rowsByEventId.get(withoutReplies.event.event_id);
    expect(leafRow?.reply_count).toBe(0);
    expect(leafRow?.last_reply_event_id).toBeNull();

    // Replies themselves are NOT in the main-channel view (parent_event_id IS NULL filter).
    expect(rowsByEventId.has(reply1.event.event_id)).toBe(false);
    expect(rowsByEventId.has(reply2.event.event_id)).toBe(false);
  } finally {
    await daemon.stop();
  }
});

test("@-mention parser ignores tokens inside single-backtick and triple-backtick fenced regions", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-mention-backtick-"));
  homes.push(home);
  const daemon = await startDaemon(home);

  try {
    const alice = await registerPeer(daemon.client, { sessionName: "alice", tool: "cli" });
    const bob = await registerPeer(daemon.client, { sessionName: "bob", tool: "cli" });
    const groupName = "mention-backtick-room";
    await createGroup(daemon.client, { name: groupName, creatorPeerId: alice.peer.peer_id });
    await joinGroup(daemon.client, { name: groupName, peerId: alice.peer.peer_id, alias: "alice" });
    await joinGroup(daemon.client, { name: groupName, peerId: bob.peer.peer_id, alias: "bob" });

    // @peer and @id inside single backticks must NOT resolve or warn.
    // The @bob outside the backticks must resolve normally.
    const single = await sendGroupMessage(daemon.client, {
      name: groupName,
      senderPeerId: alice.peer.peer_id,
      message: "discussing `@peer:uuid` and `@id:X` syntax; meanwhile @bob is a real mention",
    });
    expect(single.warnings).toEqual([]);
    expect(single.event.mentions_json).toBe(JSON.stringify([bob.peer.peer_id]));

    // Triple-backtick code fences are also carved out.
    const fenced = await sendGroupMessage(daemon.client, {
      name: groupName,
      senderPeerId: alice.peer.peer_id,
      message: "code example:\n```\n@phantom @anotherphantom\n```\nbut @bob is real",
    });
    expect(fenced.warnings).toEqual([]);
    expect(fenced.event.mentions_json).toBe(JSON.stringify([bob.peer.peer_id]));

    // Sanity: when @ tokens are NOT in backticks they DO warn for unresolved.
    const naked = await sendGroupMessage(daemon.client, {
      name: groupName,
      senderPeerId: alice.peer.peer_id,
      message: "@phantom outside any fence",
    });
    expect(naked.warnings).toEqual([{ token: "@phantom", reason: "alias_not_in_group" }]);
  } finally {
    await daemon.stop();
  }
});

test("in_reply_to rejects roster events with reply_target_not_message", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-reply-target-validation-"));
  homes.push(home);
  const daemon = await startDaemon(home);

  try {
    const alice = await registerPeer(daemon.client, { sessionName: "alice", tool: "cli" });
    const groupName = "reply-target-validation-room";
    await createGroup(daemon.client, { name: groupName, creatorPeerId: alice.peer.peer_id });
    const join = await joinGroup(daemon.client, { name: groupName, peerId: alice.peer.peer_id, alias: "alice" });
    // join.event is the group_joined event — a roster event, not a message.

    await expect(
      sendGroupMessage(daemon.client, {
        name: groupName,
        senderPeerId: alice.peer.peer_id,
        message: "trying to reply to a join event",
        inReplyTo: join.event!.event_id,
      }),
    ).rejects.toThrow();

    // Replying to a real message still works.
    const root = await sendGroupMessage(daemon.client, {
      name: groupName,
      senderPeerId: alice.peer.peer_id,
      message: "root message",
    });
    const reply = await sendGroupMessage(daemon.client, {
      name: groupName,
      senderPeerId: alice.peer.peer_id,
      message: "valid reply",
      inReplyTo: root.event.event_id,
    });
    expect(reply.event.parent_event_id).toBe(root.event.event_id);
  } finally {
    await daemon.stop();
  }
});

test("threads endpoint returns root, replies, participants, and last_event_id in a single call", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-threads-endpoint-"));
  homes.push(home);
  const daemon = await startDaemon(home);

  try {
    const alice = await registerPeer(daemon.client, { sessionName: "alice", tool: "cli" });
    const bob = await registerPeer(daemon.client, { sessionName: "bob", tool: "cli" });
    const carol = await registerPeer(daemon.client, { sessionName: "carol", tool: "cli" });
    const groupName = "threads-endpoint-room";
    await createGroup(daemon.client, { name: groupName, creatorPeerId: alice.peer.peer_id });
    for (const peer of [alice, bob, carol]) {
      await joinGroup(daemon.client, { name: groupName, peerId: peer.peer.peer_id, alias: peer.peer.session_name });
    }

    const root = await sendGroupMessage(daemon.client, {
      name: groupName,
      senderPeerId: alice.peer.peer_id,
      message: "thread root",
    });
    const bobReply = await sendGroupMessage(daemon.client, {
      name: groupName,
      senderPeerId: bob.peer.peer_id,
      message: "bob replies",
      inReplyTo: root.event.event_id,
    });
    const carolReply = await sendGroupMessage(daemon.client, {
      name: groupName,
      senderPeerId: carol.peer.peer_id,
      message: "carol replies",
      inReplyTo: root.event.event_id,
    });

    const res = await fetch(`${daemon.client.baseUrl}/threads/${root.event.event_id}?peer_id=${alice.peer.peer_id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      root: Event;
      replies: Event[];
      participants: Array<{ peer_id: string; alias: string | null; active: boolean }>;
      reply_count: number;
      last_event_id: number;
    };

    expect(body.root.event_id).toBe(root.event.event_id);
    expect(body.replies.map((r) => r.event_id).sort()).toEqual([bobReply.event.event_id, carolReply.event.event_id].sort());
    expect(body.reply_count).toBe(2);
    expect(body.last_event_id).toBe(Math.max(bobReply.event.event_id, carolReply.event.event_id));

    const participantIds = body.participants.map((p) => p.peer_id).sort();
    expect(participantIds).toEqual([alice.peer.peer_id, bob.peer.peer_id, carol.peer.peer_id].sort());
    for (const p of body.participants) {
      expect(p.active).toBe(true);
    }

    // Reply id is rejected (must pass the root).
    const onReply = await fetch(`${daemon.client.baseUrl}/threads/${bobReply.event.event_id}?peer_id=${alice.peer.peer_id}`);
    expect(onReply.status).toBe(400);

    // Non-member is rejected.
    const stranger = await registerPeer(daemon.client, { sessionName: "stranger", tool: "cli" });
    const strangerFetch = await fetch(`${daemon.client.baseUrl}/threads/${root.event.event_id}?peer_id=${stranger.peer.peer_id}`);
    expect(strangerFetch.status).toBe(404);
  } finally {
    await daemon.stop();
  }
});

test("event SQL query endpoint exposes views and rejects non-read-only SQL", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-query-events-"));
  homes.push(home);
  const daemon = await startDaemon(home);

  try {
    const alice = await registerPeer(daemon.client, { sessionName: "alice", tool: "cli" });
    const bob = await registerPeer(daemon.client, { sessionName: "bob", tool: "cli" });
    const groupName = "query-events-room";
    await createGroup(daemon.client, { name: groupName, creatorPeerId: alice.peer.peer_id });
    await joinGroup(daemon.client, { name: groupName, peerId: alice.peer.peer_id, alias: "alice" });
    await joinGroup(daemon.client, { name: groupName, peerId: bob.peer.peer_id, alias: "bob" });
    const root = await sendGroupMessage(daemon.client, {
      name: groupName,
      senderPeerId: alice.peer.peer_id,
      message: "sql root",
    });
    const reply = await sendGroupMessage(daemon.client, {
      name: groupName,
      senderPeerId: bob.peer.peer_id,
      message: "sql reply",
      inReplyTo: root.event.event_id,
    });

    const eventLog = await queryEvents(daemon.client, {
      sql: "select event_id, group_name, sender_session_name from event_log where event_id = ?",
      params: [root.event.event_id],
    });
    expect(eventLog.columns).toEqual(["event_id", "group_name", "sender_session_name"]);
    expect(eventLog.rows).toEqual([
      { event_id: root.event.event_id, group_name: groupName, sender_session_name: "alice" },
    ]);

    const threadEvents = await queryEvents(daemon.client, {
      sql: "select event_id, body from thread_events where thread_root_event_id = ? order by created_at, event_id",
      params: [root.event.event_id],
    });
    expect(threadEvents.rows.map((row) => row.event_id)).toEqual([root.event.event_id, reply.event.event_id]);
    expect(threadEvents.truncated).toBe(false);

    const discovered = await queryEvents(daemon.client, {
      sql: "select root_event_id, reply_count from discoverable_threads where root_event_id = ?",
      params: [root.event.event_id],
    });
    expect(discovered.rows).toEqual([{ root_event_id: root.event.event_id, reply_count: 1 }]);

    const limited = await queryEvents(daemon.client, { sql: "select event_id from event_log order by event_id", limit: 1 });
    expect(limited.row_count).toBe(1);
    expect(limited.truncated).toBe(true);

    const write = await fetch(`${daemon.client.baseUrl}/query/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sql: "delete from events" }),
    });
    expect(write.status).toBe(400);

    const multi = await fetch(`${daemon.client.baseUrl}/query/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sql: "select 1; select 2" }),
    });
    expect(multi.status).toBe(400);
  } finally {
    await daemon.stop();
  }
});

test("thread discovery status and transcript APIs expose first-class thread workflows", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-thread-workflows-"));
  homes.push(home);
  const daemon = await startDaemon(home);

  try {
    const alice = await registerPeer(daemon.client, { sessionName: "alice", tool: "cli" });
    const bob = await registerPeer(daemon.client, { sessionName: "bob", tool: "cli" });
    const groupName = "thread-workflows-room";
    await createGroup(daemon.client, { name: groupName, creatorPeerId: alice.peer.peer_id });
    await joinGroup(daemon.client, { name: groupName, peerId: alice.peer.peer_id, alias: "alice" });
    await joinGroup(daemon.client, { name: groupName, peerId: bob.peer.peer_id, alias: "bob" });
    const standalone = await sendGroupMessage(daemon.client, {
      name: groupName,
      senderPeerId: alice.peer.peer_id,
      message: "standalone",
    });
    const root = await sendGroupMessage(daemon.client, {
      name: groupName,
      senderPeerId: alice.peer.peer_id,
      message: "thread root",
    });
    const reply = await sendGroupMessage(daemon.client, {
      name: groupName,
      senderPeerId: bob.peer.peer_id,
      message: "thread reply",
      inReplyTo: root.event.event_id,
    });

    const listed = await listThreads(daemon.client, { group: groupName });
    expect(listed.threads.map((thread) => thread.root_event_id)).toContain(root.event.event_id);
    expect(listed.threads.map((thread) => thread.root_event_id)).not.toContain(standalone.event.event_id);
    expect(listed.threads[0]).toMatchObject({
      group_name: groupName,
      root_sender_session_name: "alice",
      reply_count: 1,
      participant_count: 2,
      preview: "thread root",
    });

    const byParticipant = await listThreads(daemon.client, { participatedBySessionName: "bob" });
    expect(byParticipant.threads.map((thread) => thread.root_event_id)).toContain(root.event.event_id);

    const { status } = await getThreadStatus(daemon.client, root.event.event_id);
    expect(status).toMatchObject({
      root_event_id: root.event.event_id,
      group_name: groupName,
      root_sender_session_name: "alice",
      last_event_id: reply.event.event_id,
      reply_count: 1,
      event_count: 2,
      participant_count: 2,
    });
    expect(status.participants.map((participant) => participant.session_name).sort()).toEqual(["alice", "bob"]);

    const thread = await getThread(daemon.client, { rootEventId: root.event.event_id, format: "transcript" });
    expect(thread.events.map((event) => event.event_id)).toEqual([root.event.event_id, reply.event.event_id]);
    expect(thread.transcript).toContain("alice: thread root");
    expect(thread.transcript).toContain("bob: thread reply");
  } finally {
    await daemon.stop();
  }
});

test("soft-deleted peer disappears from roster but keeps its group_members row so reclaim still fires", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-soft-delete-"));
  homes.push(home);
  const daemon = await startDaemon(home);
  try {
    const groupName = "soft-delete-room";
    const alice = await registerPeer(daemon.client, { sessionName: "alice", tool: "cli" });
    const karel = await registerPeer(daemon.client, { sessionName: "karel", tool: "cli" });
    const bob = await registerPeer(daemon.client, { sessionName: "bob", tool: "cli" });

    await createGroup(daemon.client, { name: groupName, creatorPeerId: alice.peer.peer_id });
    await joinGroup(daemon.client, { name: groupName, peerId: alice.peer.peer_id, alias: "alice" });
    await joinGroup(daemon.client, { name: groupName, peerId: karel.peer.peer_id, alias: "karel" });

    // 1. Soft-delete karel.
    await deletePeer(daemon.client, karel.peer.peer_id);

    // 2. Roster excludes the deleted peer.
    const roster = (await listPeers(daemon.client)) as { peers: Array<{ peer_id: string }> };
    expect(roster.peers.map((peer) => peer.peer_id)).not.toContain(karel.peer.peer_id);

    // 3. Group roster also drops the inactive deleted member (active=1 filter
    //    on bridge_list_peers?group= and on /peers?group= in the daemon).
    const groupRoster = (await listPeers(daemon.client, { group: groupName })) as {
      peers: Array<{ peer_id: string; alias: string; active: boolean }>;
    };
    expect(groupRoster.peers.map((peer) => peer.peer_id).sort()).toEqual([alice.peer.peer_id]);

    // 4. group_members row is preserved (the whole point of soft-delete).
    //    Reading it via the daemon's history endpoint is awkward; assert via
    //    direct SQLite read.
    const { Database } = await import("bun:sqlite");
    const db = new Database(join(home, "synchronize.db"), { readonly: true });
    const memberRow = db
      .query<{ peer_id: string; alias: string; active: number }, [string]>(
        "SELECT peer_id, alias, active FROM group_members WHERE peer_id = ?",
      )
      .get(karel.peer.peer_id);
    expect(memberRow).not.toBeNull();
    expect(memberRow?.alias).toBe("karel");
    expect(memberRow?.active).toBe(0);
    db.close();

    // 5. The freed alias can be reclaimed; the daemon's reclaim path still
    //    sees the previous owner's group_members row and emits the audit
    //    event with previous_peer_id = karel.peer.peer_id.
    const reclaim = await joinGroup(daemon.client, {
      name: groupName,
      peerId: bob.peer.peer_id,
      alias: "karel",
    });
    expect(reclaim.reclaimed_from?.previous_peer_id).toBe(karel.peer.peer_id);
    expect(reclaim.reclaimed_from?.event_id).toBeGreaterThan(0);

    // 6. Heartbeating a soft-deleted peer returns 404 peer_not_found —
    //    behavior consumers can branch on deterministically.
    const heartbeat = await fetch(`${daemon.client.baseUrl}/peers/${encodeURIComponent(karel.peer.peer_id)}/heartbeat`, {
      method: "PATCH",
    });
    expect(heartbeat.status).toBe(404);
    const heartbeatBody = (await heartbeat.json()) as { error: { code: string } };
    expect(heartbeatBody.error.code).toBe("peer_not_found");
  } finally {
    await daemon.stop();
  }
});

test("re-registering with a soft-deleted peer_id resurrects the peer and clears deleted_at", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-resurrect-"));
  homes.push(home);
  const daemon = await startDaemon(home);
  try {
    const initial = await registerPeer(daemon.client, { sessionName: "karel", tool: "pi" });
    const peerId = initial.peer.peer_id;
    await deletePeer(daemon.client, peerId);

    // Pre-resurrection: heartbeat fails, peer is hidden.
    const beforeHb = await fetch(`${daemon.client.baseUrl}/peers/${encodeURIComponent(peerId)}/heartbeat`, {
      method: "PATCH",
    });
    expect(beforeHb.status).toBe(404);

    // Re-register with the same peer_id (this is the MCP flow when
    // SYNCHRONIZE_PEER_ID / launch_id resolves to a previously-deleted peer).
    const resurrected = await registerPeer(daemon.client, {
      peerId,
      sessionName: "karel-resurrected",
      tool: "pi",
    });
    expect(resurrected.peer.peer_id).toBe(peerId);
    expect(resurrected.peer.session_name).toBe("karel-resurrected");

    // Heartbeat now succeeds.
    const afterHb = await fetch(`${daemon.client.baseUrl}/peers/${encodeURIComponent(peerId)}/heartbeat`, {
      method: "PATCH",
    });
    expect(afterHb.status).toBe(200);

    // deleted_at was cleared.
    const { Database } = await import("bun:sqlite");
    const db = new Database(join(home, "synchronize.db"), { readonly: true });
    const peerRow = db
      .query<{ deleted_at: string | null }, [string]>("SELECT deleted_at FROM peers WHERE peer_id = ?")
      .get(peerId);
    expect(peerRow?.deleted_at).toBeNull();
    db.close();
  } finally {
    await daemon.stop();
  }
});

test("web state endpoint returns summaries and room-scoped event history", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-web-state-"));
  homes.push(home);
  const daemon = await startDaemon(home);

  try {
    const web = await registerPeer(daemon.client, { peerId: "web:test", sessionName: "web-ui", tool: "web" });
    const alice = await registerAgentSession(daemon.client, {
      peerId: "peer-web-alice",
      hostTool: "claude",
      hostSessionId: "claude-web-alice",
      sessionName: "alice",
      tool: "claude",
      launchId: "launch-web-alice",
    });
    const alicePeer = alice.binding.peer;
    const groupName = "web-room";
    const group = await createGroup(daemon.client, { name: groupName, creatorPeerId: alicePeer.peer_id });
    await joinGroup(daemon.client, { name: groupName, peerId: alicePeer.peer_id, alias: "alice" });
    await joinGroup(daemon.client, { name: groupName, peerId: web.peer.peer_id, alias: "web" });
    const sent = await sendGroupMessage(daemon.client, {
      name: groupName,
      senderPeerId: alicePeer.peer_id,
      message: "hello web state",
    });

    const summary = await fetch(`${daemon.client.baseUrl}/web/state?peer_id=${encodeURIComponent(web.peer.peer_id)}`);
    expect(summary.status).toBe(200);
    // ETag = event cursor + a digest of time-derived presence, so lease-lapse /
    // activity transitions (which create no event) still bust the 304.
    const summaryEtag = summary.headers.get("etag");
    expect(summaryEtag).toMatch(new RegExp(`^W/"${sent.event.event_id}\\.[a-z0-9]+"$`));
    const summaryBody = await summary.json() as {
      peers: Array<{ peer_id: string; aoe_session?: { profile: string; title: string; attach_command: string } }>;
      groups: Array<{ group_id: number; name: string }>;
      group_paths: Array<{ group_id: number; path: string; active: boolean }>;
      room_summaries: Array<{ group_id: number; last_event_id: number | null; last_preview: string | null }>;
      events: unknown[];
    };
    const expectedAoeTitle = aoeTitle({
      launchId: "launch-web-alice",
      peerId: alicePeer.peer_id,
      group: groupName,
      sessionName: "alice",
      tool: "claude",
    });
    const expectedAoeProfile = aoeProfileName(home);
    expect(summaryBody.peers).toContainEqual(expect.objectContaining({
      peer_id: alicePeer.peer_id,
      aoe_session: {
        profile: expectedAoeProfile,
        title: expectedAoeTitle,
        attach_command: aoeAttachCommand(expectedAoeProfile, expectedAoeTitle),
      },
    }));
    expect(summaryBody.groups).toContainEqual(expect.objectContaining({ group_id: group.group.group_id, name: groupName }));
    expect(summaryBody.group_paths).toContainEqual(expect.objectContaining({
      group_id: group.group.group_id,
      path: process.cwd(),
      active: true,
    }));
    expect(summaryBody.room_summaries).toContainEqual(expect.objectContaining({
      group_id: group.group.group_id,
      last_event_id: sent.event.event_id,
      last_preview: "hello web state",
    }));
    expect(summaryBody.events).toHaveLength(0);

    const notModified = await fetch(`${daemon.client.baseUrl}/web/state?peer_id=${encodeURIComponent(web.peer.peer_id)}`, {
      headers: { "if-none-match": summaryEtag! },
    });
    expect(notModified.status).toBe(304);

    // Regression: a presence change must bust the ETag even though it creates no
    // new event (the cursor is unchanged). Without folding presence into the tag
    // the conditional GET would 304 and the client would render stale presence.
    await setPeerActivity(daemon.client, { peerId: alicePeer.peer_id, state: "working" });
    const afterActivity = await fetch(`${daemon.client.baseUrl}/web/state?peer_id=${encodeURIComponent(web.peer.peer_id)}`, {
      headers: { "if-none-match": summaryEtag! },
    });
    expect(afterActivity.status).toBe(200);
    expect(afterActivity.headers.get("etag")).not.toBe(summaryEtag);

    // Regression: AOE attach metadata is derived from agent_sessions, not the
    // event stream. Adding it for an existing rendered peer must also bust the
    // ETag, otherwise the browser can keep showing "AOE session unavailable".
    const bob = await registerPeer(daemon.client, {
      peerId: "peer-web-bob",
      sessionName: "bob",
      tool: "pi",
    });
    const beforeAoe = await fetch(`${daemon.client.baseUrl}/web/state?peer_id=${encodeURIComponent(web.peer.peer_id)}`);
    expect(beforeAoe.status).toBe(200);
    const beforeAoeEtag = beforeAoe.headers.get("etag");
    expect(beforeAoeEtag).toBeTruthy();
    await registerAgentSession(daemon.client, {
      peerId: bob.peer.peer_id,
      hostTool: "pi",
      hostSessionId: "pi-web-bob",
      sessionName: "bob",
      tool: "pi",
      launchId: "launch-web-bob",
    });
    const afterAoe = await fetch(`${daemon.client.baseUrl}/web/state?peer_id=${encodeURIComponent(web.peer.peer_id)}`, {
      headers: { "if-none-match": beforeAoeEtag! },
    });
    expect(afterAoe.status).toBe(200);
    expect(afterAoe.headers.get("etag")).not.toBe(beforeAoeEtag);
    const afterAoeBody = await afterAoe.json() as {
      peers: Array<{ peer_id: string; aoe_session?: { attach_command: string } }>;
    };
    const bobAoe = afterAoeBody.peers.find((peer) => peer.peer_id === bob.peer.peer_id)?.aoe_session;
    expect(bobAoe?.attach_command).toBeTruthy();

    const room = await fetch(
      `${daemon.client.baseUrl}/web/state?peer_id=${encodeURIComponent(web.peer.peer_id)}&room=group:${group.group.group_id}`,
    );
    const roomBody = await room.json() as { events: Array<{ event_id: number; body: string | null }> };
    expect(roomBody.events).toContainEqual(expect.objectContaining({
      event_id: sent.event.event_id,
      body: "hello web state",
    }));
  } finally {
    await daemon.stop();
  }
});

test("web session endpoint returns a stable daemon-owned local web peer", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-web-session-"));
  homes.push(home);
  const daemon = await startDaemon(home);

  try {
    const first = await fetch(`${daemon.client.baseUrl}/web/session`, { method: "POST" });
    expect(first.status).toBe(200);
    const firstBody = await first.json() as {
      peer: { peer_id: string; tool: string; session_name: string; purpose: string | null; lease_expires_at: string };
    };

    const second = await fetch(`${daemon.client.baseUrl}/web/session`, { method: "POST" });
    expect(second.status).toBe(200);
    const secondBody = await second.json() as {
      peer: { peer_id: string; tool: string; session_name: string; purpose: string | null; lease_expires_at: string };
    };

    expect(firstBody.peer.peer_id).toBe("web:local-human");
    expect(secondBody.peer.peer_id).toBe(firstBody.peer.peer_id);
    expect(secondBody.peer.tool).toBe("web");
    expect(secondBody.peer.session_name).toBe("web-ui");
    expect(secondBody.peer.purpose).toBe("local human web participant");
    expect(secondBody.peer.lease_expires_at).toBe("9999-12-31T23:59:59.999Z");

    const state = await fetch(`${daemon.client.baseUrl}/web/state?peer_id=${encodeURIComponent(secondBody.peer.peer_id)}`);
    const stateBody = await state.json() as { peers: Array<{ peer_id: string }> };
    expect(stateBody.peers).toContainEqual(expect.objectContaining({ peer_id: "web:local-human" }));
  } finally {
    await daemon.stop();
  }
});

test("local web session can reclaim stale web-held you alias", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-web-reclaim-"));
  homes.push(home);
  const daemon = await startDaemon(home);

  try {
    const oldWeb = await registerPeer(daemon.client, { peerId: "web:old", sessionName: "web-ui", tool: "web" });
    const alice = await registerPeer(daemon.client, { sessionName: "alice", tool: "claude" });
    const groupName = "web-reclaim-room";
    await createGroup(daemon.client, { name: groupName, creatorPeerId: alice.peer.peer_id });
    await joinGroup(daemon.client, { name: groupName, peerId: oldWeb.peer.peer_id, alias: "you" });

    const session = await fetch(`${daemon.client.baseUrl}/web/session`, { method: "POST" });
    const sessionBody = await session.json() as { peer: { peer_id: string } };
    const joined = await joinGroup(daemon.client, { name: groupName, peerId: sessionBody.peer.peer_id, alias: "you" });

    expect(joined.member.peer_id).toBe("web:local-human");
    expect(joined.member.alias).toBe("you");
    expect(joined.reclaimed_from?.previous_peer_id).toBe("web:old");

    const roster = await listPeers(daemon.client, { group: groupName }) as {
      peers: Array<{ peer_id: string; alias: string; active: boolean }>;
    };
    const activeYou = roster.peers.filter((member) => member.alias === "you" && member.active);
    expect(activeYou).toHaveLength(1);
    expect(activeYou[0]?.peer_id).toBe("web:local-human");
  } finally {
    await daemon.stop();
  }
});

test("local web session does not reclaim non-web-held you alias", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-web-reclaim-non-web-"));
  homes.push(home);
  const daemon = await startDaemon(home);

  try {
    const alice = await registerPeer(daemon.client, { sessionName: "alice", tool: "claude" });
    const groupName = "web-reclaim-non-web-room";
    await createGroup(daemon.client, { name: groupName, creatorPeerId: alice.peer.peer_id });
    await joinGroup(daemon.client, { name: groupName, peerId: alice.peer.peer_id, alias: "you" });
    const session = await fetch(`${daemon.client.baseUrl}/web/session`, { method: "POST" });
    const sessionBody = await session.json() as { peer: { peer_id: string } };

    const response = await fetch(`${daemon.client.baseUrl}/groups/${encodeURIComponent(groupName)}/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ peer_id: sessionBody.peer.peer_id, alias: "you" }),
    });
    const body = await response.json() as { error?: { code: string } };

    expect(response.status).toBe(409);
    expect(body.error?.code).toBe("alias_collision");
  } finally {
    await daemon.stop();
  }
});

test("emoji reactions are durable metadata on visible messages without adding chat events", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-reactions-"));
  homes.push(home);
  const daemon = await startDaemon(home);

  try {
    const alice = await registerPeer(daemon.client, { sessionName: "alice", tool: "claude" });
    const bob = await registerPeer(daemon.client, { sessionName: "bob", tool: "codex" });
    const groupName = "reaction-room";
    await createGroup(daemon.client, { name: groupName, creatorPeerId: alice.peer.peer_id });
    await joinGroup(daemon.client, { name: groupName, peerId: alice.peer.peer_id, alias: "alice" });
    await joinGroup(daemon.client, { name: groupName, peerId: bob.peer.peer_id, alias: "bob" });

    const before = await fetch(`${daemon.client.baseUrl}/status`).then((res) => res.json()) as {
      counts: { events: number };
    };
    const sent = await sendGroupMessage(daemon.client, {
      name: groupName,
      senderPeerId: alice.peer.peer_id,
      message: "react to this",
    });

    const reaction = await reactToEvent(daemon.client, {
      eventId: sent.event.event_id,
      peerId: bob.peer.peer_id,
      emoji: "👍",
    });
    expect(reaction.changed).toBe(true);
    expect(reaction.active).toBe(true);
    expect(reaction.reactions).toEqual([
      expect.objectContaining({
        emoji: "👍",
        count: 1,
        by: [expect.objectContaining({ peer_id: bob.peer.peer_id, session_name: "bob", alias: "bob" })],
      }),
    ]);

    const aliceJoined = await reactToEvent(daemon.client, {
      eventId: sent.event.event_id,
      peerId: alice.peer.peer_id,
      emoji: "👍",
      op: "toggle",
    });
    expect(aliceJoined.active).toBe(true);
    expect(aliceJoined.reactions).toEqual([
      expect.objectContaining({
        emoji: "👍",
        count: 2,
        by: expect.arrayContaining([
          expect.objectContaining({ peer_id: bob.peer.peer_id }),
          expect.objectContaining({ peer_id: alice.peer.peer_id }),
        ]),
      }),
    ]);

    const aliceLeft = await reactToEvent(daemon.client, {
      eventId: sent.event.event_id,
      peerId: alice.peer.peer_id,
      emoji: "👍",
      op: "toggle",
    });
    expect(aliceLeft.active).toBe(false);
    expect(aliceLeft.reactions).toEqual([
      expect.objectContaining({
        emoji: "👍",
        count: 1,
        by: [expect.objectContaining({ peer_id: bob.peer.peer_id })],
      }),
    ]);

    const listed = await listEventReactions(daemon.client, { eventId: sent.event.event_id, peerId: alice.peer.peer_id });
    expect(listed.reactions[0]?.by[0]?.peer_id).toBe(bob.peer.peer_id);

    const history = await getGroupHistory(daemon.client, { name: groupName, peerId: alice.peer.peer_id });
    const historyEvent = history.events.find((event) => event.event_id === sent.event.event_id);
    expect(historyEvent?.reactions?.[0]?.emoji).toBe("👍");

    const webState = await fetch(
      `${daemon.client.baseUrl}/web/state?room=group:${sent.event.group_id}&peer_id=${encodeURIComponent(alice.peer.peer_id)}`,
    ).then((res) => res.json()) as { events: Event[] };
    expect(webState.events.find((event) => event.event_id === sent.event.event_id)?.reactions?.[0]?.count).toBe(1);

    const after = await fetch(`${daemon.client.baseUrl}/status`).then((res) => res.json()) as {
      counts: { events: number };
    };
    expect(after.counts.events).toBe(before.counts.events + 1);

    const removed = await reactToEvent(daemon.client, {
      eventId: sent.event.event_id,
      peerId: bob.peer.peer_id,
      emoji: "👍",
      op: "remove",
    });
    expect(removed.changed).toBe(true);
    expect(removed.active).toBe(false);
    expect(removed.reactions).toEqual([]);
  } finally {
    await daemon.stop();
  }
});

test("web events stream emits state_changed after a room message", async () => {
  const home = await mkdtemp(join(tmpdir(), "synchronize-web-events-"));
  homes.push(home);
  const daemon = await startDaemon(home);

  try {
    const alice = await registerPeer(daemon.client, { sessionName: "alice", tool: "claude" });
    const bob = await registerPeer(daemon.client, { sessionName: "bob", tool: "codex" });
    const groupName = "web-events-room";
    const group = await createGroup(daemon.client, { name: groupName, creatorPeerId: alice.peer.peer_id });
    await joinGroup(daemon.client, { name: groupName, peerId: alice.peer.peer_id, alias: "alice" });
    await joinGroup(daemon.client, { name: groupName, peerId: bob.peer.peer_id, alias: "bob" });

    const controller = new AbortController();
    const stream = await fetch(`${daemon.client.baseUrl}/web/events`, { signal: controller.signal });
    expect(stream.status).toBe(200);
    const reader = stream.body!.pipeThrough(new TextDecoderStream()).getReader();
    await sendGroupMessage(daemon.client, {
      name: groupName,
      senderPeerId: alice.peer.peer_id,
      message: "stream me",
    });

    const deadline = Date.now() + 2_000;
    let seen = false;
    let buffer = "";
    while (Date.now() < deadline && !seen) {
      const result = await Promise.race([
        reader.read(),
        Bun.sleep(100).then(() => null),
      ]);
      if (!result) continue;
      const { value } = result;
      buffer += value ?? "";
      seen = buffer.includes("event: state_changed") && buffer.includes(`\"group_id\":${group.group.group_id}`);
    }
    controller.abort();
    expect(seen).toBe(true);
  } finally {
    await daemon.stop();
  }
});
