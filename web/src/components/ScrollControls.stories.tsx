import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useRef, useState } from "react";
import { within, userEvent, expect, waitFor } from "storybook/test";
import { ScrollControls } from "./ScrollControls.tsx";

// ScrollControls is a pure DOM-driven overlay: it watches a real scrollable
// element through `targetRef` and only renders a pill while that element
// carries the `.is-scrolling` class (added by useAutoScrollbar) or while
// `newItemsKey` flags unread content below the fold. There is no DataSource
// dependency, so these stories supply a self-contained scrollable surface and
// drive the relevant states directly.

interface HarnessProps {
  // Keep `.is-scrolling` on the target so the directional pill stays visible
  // for inspection (the real surface only flashes it during active scrolling).
  forceScrolling?: boolean;
  // Bump this to simulate a freshly-arrived message while scrolled away from
  // the bottom — drives the neutral "new items below" pop state.
  newItemsKey?: number | null;
  // Start scrolled to the bottom (atBottom => nothing to jump to going down).
  startAtBottom?: boolean;
  // Scroll the surface to this offset (px) on mount. Setting scrollTop fires a
  // real scroll event, which is how ScrollControls learns the direction — the
  // down pill only shows once a downward scroll has registered `dir = "down"`
  // (matching the app: the pill is direction-aware, not just is-scrolling-aware).
  scrollTopPx?: number;
}

function Harness({ forceScrolling = false, newItemsKey = null, startAtBottom = false, scrollTopPx }: HarnessProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (startAtBottom) el.scrollTop = el.scrollHeight - el.clientHeight;
    else if (scrollTopPx !== undefined) el.scrollTop = scrollTopPx;
    el.classList.toggle("is-scrolling", forceScrolling);
  }, [forceScrolling, startAtBottom, scrollTopPx]);

  return (
    <div style={{ position: "relative", height: 420, width: 360, margin: "0 auto" }}>
      <div
        ref={ref}
        className="thin-scroll"
        style={{ position: "absolute", inset: 0, overflowY: "auto", padding: "12px 16px" }}
      >
        {Array.from({ length: 40 }, (_, i) => (
          <p key={i} style={{ margin: "0 0 14px", fontFamily: "var(--font-display, monospace)", fontSize: 13, opacity: 0.7 }}>
            line {i + 1} — scrollable surface content
          </p>
        ))}
      </div>
      <ScrollControls targetRef={ref} newItemsKey={newItemsKey} />
    </div>
  );
}

const meta = {
  title: "Surfaces/ScrollControls",
  component: ScrollControls,
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj;

// Idle: target not scrolling, no new items, sitting at the top — the control
// renders nothing (its resting state on a calm surface).
export const Hidden: Story = {
  render: () => <Harness />,
};

// Active downward scroll away from the top: a real downward scroll registers
// `dir = "down"` and `.is-scrolling` is held on, so the down (↓) jump pill shows.
export const ScrollingDown: Story = {
  render: () => <Harness forceScrolling scrollTopPx={120} />,
};

// Fresh message arrived while the user is scrolled up — the neutral "new items
// below" pill pops regardless of the scrolling window.
export const NewItemsBelow: Story = {
  render: () => <Harness newItemsKey={1} />,
};

// Clicking the down pill jumps the surface to the bottom and the control
// retires (atBottom => nothing left to jump to).
export const JumpToBottom: Story = {
  render: () => <Harness newItemsKey={1} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = await canvas.findByRole("button", { name: "scroll to bottom" });
    await userEvent.click(button);
    await waitFor(() => {
      expect(canvas.queryByRole("button", { name: "scroll to bottom" })).toBeNull();
    });
  },
};
