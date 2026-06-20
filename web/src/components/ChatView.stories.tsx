import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChatView } from "./ChatView.tsx";
import { GROUPS, DMS } from "../data/seed.ts";

const group = GROUPS.find((r) => r.id === "checkout-revamp")!;
const pollRoom = GROUPS.find((r) => r.id === "heartbeat-checks")!;
const quietGroup = GROUPS.find((r) => r.id === "design-system")!;
const dm = DMS.find((r) => r.id === "dm-cortex")!;

// Provider-backed surface: ChatView reads messages/agents/me through the
// DataSource hooks supplied by the global StorybookProviders decorator, so the
// story only needs to hand it a Room.
const meta = {
  title: "Surfaces/ChatView",
  component: ChatView,
  parameters: { layout: "fullscreen" },
  args: { room: group, onOpenThread: () => {}, onToggleThreadSummary: () => {}, onOpenCommunity: () => {} },
} satisfies Meta<typeof ChatView>;

export default meta;
type Story = StoryObj<typeof meta>;

// Busiest room: markdown, fenced SQL, reactions, thread badges, plus the
// timeline rail rendered alongside the message list.
export const GroupConversation: Story = {
  args: { room: group },
};

// Two-party room — no timeline rail noise, single message bubble.
export const DirectMessage: Story = {
  args: { room: dm },
};

// Sparse room (single message) — exercises the near-empty layout.
export const Quiet: Story = {
  args: { room: quietGroup },
};

// Room whose feed carries a poll and a long thread, with the Thread Summary
// side panel pinned open.
export const WithThreadSummary: Story = {
  args: { room: pollRoom, threadSummaryOpen: true },
};

// Thread open alongside the chat: the timeline rail collapses (isThreadOpen)
// and the composer renders in its collapsed-default state.
export const ThreadOpen: Story = {
  args: { room: group, isThreadOpen: true },
};
