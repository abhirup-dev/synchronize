import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within, expect, fn } from "storybook/test";
import { BottomNav } from "./BottomNav.tsx";

// Compact-only root chrome (rendered only when shellMode === "compact"). These
// stories pin the Android/mobile-narrow viewport so the bar reads at its real
// width; sweep Theme/Skin from the toolbar to confirm every palette.
const meta = {
  title: "Navigation/BottomNav",
  component: BottomNav,
  parameters: { layout: "fullscreen" },
  globals: { viewport: { value: "mobileNarrow", isRotated: false } },
  args: { active: "chats", onChats: fn(), onActivity: fn(), onAgents: fn() },
} satisfies Meta<typeof BottomNav>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ChatsActive: Story = { args: { active: "chats" } };
export const ActivityActive: Story = { args: { active: "activity" } };

// Agents tab active and carrying a member-count badge.
export const AgentsActiveWithBadge: Story = { args: { active: "agents", agentCount: 4 } };

// Interaction: tapping a tab fires its handler (the App wires these to nav).
export const TapAgents: Story = {
  args: { active: "chats", agentCount: 2 },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Agents" }));
    await expect(args.onAgents).toHaveBeenCalled();
  },
};
