import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { ActivityItem } from "./ActivityItem.tsx";
import type { ActivityItem as ActivityItemModel } from "../data/types.ts";
import { AGENTS, DMS, GROUPS, MESSAGES } from "../data/seed.ts";

// Derive a few real messages from the checkout-revamp room to back the activity
// rows so the actor/room chips render against the same character set the design
// was tuned against — no duplicated fixtures.
const room = GROUPS.find((g) => g.id === "checkout-revamp")!;
const dmRoom = DMS.find((dm) => dm.id === "dm-atlas")!;
const actorFor = (id: string) => AGENTS.find((a) => a.id === id)!;

const msgs = MESSAGES["checkout-revamp"]!;
const msg = (id: string) => msgs.find((message) => message.id === id)!;
const plainMsg = msg("m1"); // vega, no mention
const mentionMsg = msg("m4"); // "you" authored, mentions vega/cortex — reuse body as a @you preview
const mergedMsg = msg("m5"); // cortex, has thread replies
const planThreadMsg = msg("m2"); // parent for m2-r2 thread reply

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

// A plain inbound top-level row: text-bubble marker, no emphasis bar.
export const TopLevelMessage: Story = {
  args: { item: baseRow({}) },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByLabelText("top-level message")).toBeVisible();
  },
};

// Legacy URL compatibility for older Storybook tabs/bookmarks:
// activity-activityitem--message now resolves to the canonical top-level state.
export const Message: Story = { ...TopLevelMessage, name: "Message (legacy)" };

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
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByLabelText("top-level message")).toBeVisible();
    await expect(canvas.getByLabelText("mentions you")).toBeVisible();
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
      msgId: mergedMsg.id,
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
      threadParentId: planThreadMsg.id,
      replyCount: 2,
      msgId: "m2-r2",
    }),
    actor: actorFor("nova"),
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByLabelText("thread reply")).toBeVisible();
  },
};

// Basic markdown preview stays compact but renders inline emphasis instead of
// leaking raw `**bold**` / `_italic_` syntax into Activity rows.
export const BasicMarkdownPreview: Story = {
  args: {
    item: baseRow({
      id: "act-basic-markdown",
      eventId: 105,
      actorId: actorFor("echo").id,
      text: "Here are your open TODOs grouped by recency/relevance: **This Week** and _next actions_ with `bd ready`.",
      awaiting: true,
      msgId: "basic-preview",
    }),
    actor: actorFor("echo"),
  },
  play: async ({ canvasElement }) => {
    const preview = canvasElement.querySelector<HTMLElement>(".act-row-preview");
    await expect(preview).toBeTruthy();
    await expect(preview?.textContent).not.toContain("**");
    await expect(preview?.querySelector("strong")?.textContent).toBe("This Week");
    await expect(preview?.querySelector("em")?.textContent).toBe("next actions");
    await expect(preview?.querySelector("code")?.textContent).toBe("bd ready");
  },
};

// Already-reacted state in a DM-style context with the room chip hidden.
export const DirectMessage: Story = {
  args: {
    item: baseRow({
      id: "act-dm",
      eventId: 104,
      roomId: dmRoom.id,
      actorId: "atlas",
      text: "want me to try another pass with a smaller patch?",
      msgId: "da1",
    }),
    actor: actorFor("atlas"),
    room: dmRoom,
    reacted: true,
    showRoom: false,
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByLabelText("direct message")).toBeVisible();
    // DM rows keep the author name: the activity grid aligns message text off a
    // fixed author column, so every row renders its chip.
    await expect(canvasElement.querySelector(".author-chip")).not.toBeNull();
  },
};
