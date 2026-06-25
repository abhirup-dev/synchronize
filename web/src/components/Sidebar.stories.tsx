import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fireEvent, fn, screen, userEvent, waitFor } from "storybook/test";
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
  args: {
    onSelect: fn(),
    mode: "navigate",
    displaySettings: {
      theme: "kanagawa-wave",
      skin: "brutal",
      chatBg: "none",
      onTheme: fn(),
      onToggleSkin: fn(),
      onChatBg: fn(),
    },
  },
} satisfies Meta<typeof Sidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

// Default: a pinned, unread group selected — exercises the GROUPS section,
// active room highlight, unread badges, and the pinned 📌 marker.
export const GroupSelected: Story = {
  args: { activeRoomId: GROUPS[0]!.id },
  play: async ({ canvasElement }) => {
    const row = canvasElement.querySelector<HTMLElement>(`[data-vim-item="room-${GROUPS[0]!.id}"]`);
    expect(row).toBeTruthy();
    expect(row!.querySelector(".room-icon")).toBeNull();
    expect(row!.querySelector(".room-name")?.textContent).toBe(`#${GROUPS[0]!.name}`);
    const headers = [...canvasElement.querySelectorAll<HTMLElement>(".section-head")];
    expect(headers.length).toBeGreaterThanOrEqual(2);
    for (const header of headers.slice(0, 2)) {
      expect(header.classList.contains("panel-section-head")).toBe(true);
      expect(getComputedStyle(header).borderStyle).toBe("none");
    }
    expect(screen.getByRole("button", { name: "Open resume recovery console" }).classList.contains("resume-dock-btn")).toBe(true);
    expect(screen.queryByText("RESUME")).toBeNull();
  },
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

export const DisplaySettingsMenu: Story = {
  args: { activeRoomId: GROUPS[0]!.id },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(screen.getByRole("button", { name: "open display settings" }));
    await waitFor(() => expect(screen.getByText("Theme")).toBeTruthy());
    expect(screen.getByText("Background")).toBeTruthy();
    expect(screen.getByText("Skin")).toBeTruthy();

    await userEvent.click(screen.getByText("Theme"));
    await waitFor(() => expect(screen.getByText("← Back")).toBeTruthy());
    await userEvent.click(screen.getByText("Light"));
    await waitFor(() => expect(args.displaySettings?.onTheme).toHaveBeenCalledWith("light"));

    await userEvent.click(canvasElement.querySelector<HTMLElement>(".sidebar-settings-btn")!);
    await waitFor(() => expect(screen.getByText("Theme")).toBeTruthy());
    await userEvent.click(screen.getByText("Background"));
    await waitFor(() => expect(screen.getByText("The Great Wave")).toBeTruthy());
    await userEvent.click(screen.getByText("The Great Wave"));
    await waitFor(() => expect(args.displaySettings?.onChatBg).toHaveBeenCalledWith("great-wave"));
  },
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
