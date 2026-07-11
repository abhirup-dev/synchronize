// Activity feed behavior against the MockDataSource — the in-memory analogue of
// the daemon's observer feed. Verifies aggregation/ordering, filters, the
// awaiting model, and that react/reply/mark-all clear awaiting (the parity the
// daemon enforces server-side via peer_thread_interactions).

import { describe, expect, test } from "bun:test";
import { MockDataSource } from "./mock.ts";

function freshFeed() {
  const ds = new MockDataSource();
  return { ds, items: ds.activity().get(), me: ds.me().get().id };
}

describe("activity feed (mock)", () => {
  test("aggregates cross-room, newest-first, excludes own sends", () => {
    const { items, me } = freshFeed();
    expect(items.length).toBeGreaterThan(0);
    // newest-first by eventId
    for (let i = 1; i < items.length; i++) {
      expect(items[i - 1]!.eventId).toBeGreaterThan(items[i]!.eventId);
    }
    // observer feed never surfaces the user's own messages
    expect(items.every((item) => item.actorId !== me)).toBe(true);
    // spans more than one room (genuinely cross-room)
    expect(new Set(items.map((item) => item.roomId)).size).toBeGreaterThan(1);
  });

  test("shows only the latest message per actor within a thread", () => {
    const { items } = freshFeed();
    const keys = items.map((item) => `${item.roomId}:${item.threadParentId ?? item.msgId}:${item.actorId}`);
    expect(new Set(keys).size).toBe(keys.length);

    const mlDeepdiveRows = items.filter((item) => item.threadParentId === "ml-deepdive");
    expect(mlDeepdiveRows.map((item) => item.actorId).sort()).toEqual(["echo", "pulse", "vega"]);
    expect(mlDeepdiveRows.map((item) => item.msgId).sort()).toEqual(["mld-r11", "mld-r13", "mld-r14"]);
  });

  test("awaiting count matches the awaiting items", () => {
    const { ds, items } = freshFeed();
    expect(ds.activityAwaitingCount().get()).toBe(items.filter((item) => item.awaiting).length);
  });

  test("Mentions filter is a strict, non-empty subset (no false positives)", () => {
    const { items } = freshFeed();
    const mentions = items.filter((item) => item.isMention);
    // There are real mentions of you in the seed…
    expect(mentions.length).toBeGreaterThan(0);
    // …but not everything is a mention — the design's bug was false positives.
    expect(mentions.length).toBeLessThan(items.length);
    // every flagged mention is an awaiting item (mention ⇒ needs you)
    expect(mentions.every((item) => item.awaiting)).toBe(true);
  });

  test("react clears the item from awaiting and ticks the count down", async () => {
    const { ds } = freshFeed();
    const before = ds.activityAwaitingCount().get();
    const target = ds.activity().get().find((item) => item.awaiting);
    expect(target).toBeDefined();
    await ds.reactToMessage({ messageId: target!.msgId, roomId: target!.roomId, emoji: "👍", op: "add" });
    const after = ds.activity().get();
    expect(after.find((item) => item.eventId === target!.eventId)!.awaiting).toBe(false);
    expect(ds.activityAwaitingCount().get()).toBeLessThan(before);
  });

  test("replying in a thread clears its parent from awaiting", async () => {
    const { ds } = freshFeed();
    const parent = ds.activity().get().find((item) => item.awaiting);
    expect(parent).toBeDefined();
    await ds.sendMessage({ roomId: parent!.roomId, body: "on it", mentions: [], parentMessageId: parent!.msgId });
    expect(ds.activity().get().find((item) => item.eventId === parent!.eventId)!.awaiting).toBe(false);
  });

  test("explicit ack and mark-all-handled clear awaiting", async () => {
    const { ds } = freshFeed();
    const target = ds.activity().get().find((item) => item.awaiting)!;
    await ds.ackActivity(target.eventId);
    expect(ds.activity().get().find((item) => item.eventId === target.eventId)!.awaiting).toBe(false);

    await ds.ackAllActivity();
    expect(ds.activityAwaitingCount().get()).toBe(0);
    expect(ds.activity().get().every((item) => !item.awaiting)).toBe(true);
  });
});
