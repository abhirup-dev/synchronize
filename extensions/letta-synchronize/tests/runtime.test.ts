import { expect, test } from "bun:test";
import type { Event } from "../../../src/api/types.ts";
import { LettaSynchronizeRuntime, type LettaSession, type LettaStreamMessage, type SynchronizeBus } from "../src/runtime.ts";

function event(id: number, body: string): Event {
  return {
    event_id: id,
    type: "dm",
    sender_peer_id: "peer-sender",
    recipient_peer_id: "peer-letta",
    group_id: null,
    group_name: null,
    body,
    media_id: null,
    parent_event_id: null,
    reply_to_event_id: null,
    mentions_json: null,
    skill_directives_json: null,
    created_at: "2026-06-01T00:00:00.000Z",
  };
}

class FakeSession implements LettaSession {
  sends: string[] = [];
  aborts = 0;
  private streams: LettaStreamMessage[][];

  constructor(streams: LettaStreamMessage[][]) {
    this.streams = streams;
  }

  async initialize() {
    return {
      agentId: "agent-1",
      sessionId: "session-1",
      conversationId: "conv-1",
      model: "zai/glm-4.7",
      tools: [],
    };
  }

  async send(message: string) {
    this.sends.push(message);
  }

  async *stream() {
    const messages = this.streams.shift() ?? [];
    for (const message of messages) yield message;
  }

  async abort() {
    this.aborts += 1;
  }

  close() {}
}

function fakeBus() {
  const replies: Array<{ eventId: number; message: string }> = [];
  const acked: number[] = [];
  const bus: SynchronizeBus = {
    async register(input) {
      return { peerId: input.peerId ?? "peer-letta", sessionName: input.sessionName };
    },
    async heartbeat() {},
    async setActivity() {},
    async readInbox() {
      return [];
    },
    async ack(_peerId, eventIds) {
      acked.push(...eventIds);
    },
    async reply(_peerId, eventId, message) {
      replies.push({ eventId, message });
    },
  };
  return { bus, replies, acked };
}

test("delivers a synchronize event into Letta and replies to the source event", async () => {
  const { bus, replies, acked } = fakeBus();
  const session = new FakeSession([[{ type: "result", success: true, result: "SYNC_LETTA_OK" }]]);
  const runtime = new LettaSynchronizeRuntime(bus, session, { sessionName: "letta", deliveryMode: "steer" });
  await runtime.initialize();
  await runtime.ingestEvents([event(1, "Reply with exactly: SYNC_LETTA_OK")]);
  await runtime.waitUntilIdle();

  expect(session.sends).toHaveLength(1);
  expect(session.sends[0]).toContain("<synchronize_event");
  expect(session.sends[0]).toContain("SYNC_LETTA_OK");
  expect(replies).toEqual([{ eventId: 1, message: "SYNC_LETTA_OK" }]);
  expect(acked).toEqual([1]);
});

test("emulates a three-baton flow by delivering each event into the same Letta session", async () => {
  const { bus, replies, acked } = fakeBus();
  const session = new FakeSession([
    [{ type: "result", success: true, result: "BATON_ONE" }],
    [{ type: "result", success: true, result: "BATON_TWO" }],
    [{ type: "result", success: true, result: "BATON_THREE" }],
  ]);
  const runtime = new LettaSynchronizeRuntime(bus, session, { sessionName: "letta", deliveryMode: "steer" });
  await runtime.initialize();
  await runtime.ingestEvents([
    event(1, "baton one"),
    event(2, "baton two"),
    event(3, "baton three"),
  ]);
  await runtime.waitUntilIdle();

  expect(session.sends).toHaveLength(3);
  expect(session.sends[0]).toContain("baton one");
  expect(session.sends[1]).toContain("baton two");
  expect(session.sends[2]).toContain("baton three");
  expect(replies).toEqual([
    { eventId: 1, message: "BATON_ONE" },
    { eventId: 2, message: "BATON_TWO" },
    { eventId: 3, message: "BATON_THREE" },
  ]);
  expect(acked).toEqual([1, 2, 3]);
});

test("interrupt mode aborts the active Letta turn and processes the newest event first", async () => {
  const { bus, replies, acked } = fakeBus();
  let releaseFirst: (() => void) | null = null;
  const session: LettaSession & { sends: string[]; aborts: number } = {
    sends: [],
    aborts: 0,
    async initialize() {
      return { agentId: "agent-1", sessionId: "session-1", conversationId: "conv-1", model: "zai/glm-4.7", tools: [] };
    },
    async send(message: string) {
      this.sends.push(message);
    },
    async *stream() {
      if (this.sends.length === 1) {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        yield { type: "result", success: true, result: "OLD" };
        return;
      }
      yield { type: "result", success: true, result: "NEW" };
    },
    async abort() {
      this.aborts += 1;
      releaseFirst?.();
    },
    close() {},
  };
  const runtime = new LettaSynchronizeRuntime(bus, session, { sessionName: "letta", deliveryMode: "interrupt" });
  await runtime.initialize();
  await runtime.ingestEvents([event(1, "old request")]);
  await Bun.sleep(0);
  await runtime.ingestEvents([event(2, "new request")]);
  await runtime.waitUntilIdle();

  expect(session.aborts).toBe(1);
  expect(session.sends).toHaveLength(2);
  expect(replies).toEqual([{ eventId: 2, message: "NEW" }]);
  expect(acked).toEqual([1, 2]);
});
