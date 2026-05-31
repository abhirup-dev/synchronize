import { afterEach, expect, test } from "bun:test";
import { DaemonDataSource } from "../web/src/data/daemon.ts";
import type { Message } from "../web/src/data/types.ts";
import type { MutableSnapshot } from "../web/src/data/store.ts";

const originalFetch = globalThis.fetch;
const originalLocalStorage = globalThis.localStorage;

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.localStorage = originalLocalStorage;
});

function stubFetch(handler: (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => Promise<Response>): typeof fetch {
  const fn = handler as typeof fetch;
  fn.preconnect = originalFetch.preconnect.bind(originalFetch);
  return fn;
}

test("web reactions update message snapshots without resetting room state", async () => {
  const ds = new DaemonDataSource({ baseUrl: "http://daemon.test" });
  (ds as unknown as { peerId: string }).peerId = "web:local-human";

  const roomId = "group:1";
  const messages = ds.messages(roomId) as MutableSnapshot<Message[]>;
  messages.set([
    {
      id: "e:42",
      roomId,
      authorId: "agent:one",
      body: "react here",
      createdAt: "2026-05-31T00:00:00.000Z",
      mentions: [],
      reactions: [],
    },
  ]);

  const calls: Array<{ path: string; method: string; body: unknown }> = [];
  const responseFor = (reactions: Array<{ emoji: string; by: string[] }>) =>
    new Response(JSON.stringify({
      event: {
        event_id: 42,
        type: "group_message",
        sender_peer_id: "agent:one",
        recipient_peer_id: null,
        group_id: 1,
        body: "react here",
        media_id: null,
        parent_event_id: null,
        mentions_json: null,
        skill_directives_json: null,
        created_at: "2026-05-31T00:00:00.000Z",
        reactions: reactions.map((reaction) => ({
          emoji: reaction.emoji,
          count: reaction.by.length,
          by: reaction.by.map((peerId) => ({
            peer_id: peerId,
            session_name: peerId,
            tool: "web",
            alias: peerId === "web:local-human" ? "you" : null,
            created_at: "2026-05-31T00:00:01.000Z",
          })),
        })),
      },
    }));

  globalThis.fetch = stubFetch(async (input, init) => {
    const url = new URL(String(input));
    calls.push({ path: url.pathname, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url.pathname !== "/events/42/reactions") throw new Error(`unexpected fetch: ${url.pathname}`);
    return responseFor([{ emoji: "👍", by: ["web:local-human"] }]);
  });

  const add = ds.reactToMessage({ messageId: "e:42", roomId, emoji: "👍", op: "toggle" });
  expect(messages.get()[0]?.reactions).toEqual([{ emoji: "👍", by: ["web:local-human"] }]);
  await add;
  expect(messages.get()[0]?.reactions).toEqual([{ emoji: "👍", by: ["web:local-human"] }]);

  globalThis.fetch = stubFetch(async (input, init) => {
    const url = new URL(String(input));
    calls.push({ path: url.pathname, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url.pathname !== "/events/42/reactions") throw new Error(`unexpected fetch: ${url.pathname}`);
    return responseFor([]);
  });

  const remove = ds.reactToMessage({ messageId: "e:42", roomId, emoji: "👍", op: "toggle" });
  expect(messages.get()[0]?.reactions).toEqual([]);
  await remove;
  expect(messages.get()[0]?.reactions).toEqual([]);
  expect(calls.map((call) => call.path)).toEqual(["/events/42/reactions", "/events/42/reactions"]);
  expect(calls.every((call) => call.method === "POST")).toBe(true);
  expect(calls.some((call) => call.path === "/web/state")).toBe(false);
});

test("daemon data source maps skill catalog from web state", () => {
  globalThis.localStorage = { getItem: () => null } as unknown as Storage;
  const ds = new DaemonDataSource({ baseUrl: "http://daemon.test" });
  (ds as unknown as { peerId: string }).peerId = "web:local-human";

  (ds as unknown as { applySummaryState(state: unknown): void }).applySummaryState({
    ok: true,
    cursor: 0,
    launch_tools: {},
    peers: [],
    groups: [],
    group_paths: [],
    memberships: [],
    room_summaries: [],
    events: [],
    media: [],
    skill_catalog: [
      {
        id: "diagnose",
        name: "diagnose",
        description: "Diagnosis loop",
        runtimes: ["claude", "pi"],
        source_path: "/tmp/diagnose/SKILL.md",
      },
    ],
  });

  expect(ds.skillCatalog().get()).toEqual([
    {
      id: "diagnose",
      name: "diagnose",
      description: "Diagnosis loop",
      runtimes: ["claude", "pi"],
      sourcePath: "/tmp/diagnose/SKILL.md",
    },
  ]);
});

test("daemon data source sends selected skill directives with group messages", async () => {
  const ds = new DaemonDataSource({ baseUrl: "http://daemon.test" });
  (ds as unknown as { peerId: string }).peerId = "web:local-human";
  (ds as unknown as { groupNameByRoomId: Map<string, string> }).groupNameByRoomId = new Map([["group:1", "room"]]);

  const calls: Array<{ path: string; method: string; body: unknown }> = [];
  globalThis.fetch = stubFetch(async (input, init) => {
    const url = new URL(String(input));
    calls.push({ path: url.pathname, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url.pathname === "/groups/room/messages") {
      return new Response(JSON.stringify({
        event: {
          event_id: 77,
          type: "group_message",
          sender_peer_id: "web:local-human",
          recipient_peer_id: null,
          group_id: 1,
          body: "please inspect @bob",
          media_id: null,
          parent_event_id: null,
          mentions_json: '["peer:bob"]',
          skill_directives_json: '["diagnose"]',
          created_at: "2026-05-31T00:00:00.000Z",
        },
      }));
    }
    if (url.pathname === "/web/state") {
      return new Response(JSON.stringify({
        ok: true,
        cursor: 77,
        launch_tools: {},
        peers: [],
        groups: [],
        group_paths: [],
        memberships: [],
        room_summaries: [],
        events: [],
        media: [],
        skill_catalog: [],
      }));
    }
    throw new Error(`unexpected fetch: ${url.pathname}`);
  });

  await ds.sendMessage({
    roomId: "group:1",
    body: "please inspect @bob",
    mentions: ["peer:bob"],
    skillDirectives: ["diagnose"],
  });

  expect(calls[0]).toEqual({
    path: "/groups/room/messages",
    method: "POST",
    body: {
      sender_peer_id: "web:local-human",
      message: "please inspect @bob",
      skill_directives: ["diagnose"],
    },
  });
});
