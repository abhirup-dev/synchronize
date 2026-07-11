import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ackInbox,
  createGroup,
  heartbeatPeer,
  joinGroup,
  readInbox,
  registerAgentSession,
  registerPeer,
  replyToEvent,
  sendDm,
  sendGroupMessage,
  setPeerActivity,
} from "../../../src/api/index.ts";
import type { Event } from "../../../src/api/types.ts";
import type { ClientConfig } from "../../../src/client.ts";
import { LettaSynchronizeRuntime, type LettaSession, type LettaStreamMessage, type SynchronizeBus } from "../src/runtime.ts";

const homes: string[] = [];

afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true });
});

class FakeSession implements LettaSession {
  sends: string[] = [];

  constructor(private readonly streams: LettaStreamMessage[][]) {}

  async initialize() {
    return {
      agentId: "agent-test",
      sessionId: "session-test",
      conversationId: "conv-test",
      model: "zai/glm-4.7",
      tools: [],
    };
  }

  async send(message: string) {
    this.sends.push(message);
  }

  async *stream() {
    for (const message of this.streams.shift() ?? []) yield message;
  }

  async abort() {}

  close() {}
}

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

function realBus(client: ClientConfig, hostSessionId: string): SynchronizeBus {
  return {
    async register(input) {
      const binding = await registerAgentSession(client, {
        hostTool: "letta",
        hostSessionId,
        tool: "letta",
        source: "letta-code-sdk-test",
        agentType: "letta-code-sdk",
        sessionName: input.sessionName,
        purpose: input.purpose,
        ...(input.peerId ? { peerId: input.peerId } : {}),
        ...(input.model ? { model: input.model } : {}),
        ...(input.launchId ? { launchId: input.launchId } : {}),
        ...(input.metadata ? { metadata: input.metadata } : {}),
      });
      return { peerId: binding.binding.peer_id, sessionName: binding.binding.peer.session_name };
    },
    async heartbeat(peerId) {
      await heartbeatPeer(client, peerId);
    },
    async setActivity(peerId, state) {
      await setPeerActivity(client, { peerId, state });
    },
    async readInbox(peerId) {
      return (await readInbox(client, peerId)).events;
    },
    async ack(peerId, eventIds) {
      await ackInbox(client, peerId, eventIds);
    },
    async reply(peerId, eventId, message) {
      await replyToEvent(client, { senderPeerId: peerId, inReplyTo: eventId, message });
    },
  };
}

async function waitForInboxBodies(client: ClientConfig, peerId: string, count: number): Promise<Event[]> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const events = (await readInbox(client, peerId)).events.filter((event) => event.type === "dm" || event.type === "group_message");
    if (events.length >= count) return events;
    await Bun.sleep(20);
  }
  throw new Error(`expected ${count} inbox events`);
}

test("Letta runtime handles a real Synchronize DM flow", async () => {
  const home = await mkdtemp(join(tmpdir(), "sync-letta-dm-"));
  homes.push(home);
  const daemon = await startDaemon(home);
  try {
    const operator = await registerPeer(daemon.client, { sessionName: "operator", tool: "cli" });
    const session = new FakeSession([[{ type: "result", success: true, result: "DM_FLOW_OK" }]]);
    const runtime = new LettaSynchronizeRuntime(realBus(daemon.client, "letta-test-dm"), session, {
      sessionName: "letta",
      deliveryMode: "steer",
      pollMs: 10,
    });
    const registration = await runtime.initialize();
    await runtime.start();

    const sent = await sendDm(daemon.client, {
      senderPeerId: operator.peer.peer_id,
      recipientPeerId: registration.peerId,
      message: "reply with DM_FLOW_OK",
    });
    const replies = await waitForInboxBodies(daemon.client, operator.peer.peer_id, 1);
    await runtime.stop();

    expect(session.sends[0]).toContain("reply with DM_FLOW_OK");
    expect(replies[0]).toMatchObject({ body: "DM_FLOW_OK", reply_to_event_id: sent.event.event_id });
  } finally {
    await daemon.stop();
  }
});

test("Letta runtime emulates a three-baton group flow through real Synchronize inbox delivery", async () => {
  const home = await mkdtemp(join(tmpdir(), "sync-letta-baton-"));
  homes.push(home);
  const daemon = await startDaemon(home);
  try {
    const operator = await registerPeer(daemon.client, { sessionName: "operator", tool: "cli" });
    await createGroup(daemon.client, { name: "baton" });
    await joinGroup(daemon.client, { name: "baton", peerId: operator.peer.peer_id, alias: "operator", fresh: true });

    const session = new FakeSession([
      [{ type: "result", success: true, result: "BATON_ONE" }],
      [{ type: "result", success: true, result: "BATON_TWO" }],
      [{ type: "result", success: true, result: "BATON_THREE" }],
    ]);
    const runtime = new LettaSynchronizeRuntime(realBus(daemon.client, "letta-test-baton"), session, {
      sessionName: "letta",
      deliveryMode: "steer",
      pollMs: 10,
    });
    const registration = await runtime.initialize();
    await joinGroup(daemon.client, { name: "baton", peerId: registration.peerId, alias: "letta", fresh: true });
    await runtime.start();

    const one = await sendGroupMessage(daemon.client, { name: "baton", senderPeerId: operator.peer.peer_id, message: "baton one" });
    const two = await sendGroupMessage(daemon.client, { name: "baton", senderPeerId: operator.peer.peer_id, message: "baton two" });
    const three = await sendGroupMessage(daemon.client, { name: "baton", senderPeerId: operator.peer.peer_id, message: "baton three" });
    const replies = await waitForInboxBodies(daemon.client, operator.peer.peer_id, 3);
    await runtime.stop();

    expect(session.sends.map((send) => send.match(/baton (one|two|three)/)?.[0])).toEqual(["baton one", "baton two", "baton three"]);
    expect(replies.map((reply) => reply.body)).toEqual(["BATON_ONE", "BATON_TWO", "BATON_THREE"]);
    expect(replies.map((reply) => reply.reply_to_event_id)).toEqual([one.event.event_id, two.event.event_id, three.event.event_id]);
  } finally {
    await daemon.stop();
  }
});
