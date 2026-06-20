import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within, expect, fn } from "storybook/test";
import { Settings, X, Send, Bot } from "lucide-react";
import { IconButton } from "./IconButton.tsx";

// The thumb-sized icon button used across compact chrome (CompactAppBar close /
// settings, composer send, roster toggle). Three variants; size is the touch
// target in px. Glyphs inherit theme ink via currentColor.
const meta = {
  title: "Primitives/IconButton",
  component: IconButton,
  args: { icon: Settings, label: "open display settings", onClick: fn() },
} satisfies Meta<typeof IconButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ghost: Story = { args: { variant: "ghost", icon: X, label: "close" } };
export const Solid: Story = { args: { variant: "solid", icon: Bot, label: "agents" } };
export const Accent: Story = { args: { variant: "accent", icon: Send, label: "send" } };
export const Active: Story = { args: { variant: "solid", icon: Bot, label: "agents", active: true } };
export const Disabled: Story = { args: { variant: "accent", icon: Send, label: "send", disabled: true } };

export const Clicks: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "open display settings" }));
    await expect(args.onClick).toHaveBeenCalled();
  },
};

// Disabled buttons must NOT fire onClick.
export const DisabledIsInert: Story = {
  args: { disabled: true },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "open display settings" }));
    await expect(args.onClick).not.toHaveBeenCalled();
  },
};
