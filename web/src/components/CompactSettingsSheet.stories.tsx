import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, screen, expect, fn, waitFor } from "storybook/test";
import { CompactSettingsSheet } from "../App.tsx";

// Sigil has one visual system and a matched light/dark pair. The compact sheet
// preserves the production Sheet behavior while exposing only that meaningful
// appearance choice.
const meta = {
  title: "Surfaces/CompactSettingsSheet",
  component: CompactSettingsSheet,
  parameters: { layout: "fullscreen" },
  globals: { viewport: { value: "mobileNarrow", isRotated: false } },
  args: {
    open: true,
    theme: "sigil-light",
    onToggleAppearance: fn(),
    onClose: fn(),
  },
} satisfies Meta<typeof CompactSettingsSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Light: Story = {
  globals: { viewport: { value: "mobileNarrow", isRotated: false }, theme: "sigil-light", skin: "sigil" },
};

export const Dark: Story = {
  args: { theme: "sigil-dark" },
  globals: { viewport: { value: "mobileNarrow", isRotated: false }, theme: "sigil-dark", skin: "sigil" },
};

export const AppearanceInteraction: Story = {
  play: async ({ args }) => {
    await waitFor(() => expect(screen.getByRole("dialog", { name: "display settings" })).toBeVisible());
    await userEvent.click(screen.getByRole("button", { name: /^Appearance/ }));
    await expect(args.onToggleAppearance).toHaveBeenCalled();
  },
};
