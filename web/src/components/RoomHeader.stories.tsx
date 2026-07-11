import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { RoomHeader } from "./RoomHeader.tsx";
import { GROUPS, DMS } from "../data/seed.ts";
import { inMainColumn } from "../storybook/shellFrames.tsx";

// Provider-backed: RoomHeader reads agents via useAgents() and opens the chat-bg
// menu via useContextMenu() — both supplied by the global StorybookProviders
// decorator. The story only feeds the Room + UI-state props.
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
  // Mount in the main column with real shell context so the compact story
  // actually exercises RoomHeader's compact branch (the Settings sheet button).
  decorators: [inMainColumn],
  args: {
    tab: "chat",
    onTab: noop,
    theme: "paper",
    onToggleTheme: noop,
    skin: "brutal",
    onToggleSkin: noop,
    chatBg: "plain",
    onChatBg: noop,
  },
} satisfies Meta<typeof RoomHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

// Group room: boxed `#` glyph, plain title, full member pile, working count, and
// the AGENTS button.
export const Group: Story = {
  args: { room: group, showAgentsButton: true, onOpenAgents: noop },
  play: async ({ canvasElement }) => {
    const title = canvasElement.querySelector(".room-title");
    await expect(title?.textContent).toBe(group.name);
    // Room tabs now use the shared expanding-rail standard (Rail + RailSegment).
    const tabs = canvasElement.querySelectorAll("[data-rail-seg]");
    await expect(tabs.length).toBe(3);
    tabs.forEach((tab) => expect(tab.getAttribute("role")).toBe("tab"));
  },
};

// DM room: plain name (no `#`), two members, no agents button.
export const DirectMessage: Story = {
  args: { room: dm },
};

// Long title + long description exercise the ellipsis / min-width clamps, with
// the largest member pile (7 members → pile caps at 6 avatars).
export const LongTitleAndDescription: Story = {
  args: { room: longTitle, showAgentsButton: true, onOpenAgents: noop },
};

// A split thread keeps only its close action in the room header; the old
// "Thread · replying to" strip was removed because it overlapped the pane.
export const WithThreadCloseControl: Story = {
  args: { room: group, onCloseThread: noop },
};

// Glass skin + board tab selected — alternate visual state of the toggles/tabs.
export const GlassSkinBoardTab: Story = {
  args: { room: group, skin: "glass", tab: "board", theme: "ink" },
  globals: { skin: "glass" },
  play: async ({ canvasElement }) => {
    const strip = canvasElement.querySelector<HTMLElement>(".room-tabs");
    const boardFilters = canvasElement.querySelector<HTMLElement>('[aria-label="board filter"]');
    const roomSurface = canvasElement.querySelector<HTMLElement>('[aria-label="room surface"]');
    expect(strip).toBeTruthy();
    expect(boardFilters).toBeTruthy();
    expect(roomSurface).toBeTruthy();
    const filtersRect = boardFilters!.getBoundingClientRect();
    const surfaceRect = roomSurface!.getBoundingClientRect();
    await expect(filtersRect.right).toBeLessThanOrEqual(surfaceRect.left);
    await expect(getComputedStyle(strip!).overflowX).toBe("auto");
    await expect(getComputedStyle(boardFilters!).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    await expect(getComputedStyle(roomSurface!).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  },
};

// Compact (mobile-narrow, 390): title truncation, member-pile collapse, and the
// tab row at a thumb width — the Android header state.
export const Compact: Story = {
  args: { room: group, showAgentsButton: true, onOpenAgents: noop },
  globals: { viewport: { value: "mobileNarrow", isRotated: false } },
};
