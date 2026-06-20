import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor } from "storybook/test";
import { Shell } from "../App.tsx";

// Full app shell pinned to each breakpoint. Replaces the old Playwright smoke
// (web/scripts/verify-ui.mjs, sync-imeu.1.23): the shell reads window.innerWidth
// to pick its mode, the Storybook viewport addon sizes the preview iframe, so
// each story exercises the real responsive render against MockDataSource (global
// decorator). The play tests assert the shell mounts with the right
// data-shell-mode — the one thing component-isolated stories couldn't cover.
const meta = {
  title: "Layouts/App Shell",
  component: Shell,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Shell>;

export default meta;
type Story = StoryObj<typeof meta>;

const expectShellMode = async (canvasElement: HTMLElement, mode: string) => {
  // Guard against the CSS-import drift that once unstyled the whole catalog:
  // if tokens.css isn't loaded, --paper is empty and every brutal border/bg
  // collapses while DOM-only play tests stay green. Cheap, catches it.
  expect(getComputedStyle(document.documentElement).getPropertyValue("--paper").trim()).not.toBe("");
  await waitFor(() => {
    const shell = canvasElement.querySelector(".app-shell");
    expect(shell).toBeTruthy();
    expect(shell!.getAttribute("data-shell-mode")).toBe(mode);
  });
};

// compact: <780px (mobileNarrow = 390)
export const Compact: Story = {
  globals: { viewport: { value: "mobileNarrow", isRotated: false } },
  play: async ({ canvasElement }) => expectShellMode(canvasElement, "compact"),
};

// medium: 780–1180px (mediumShell = 1024)
export const Medium: Story = {
  globals: { viewport: { value: "mediumShell", isRotated: false } },
  play: async ({ canvasElement }) => expectShellMode(canvasElement, "medium"),
};

// desktop: ≥1180px (desktop = 1440). The shell lands on the first room, so the
// chat surface should render without any navigation — covers verify-ui's
// "open room → chat view" assertion.
export const Desktop: Story = {
  globals: { viewport: { value: "desktop", isRotated: false } },
  play: async ({ canvasElement }) => {
    await expectShellMode(canvasElement, "desktop");
    await waitFor(() => expect(canvasElement.querySelector(".chat-view")).toBeTruthy());
  },
};
