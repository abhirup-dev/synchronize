import { afterEach, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { createGroup, joinGroup, sendGroupMessage } from "../src/api/groups.ts";
import { sendDm } from "../src/api/inbox.ts";
import { registerPeer } from "../src/api/peers.ts";
import { startDaemon, type TestDaemon } from "./support/daemon.ts";

const homes: string[] = [];

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

async function daemon(): Promise<TestDaemon> {
  const started = await startDaemon();
  homes.push(started.home);
  return started;
}

interface ResolveResponse {
  target: {
    event_id: number;
    room_id: string;
    surface: "dm" | "group-main" | "group-thread";
    group_id: number | null;
    parent_event_id: number | null;
    focus_event_id: number;
  };
  event: { event_id: number };
  root_event: { event_id: number } | null;
}

async function resolve(d: TestDaemon, eventId: number | string, peerId?: string): Promise<Response> {
  const params = new URLSearchParams({ event_id: String(eventId) });
  if (peerId !== undefined) params.set("peer_id", peerId);
  return fetch(`${d.baseUrl}/web/resolve?${params.toString()}`);
}

async function webState(d: TestDaemon, params: Record<string, string>): Promise<{
  events: Array<{ event_id: number }>;
  target?: { event_id: number; included: boolean; before_count: number; after_count: number };
}> {
  const response = await fetch(`${d.baseUrl}/web/state?${new URLSearchParams(params).toString()}`);
  if (!response.ok) throw new Error(`web/state ${response.status}: ${await response.text()}`);
  return response.json() as Promise<{ events: Array<{ event_id: number }>; target?: { event_id: number; included: boolean; before_count: number; after_count: number } }>;
}

async function setup(d: TestDaemon) {
  const alice = (await registerPeer(d.client, { sessionName: "alice", tool: "cli" })).peer;
  const bob = (await registerPeer(d.client, { sessionName: "bob", tool: "cli" })).peer;
  const group = (await createGroup(d.client, { name: "deeplink-room", creatorPeerId: alice.peer_id })).group;
  await joinGroup(d.client, { name: group.name, peerId: alice.peer_id, alias: "alice" });
  await joinGroup(d.client, { name: group.name, peerId: bob.peer_id, alias: "bob" });
  return { alice, bob, group };
}

test("/web/resolve derives group-main, group-thread, and dm targets", async () => {
  const d = await daemon();
  try {
    const { alice, bob, group } = await setup(d);

    const root = (await sendGroupMessage(d.client, { name: group.name, senderPeerId: alice.peer_id, message: "root" })).event;
    const reply = (await sendGroupMessage(d.client, { name: group.name, senderPeerId: bob.peer_id, message: "reply", inReplyTo: root.event_id })).event;
    const dm = (await sendDm(d.client, { senderPeerId: alice.peer_id, recipientPeerId: bob.peer_id, message: "hi bob" })).event;

    const mainRes = await resolve(d, root.event_id, alice.peer_id);
    expect(mainRes.status).toBe(200);
    const main = (await mainRes.json()) as ResolveResponse;
    expect(main.target).toMatchObject({
      event_id: root.event_id,
      room_id: `group:${group.group_id}`,
      surface: "group-main",
      group_id: group.group_id,
      parent_event_id: null,
      focus_event_id: root.event_id,
    });
    expect(main.root_event).toBeNull();

    const thread = (await (await resolve(d, reply.event_id, alice.peer_id)).json()) as ResolveResponse;
    expect(thread.target).toMatchObject({
      room_id: `group:${group.group_id}`,
      surface: "group-thread",
      parent_event_id: root.event_id,
      focus_event_id: reply.event_id,
    });
    expect(thread.root_event?.event_id).toBe(root.event_id);

    // DM room id is derived relative to the resolving peer (the "other" side).
    const dmAsAlice = (await (await resolve(d, dm.event_id, alice.peer_id)).json()) as ResolveResponse;
    expect(dmAsAlice.target).toMatchObject({ surface: "dm", room_id: `dm:${bob.peer_id}`, parent_event_id: null });
    const dmAsBob = (await (await resolve(d, dm.event_id, bob.peer_id)).json()) as ResolveResponse;
    expect(dmAsBob.target.room_id).toBe(`dm:${alice.peer_id}`);
  } finally {
    await d.stop();
  }
});

test("/web/resolve enforces auth args and visibility", async () => {
  const d = await daemon();
  try {
    const { alice, bob, group } = await setup(d);
    const carol = (await registerPeer(d.client, { sessionName: "carol", tool: "cli" })).peer;
    const root = (await sendGroupMessage(d.client, { name: group.name, senderPeerId: alice.peer_id, message: "root" })).event;
    const dm = (await sendDm(d.client, { senderPeerId: alice.peer_id, recipientPeerId: bob.peer_id, message: "secret" })).event;

    expect((await resolve(d, root.event_id)).status).toBe(400); // missing peer_id
    expect((await resolve(d, "abc", alice.peer_id)).status).toBe(400); // non-numeric event id
    expect((await resolve(d, 999999, alice.peer_id)).status).toBe(404); // unknown event
    expect((await resolve(d, dm.event_id, carol.peer_id)).status).toBe(404); // DM not visible to carol
    expect((await resolve(d, root.event_id, carol.peer_id)).status).toBe(404); // non-member can't see group event
  } finally {
    await d.stop();
  }
});

test("/web/state?around_event_id hydrates targets outside the latest window", async () => {
  const d = await daemon();
  try {
    const { alice, bob, group } = await setup(d);
    const room = `group:${group.group_id}`;

    const oldRoot = (await sendGroupMessage(d.client, { name: group.name, senderPeerId: alice.peer_id, message: "old root" })).event;
    const oldReply = (await sendGroupMessage(d.client, { name: group.name, senderPeerId: bob.peer_id, message: "old reply", inReplyTo: oldRoot.event_id })).event;
    // Bury the target well beyond the default 50-event latest window.
    for (let i = 0; i < 60; i += 1) {
      await sendGroupMessage(d.client, { name: group.name, senderPeerId: alice.peer_id, message: `filler ${i}` });
    }

    const latest = await webState(d, { room, peer_id: alice.peer_id });
    expect(latest.events.some((event) => event.event_id === oldRoot.event_id)).toBe(false);
    expect(latest.target).toBeUndefined();

    const around = await webState(d, { room, peer_id: alice.peer_id, around_event_id: String(oldRoot.event_id) });
    expect(around.events.some((event) => event.event_id === oldRoot.event_id)).toBe(true);
    expect(around.target).toMatchObject({ event_id: oldRoot.event_id, included: true });
    expect(around.target!.after_count).toBeGreaterThan(0);

    // A thread reply target pulls in its root even when the root is off-window.
    const aroundReply = await webState(d, { room, peer_id: alice.peer_id, around_event_id: String(oldReply.event_id) });
    expect(aroundReply.events.some((event) => event.event_id === oldReply.event_id)).toBe(true);
    expect(aroundReply.events.some((event) => event.event_id === oldRoot.event_id)).toBe(true);
  } finally {
    await d.stop();
  }
});

test("/web/state?around_event_id hydrates an old DM target", async () => {
  const d = await daemon();
  try {
    const { alice, bob } = await setup(d);
    const room = `dm:${bob.peer_id}`;

    const oldDm = (await sendDm(d.client, { senderPeerId: alice.peer_id, recipientPeerId: bob.peer_id, message: "old dm" })).event;
    for (let i = 0; i < 60; i += 1) {
      await sendDm(d.client, { senderPeerId: alice.peer_id, recipientPeerId: bob.peer_id, message: `dm filler ${i}` });
    }

    const latest = await webState(d, { room, peer_id: alice.peer_id });
    expect(latest.events.some((event) => event.event_id === oldDm.event_id)).toBe(false);

    const around = await webState(d, { room, peer_id: alice.peer_id, around_event_id: String(oldDm.event_id) });
    expect(around.events.some((event) => event.event_id === oldDm.event_id)).toBe(true);
    expect(around.target).toMatchObject({ event_id: oldDm.event_id, included: true });
  } finally {
    await d.stop();
  }
});
