import type { Meta, StoryObj } from "@storybook/react-vite";
import { useRef, useState } from "react";
import { ThreadSummaryPanel } from "./ThreadSummaryPanel.tsx";
import type { Message } from "../data/types.ts";
import { AGENTS, MESSAGES } from "../data/seed.ts";

// ThreadSummaryPanel only renders dots for messages with threadReplyCount > 0,
// and positions each row via a rAF loop that reads getAnchorTop(id) (the row's
// center in chat-content coordinates). With no live chat list those anchors are
// null and every row hides itself, so the harness below supplies a stub
// chatListRef plus a getAnchorTop that staggers the threaded roots down the
// track — giving the panel something real to lay out. Summary prose is read
// per-row through useThreadSummary() off the MockDataSource from the global
// StorybookProviders decorator (THREAD_SUMMARIES has entries for m2 and m5).
function PanelHarness({ messages }: { messages: Message[] }) {
  const [width, setWidth] = useState(340);
  const chatListRef = useRef<HTMLDivElement | null>(null);

  // Center each threaded root evenly down a tall virtual track.
  const threaded = messages.filter((m) => (m.threadReplyCount ?? 0) > 0);
  const anchors = new Map<string, number>();
  threaded.forEach((m, i) => anchors.set(m.id, 120 + i * 220));
  const contentHeight = 120 + threaded.length * 220 + 200;

  return (
    <div className="flex h-screen bg-paper">
      <ThreadSummaryPanel
        messages={messages}
        agents={AGENTS}
        width={width}
        onWidthChange={setWidth}
        onJumpTo={() => {}}
        chatListRef={chatListRef}
        getAnchorTop={(id) => anchors.get(id) ?? null}
        getContentHeight={() => contentHeight}
      />
      {/* Stand-in for the chat list the panel mirrors. */}
      <div
        ref={chatListRef}
        className="relative flex-1 overflow-auto bg-paper-2"
        style={{ minHeight: 0 }}
      >
        <div style={{ height: contentHeight }} />
      </div>
    </div>
  );
}

// Surface exemplar: fullscreen layout, provider-backed via the global decorator.
const meta = {
  title: "Surfaces/ThreadSummaryPanel",
  component: ThreadSummaryPanel,
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj;

// checkout-revamp has two threaded roots (m2, m5), both with seeded summaries.
export const Populated: Story = {
  render: () => <PanelHarness messages={MESSAGES["checkout-revamp"]!} />,
};

// heartbeat-checks has a single threaded root (hb-poll), also seeded — a sparser
// single-summary layout.
export const SingleThread: Story = {
  render: () => <PanelHarness messages={MESSAGES["heartbeat-checks"]!} />,
};

// infra-oncall has messages but zero threaded roots — the faithful empty
// "no threads" state. (ml-ranking is NOT empty: its `ml-deepdive` root carries
// threadReplyCount 14 — the prior pick silently stopped exercising this state.)
export const Empty: Story = {
  render: () => <PanelHarness messages={MESSAGES["infra-oncall"]!} />,
};
