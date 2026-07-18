import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { RoomHeader } from "./RoomHeader.tsx";
import { GROUPS, DMS } from "../data/seed.ts";
import { inChatSurface } from "../storybook/shellFrames.tsx";

// Provider-backed: RoomHeader reads agents via useAgents(); the story feeds only
// real room and shell state while global Storybook traits own Sigil light/dark.
const group = GROUPS.find((r) => r.id === "checkout-revamp")!;
const dm = DMS.find((r) => r.id === "dm-cortex")!;
const longTitle = {
  ...GROUPS.find((r) => r.id === "heartbeat-checks")!,
  name: "heartbeat-checks-cross-region-failover-and-incident-escalation",
  description:
    "Standing room for the on-call rotation: heartbeat polls, escalation ladders, and post-incident retros across every regional cluster we operate.",
};

const noop = () => {};

const meta = {
  title: "Navigation/RoomHeader",
  component: RoomHeader,
  parameters: { layout: "fullscreen" },
  // Mount inside the chat column exactly as the app does (main column ›
  // main-body › chat column) — the unified top bar is chat-column chrome, so a
  // thread pane can run full-height beside it.
  decorators: [inChatSurface],
  args: {
    tab: "chat",
    onTab: noop,
  },
} satisfies Meta<typeof RoomHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

// Group room: single Sigil row — `#` title, inline mono meta, text segmented
// tabs, and the overlapping member crew as the roster trigger.
export const Group: Story = {
  args: { room: group, onOpenAgents: noop },
  play: async ({ canvasElement }) => {
    const title = canvasElement.querySelector(".top-bar-title");
    await expect(title?.textContent).toBe(`#${group.name}`);
    const tabs = canvasElement.querySelectorAll('[aria-label="room surface"] [role="tab"]');
    await expect(tabs.length).toBe(3);
    await expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
    // The crew cluster shows the room's agents (operator excluded) and opens
    // the roster panel.
    const crew = canvasElement.querySelector<HTMLElement>(".room-crew");
    await expect(crew).toBeTruthy();
    await expect(crew!.querySelectorAll(".identity-icon").length).toBeGreaterThan(0);
  },
};

// DM room: plain name (no `#`), no meta line unless the room has one.
export const DirectMessage: Story = {
  args: { room: dm },
};

// Long title + long meta exercise the single-row ellipsis clamps with the
// largest crew (7 members → operator excluded).
export const LongTitleAndDescription: Story = {
  args: { room: longTitle, onOpenAgents: noop },
};

// Board tab selected — the segmented control carries the active surface.
export const BoardTab: Story = {
  args: { room: group, tab: "board" },
  play: async ({ canvasElement }) => {
    const active = canvasElement.querySelector('[role="tab"][aria-selected="true"]');
    await expect(active?.textContent).toBe("Board");
  },
};

// Compact (mobile-narrow, 390): title truncation and the settings button; the
// room surface lives in the bottom nav in compact, so no tabs render here.
export const Compact: Story = {
  args: { room: group, onOpenAgents: noop },
  globals: { viewport: { value: "mobileNarrow", isRotated: false } },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('[aria-label="room surface"]')).toBeNull();
    await expect(canvasElement.querySelector('[aria-label="open display settings"]')).toBeTruthy();
  },
};
