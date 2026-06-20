import type { Meta, StoryObj } from "@storybook/react-vite";
import { Sidebar } from "./Sidebar.tsx";
import { GROUPS, DMS } from "../data/seed.ts";
import { inSidebarColumn } from "../storybook/shellFrames.tsx";

// Provider-backed shell: Sidebar reads the room list, identity, agents, and the
// activity awaiting-count through hooks (useRooms / useMe / useAgents /
// useActivityAwaitingCount) off the MockDataSource supplied by the global
// StorybookProviders decorator. Props only drive selection + vim mode.
const meta = {
  title: "Navigation/Sidebar",
  component: Sidebar,
  parameters: { layout: "fullscreen" },
  // Mount in the real fixed-width sidebar grid column instead of full-bleed —
  // otherwise the room sections collapse into unreadable horizontal strips.
  decorators: [inSidebarColumn],
  args: { onSelect: () => {}, mode: "navigate" },
} satisfies Meta<typeof Sidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

// Default: a pinned, unread group selected — exercises the GROUPS section,
// active room highlight, unread badges, and the pinned 📌 marker.
export const GroupSelected: Story = {
  args: { activeRoomId: GROUPS[0]!.id },
};

// A DM selected — exercises the DMs section, peer status dots, and the
// dm-vs-group room-name rendering (no leading `#`).
export const DmSelected: Story = {
  args: { activeRoomId: DMS[0]!.id },
};

// Activity dock active — the global cross-room feed button in the bottom dock
// is highlighted; no individual room is selected.
export const ActivityDock: Story = {
  args: { activeRoomId: "activity" },
};

// Typing/insert vim mode — the user bubble shows the INS chip (lime) instead of
// the default NAV chip (tangerine).
export const TypingMode: Story = {
  args: { activeRoomId: GROUPS[0]!.id, mode: "typing" },
};
