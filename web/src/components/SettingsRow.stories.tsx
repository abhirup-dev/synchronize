import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within, expect, fn } from "storybook/test";
import { SettingsRow } from "../shell/compact-chrome.tsx";

// Label + value row used inside the compact settings sheet. Tapping the whole
// row advances the setting (the value reflects current state).
const meta = {
  title: "Primitives/SettingsRow",
  component: SettingsRow,
  parameters: { layout: "fullscreen" },
  globals: { viewport: { value: "mobileNarrow", isRotated: false } },
  args: { label: "Theme", value: "Kanagawa Wave", onClick: fn() },
} satisfies Meta<typeof SettingsRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Appearance: Story = { args: { label: "Appearance", value: "Dark" } };

export const Taps: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button"));
    await expect(args.onClick).toHaveBeenCalled();
  },
};
