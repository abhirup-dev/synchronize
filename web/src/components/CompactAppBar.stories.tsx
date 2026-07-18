import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within, expect, fn } from "storybook/test";
import { CompactAppBar } from "../App.tsx";

// Header bar for the compact Chats / Agents full-bleed overlays: a close (X)
// button, title + optional detail line, and a display-settings button. Pinned to
// the mobile-narrow viewport since it's compact-only chrome.
const meta = {
  title: "Navigation/CompactAppBar",
  component: CompactAppBar,
  parameters: { layout: "fullscreen" },
  globals: { viewport: { value: "mobileNarrow", isRotated: false } },
  args: { title: "Chats", detail: "5 rooms", onSettings: fn(), onClose: fn() },
} satisfies Meta<typeof CompactAppBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ChatsOverlay: Story = { args: { title: "Chats", detail: "5 rooms" } };
export const AgentsOverlay: Story = {
  args: { title: "Agents", detail: "4 in #checkout-revamp" },
  play: async ({ canvasElement }) => {
    const title = canvasElement.querySelector<HTMLElement>(".compact-appbar-title");
    const detail = canvasElement.querySelector<HTMLElement>(".compact-appbar-detail");
    expect(title).toBeTruthy();
    expect(detail).toBeTruthy();
    await expect(getComputedStyle(title!).fontFamily).toContain("Instrument Sans");
    await expect(getComputedStyle(detail!).fontFamily).toContain("Instrument Sans");
    await expect(getComputedStyle(title!).letterSpacing).toBe("normal");
  },
};

// Title that overflows the narrow bar — verifies truncation, not wrap.
export const LongTitle: Story = {
  args: { title: "#checkout-revamp-experiments-q3" },
};

// Both chrome buttons fire their handlers (App wires them to open settings / close).
export const Controls: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "open display settings" }));
    await expect(args.onSettings).toHaveBeenCalled();
    await userEvent.click(canvas.getByRole("button", { name: "close" }));
    await expect(args.onClose).toHaveBeenCalled();
  },
};
