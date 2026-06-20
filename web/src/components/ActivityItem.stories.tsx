import type { Meta, StoryObj } from "@storybook/react-vite";
import { ActivityItem } from "./ActivityItem.tsx";
import type { ActivityItem as ActivityItemModel } from "../data/types.ts";
import { AGENTS, GROUPS, MESSAGES } from "../data/seed.ts";

// Derive a few real messages from the checkout-revamp room to back the activity
// rows so the actor/room chips render against the same character set the design
// was tuned against — no duplicated fixtures.
const room = GROUPS.find((g) => g.id === "checkout-revamp")!;
const actorFor = (id: string) => AGENTS.find((a) => a.id === id)!;

const msgs = MESSAGES["checkout-revamp"]!;
const plainMsg = msgs[0]!; // vega, no mention
const mentionMsg = msgs[3]!; // "you" authored, mentions vega/cortex — reuse body as a @you preview
const threadMsg = msgs[4]!; // cortex, has thread replies

// The Activity feed model is its own projection (it is built from inbox + events
// in the live adapter); construct rows here rather than importing a seed export.
const baseRow = (over: Partial<ActivityItemModel>): ActivityItemModel => ({
  id: "act-base",
  eventId: 100,
  roomId: room.id,
  actorId: plainMsg.authorId,
  type: "message",
  text: plainMsg.body,
  createdAt: plainMsg.createdAt,
  awaiting: false,
  isMention: false,
  msgId: plainMsg.id,
  ...over,
});

const meta = {
  title: "Activity/ActivityItem",
  component: ActivityItem,
  args: {
    actor: actorFor(plainMsg.authorId),
    room,
    reacted: false,
    showRoom: true,
    onReact: () => {},
    onOpenThread: () => {},
    onJumpToRoom: () => {},
  },
} satisfies Meta<typeof ActivityItem>;

export default meta;
type Story = StoryObj<typeof meta>;

// A plain inbound message row: speech-bubble marker, no emphasis bar.
export const Message: Story = {
  args: { item: baseRow({}) },
};

// Mention row — the @-marker glyph and the highlighted @you hit inside the body.
export const Mention: Story = {
  args: {
    item: baseRow({
      id: "act-mention",
      eventId: 101,
      actorId: actorFor("cortex").id,
      text: "heads up @you — the canary is bumped to 5%, watching latency now.",
      isMention: true,
      msgId: mentionMsg.id,
    }),
    actor: actorFor("cortex"),
  },
};

// Awaiting (un-acked) row — left emphasis bar + "awaits" treatment. Actor is
// busy, so the marker carries the pulse dot.
export const Awaiting: Story = {
  args: {
    item: baseRow({
      id: "act-awaiting",
      eventId: 102,
      actorId: actorFor("cortex").id,
      text: "PR #4128 merged ✅ — running the abandoned-cart backfill now, ETA 22 min.",
      awaiting: true,
      isMention: true,
      msgId: threadMsg.id,
    }),
    actor: actorFor("cortex"),
  },
};

// Thread reply row — the reply (chat-bubble) marker keys off threadParentId.
export const ThreadReply: Story = {
  args: {
    item: baseRow({
      id: "act-reply",
      eventId: 103,
      actorId: actorFor("nova").id,
      text: "I'll add coverage on the coupon_id path before we flip the flag.",
      threadParentId: threadMsg.id,
      replyCount: 2,
      msgId: "m2-r2",
    }),
    actor: actorFor("nova"),
  },
};

// Already-reacted state in a DM-style context with the room chip hidden.
export const ReactedNoRoom: Story = {
  args: {
    item: baseRow({ id: "act-reacted", eventId: 104 }),
    reacted: true,
    showRoom: false,
  },
};
