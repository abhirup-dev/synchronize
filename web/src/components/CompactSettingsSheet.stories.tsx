import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, screen, expect, fn, waitFor } from "storybook/test";
import { CompactSettingsSheet } from "../shell/compact-chrome.tsx";

// The compact display-settings bottom sheet (theme / skin / chat-background).
// Built on the Sheet primitive, so it portals OUT of the canvas — play tests
// query `screen`. Keep the story globals (data-theme/skin) in sync with the
// `theme`/`skin` props so the surface and its labels agree.
const meta = {
  title: "Surfaces/CompactSettingsSheet",
  component: CompactSettingsSheet,
  parameters: { layout: "fullscreen" },
  globals: { viewport: { value: "mobileNarrow", isRotated: false } },
  args: {
    open: true,
    theme: "light",
    skin: "brutal",
    chatBg: "none",
    onToggleAppearance: fn(),
    onCycleTheme: fn(),
    onToggleSkin: fn(),
    onChatBg: fn(),
    onClose: fn(),
  },
} satisfies Meta<typeof CompactSettingsSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LightBrutal: Story = {
  globals: { viewport: { value: "mobileNarrow", isRotated: false }, theme: "light", skin: "brutal" },
};

export const DarkGlass: Story = {
  args: { theme: "kanagawa-wave", skin: "glass" },
  globals: { viewport: { value: "mobileNarrow", isRotated: false }, theme: "kanagawa-wave", skin: "glass" },
};

// Tapping a settings row fires the right handler; the chat-bg grid selects.
export const RowInteractions: Story = {
  play: async ({ args }) => {
    await waitFor(() => expect(screen.getByRole("dialog", { name: "display settings" })).toBeVisible());
    await userEvent.click(screen.getByRole("button", { name: /^Theme/ }));
    await expect(args.onCycleTheme).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /^Skin/ }));
    await expect(args.onToggleSkin).toHaveBeenCalled();
  },
};
