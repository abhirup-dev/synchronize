import type { Meta, StoryObj } from "@storybook/react-vite";
import { RoomHeader } from "./RoomHeader.tsx";
import { AGENTS, GROUPS, DMS } from "../data/seed.ts";

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
const atlas = AGENTS.find((a) => a.id === "atlas")!;

const noop = () => {};

const meta = {
  title: "Navigation/RoomHeader",
  component: RoomHeader,
  parameters: { layout: "fullscreen" },
  args: {
    tab: "chat",
    onTab: noop,
    theme: "paper",
    themeIcon: "☀️",
    onToggleTheme: noop,
    skin: "brutal",
    onToggleSkin: noop,
    chatBg: "plain",
    onChatBg: noop,
  },
} satisfies Meta<typeof RoomHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

// Group room: `#name`, full member pile, working count, and the AGENTS button.
export const Group: Story = {
  args: { room: group, showAgentsButton: true, onOpenAgents: noop },
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

// Thread banner replaces the room-activity strip in the tab row.
export const WithThreadBanner: Story = {
  args: {
    room: group,
    showAgentsButton: true,
    onOpenAgents: noop,
    threadBanner: { author: atlas, onClose: noop },
  },
};

// Glass skin + board tab selected — alternate visual state of the toggles/tabs.
export const GlassSkinBoardTab: Story = {
  args: { room: group, skin: "glass", tab: "board", themeIcon: "🌙", theme: "ink" },
};

// Compact (mobile-narrow, 390): title truncation, member-pile collapse, and the
// tab row at a thumb width — the Android header state.
export const Compact: Story = {
  args: { room: group, showAgentsButton: true, onOpenAgents: noop },
  globals: { viewport: { value: "mobileNarrow", isRotated: false } },
};
