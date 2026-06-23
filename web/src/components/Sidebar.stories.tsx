import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fireEvent, screen, userEvent, waitFor } from "storybook/test";
import { Sidebar } from "./Sidebar.tsx";
import { GROUPS, DMS } from "../data/seed.ts";
import { inSidebarColumn } from "../storybook/shellFrames.tsx";
import { RuntimeDetailsProvider } from "../storybook/runtimeDetailsProvider.tsx";

// Provider-backed shell: Sidebar reads the room list, identity, agents, and the
// activity awaiting-count through hooks (useRooms / useMe / useAgents /
// useActivityAwaitingCount). RuntimeDetailsProvider enriches the default mock
// agents so the visible DM stories exercise the same profile/AOE menu shape as
// the app.
const meta = {
  title: "Navigation/Sidebar",
  component: Sidebar,
  parameters: { layout: "fullscreen" },
  // Mount in the real fixed-width sidebar grid column instead of full-bleed —
  // otherwise the room sections collapse into unreadable horizontal strips.
  decorators: [
    inSidebarColumn,
    (Story) => (
      <RuntimeDetailsProvider>
        <Story />
      </RuntimeDetailsProvider>
    ),
  ],
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

export const DmViewProfileFlow: Story = {
  args: { activeRoomId: "dm-atlas" },
  play: async ({ canvasElement, step }) => {
    await step("Open the DM context menu for Atlas", async () => {
      const atlasDm = canvasElement.querySelector<HTMLElement>('[data-vim-item="room-dm-atlas"]');
      expect(atlasDm).toBeTruthy();
      await fireEvent.contextMenu(atlasDm!);
      await waitFor(() => expect(screen.getByText("View profile")).toBeTruthy());
      expect(screen.getByText("Open DM")).toBeTruthy();
      expect(screen.getByText("Copy AOE attach command")).toBeTruthy();
      expect(screen.getByText("Archive session...")).toBeTruthy();
      expect(screen.getByText("Resume session...")).toBeTruthy();
      expect(screen.getByText("Copy @handle")).toBeTruthy();
      expect(screen.queryByText(/Focus on/i)).toBeNull();
    });

    await step("Select View profile from the DM menu", async () => {
      await userEvent.click(screen.getByText("View profile"));
      await waitFor(() => expect(screen.getByText("Atlas profile")).toBeTruthy());
      await waitFor(() => expect(screen.getByText("claude-sonnet-4-6")).toBeTruthy());
    });
  },
};
