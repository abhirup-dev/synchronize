import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fireEvent, fn, screen, userEvent, waitFor } from "storybook/test";
import { Sidebar } from "./Sidebar.tsx";
import { AGENTS, GROUPS } from "../data/seed.ts";
import { isSelfAgent } from "../data/identity.ts";
import { inSidebarColumn } from "../storybook/shellFrames.tsx";
import { RuntimeDetailsProvider } from "../storybook/runtimeDetailsProvider.tsx";

// Provider-backed shell: Sidebar reads the room list, identity, agents, and the
// activity awaiting-count through hooks (useRooms / useMe / useAgents /
// useActivityAwaitingCount). RuntimeDetailsProvider enriches the default mock
// agents so the roster rows show the real `TOOL · MODEL` runtime line and the
// context menu carries the same profile/AOE shape as the app.
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
    onTab: fn(),
    displaySettings: {
      theme: "sigil-dark",
      onTheme: fn(),
    },
  },
} satisfies Meta<typeof Sidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

// Default: an unread group selected — exercises the nav list (Rooms active),
// the GROUPS section with accent unread counts, the AGENTS roster, and the
// operator footer.
export const GroupSelected: Story = {
  args: { activeRoomId: GROUPS[0]!.id },
  play: async ({ canvasElement }) => {
    const row = canvasElement.querySelector<HTMLElement>(`[data-vim-item="room-${GROUPS[0]!.id}"]`);
    expect(row).toBeTruthy();
    expect(row!.classList.contains("active")).toBe(true);
    expect(row!.querySelector(".room-name")?.textContent).toBe(`#${GROUPS[0]!.name}`);
    // Groups rows are hash-only: no icon tile, no preview line.
    expect(row!.querySelector(".room-icon")).toBeNull();
    expect(row!.querySelector(".room-preview")).toBeNull();
    // Nav: Rooms carries the active accent bar; Activity shows the awaiting count.
    const nav = [...canvasElement.querySelectorAll<HTMLElement>(".side-nav-item")];
    expect(nav.map((n) => n.textContent?.replace(/\d+$/, ""))).toEqual(["Rooms", "Activity", "Board", "Artifacts"]);
    expect(nav[0]!.className).toContain("bg-paper-3");
    // Roster: one row per non-self seed agent (the operator lives in the footer).
    expect(canvasElement.querySelectorAll(".agent-row").length).toBe(AGENTS.filter((a) => !isSelfAgent(a)).length);
  },
};

// Activity selected — the nav's Activity entry is highlighted; no room row is.
export const ActivityNav: Story = {
  args: { activeRoomId: "activity" },
  play: async ({ canvasElement }) => {
    const activity = canvasElement.querySelector<HTMLElement>('[data-vim-item="room-activity"]');
    expect(activity).toBeTruthy();
    expect(activity!.className).toContain("bg-paper-3");
    expect(canvasElement.querySelector(".room-item.active")).toBeNull();
  },
};

// Board tab active — the nav mirrors the room-surface tab state lifted from App.
export const BoardTab: Story = {
  args: { activeRoomId: GROUPS[0]!.id, tab: "board" },
};

// Footer menu: operator status text opens the settings/actions menu (themes,
// resume console, sign out) that replaced the old dock buttons.
export const FooterSettingsMenu: Story = {
  args: { activeRoomId: GROUPS[0]!.id },
  play: async ({ args }) => {
    await userEvent.click(screen.getByRole("button", { name: "operator status and settings" }));
    await waitFor(() => expect(screen.getByText("Theme: Light")).toBeTruthy());
    expect(screen.getByText("Theme: Dark")).toBeTruthy();
    expect(screen.getByText("Resume recovery console...")).toBeTruthy();
    expect(screen.getByText("Sign out")).toBeTruthy();

    await userEvent.click(screen.getByText("Theme: Light"));
    await waitFor(() => expect(args.displaySettings?.onTheme).toHaveBeenCalledWith("sigil-light"));
  },
};

// Roster context menu: the agent row menu is the DM/profile entry point now
// that the sidebar has no DMs section.
export const AgentRowProfileFlow: Story = {
  args: { activeRoomId: GROUPS[0]!.id },
  play: async ({ canvasElement, step }) => {
    await step("Open the roster context menu for Atlas", async () => {
      const atlasRow = canvasElement.querySelector<HTMLElement>('[data-vim-item="agent-atlas"]');
      expect(atlasRow).toBeTruthy();
      await fireEvent.contextMenu(atlasRow!);
      await waitFor(() => expect(screen.getByText("View profile")).toBeTruthy());
      expect(screen.getByText("Open DM")).toBeTruthy();
      expect(screen.getByText("Copy AOE attach command")).toBeTruthy();
      expect(screen.getByText("Archive session...")).toBeTruthy();
      expect(screen.getByText("Resume session...")).toBeTruthy();
      expect(screen.getByText("Copy @handle")).toBeTruthy();
    });

    await step("Select View profile from the menu", async () => {
      await userEvent.click(screen.getByText("View profile"));
      await waitFor(() => expect(screen.getByText("Atlas profile")).toBeTruthy());
      await waitFor(() => expect(screen.getByText("claude-sonnet-4-6")).toBeTruthy());
    });
  },
};
