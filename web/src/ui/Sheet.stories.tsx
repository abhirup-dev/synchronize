import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, screen, expect, fn, waitFor } from "storybook/test";
import { Sheet } from "./Sheet.tsx";

// Modal bottom-sheet primitive (Base UI Dialog): focus trap, scroll lock,
// Escape / backdrop-tap dismissal. Portals OUT of .app-shell, so play tests
// query `screen` (document), not the canvas. Mobile-narrow viewport since this
// is the compact transient-task surface (display settings, pickers, confirms).
const meta = {
  title: "Primitives/Sheet",
  component: Sheet,
  parameters: { layout: "fullscreen" },
  globals: { viewport: { value: "mobileNarrow", isRotated: false } },
  args: {
    open: true,
    ariaLabel: "demo sheet",
    onClose: fn(),
    children: (
      <div className="px-[14px] py-[16px] flex flex-col gap-[var(--space-12)]">
        <div className="font-display text-[length:var(--text-17)] tracking-[var(--tracking-sm)]">Display</div>
        <p className="font-ui text-ink-soft leading-[1.45]">
          A focused task floating over dimmed content. Dismiss via the backdrop or Escape.
        </p>
      </div>
    ),
  },
} satisfies Meta<typeof Sheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {};

// Escape dismisses → onClose fires (controlled `open` stays true, so we assert
// the callback, which is what the App listens to).
export const DismissViaEscape: Story = {
  play: async ({ args }) => {
    await waitFor(() => expect(screen.getByRole("dialog", { name: "demo sheet" })).toBeVisible());
    await userEvent.keyboard("{Escape}");
    await expect(args.onClose).toHaveBeenCalled();
  },
};
