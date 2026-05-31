import { afterEach, expect, test } from "bun:test";
import { DaemonDataSource } from "../web/src/data/daemon.ts";
import type { Message } from "../web/src/data/types.ts";
import type { MutableSnapshot } from "../web/src/data/store.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
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
