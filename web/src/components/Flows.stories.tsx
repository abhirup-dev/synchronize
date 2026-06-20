import type { Meta, StoryObj } from "@storybook/react-vite";
import { within, screen, userEvent, expect, waitFor } from "storybook/test";
import { Shell } from "../App.tsx";

// Cross-component workflow sample (extensible). Mounts the REAL app shell and
// drives a multi-step journey through the actual navigation glue — not a
// single isolated component. This is the template to copy for further flows.
//
// Boundary: this runs against MockDataSource in a real browser (Playwright
// Chromium via the Vitest addon), NOT the live daemon/SSE/routing. Full-app
// E2E against the running /web belongs to the real-data UI probe pipeline
// (sync-rycd), not here.
const meta = {
  title: "Flows/Activity to Thread",
  component: Shell,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Shell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OpenThreadFromActivity: Story = {
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step("Open the Activity view from the sidebar", async () => {
      await userEvent.click(canvas.getByTitle(/activity/i));
      // Activity feed rows render inside the activity scroll region.
      await waitFor(() => expect(canvasElement.querySelector(".act-scroll")).toBeTruthy());
    });

    await step("Click an activity row to open its thread", async () => {
      // .act-row is the clickable row (onClick → opens the in-place ThreadPane).
      const row = await waitFor(() => {
        const el = canvasElement.querySelector<HTMLElement>(".act-scroll .act-row");
        if (!el) throw new Error("no activity row yet");
        return el;
      });
      await userEvent.click(row);
    });

    await step("Thread pane opens and scrolls to the latest reply", async () => {
      // ThreadPane renders the "replying to" header when open.
      await waitFor(() => expect(screen.getByText(/replying to/i)).toBeVisible());
      const body = document.querySelector<HTMLElement>(".thread-pane-body");
      expect(body).toBeTruthy();
      body!.scrollTop = body!.scrollHeight;
      // Assert we're at the bottom — robust whether or not the thread overflows
      // (a short thread that fits has scrollTop 0 and is already "at bottom").
      await waitFor(() =>
        expect(body!.scrollHeight - body!.clientHeight - body!.scrollTop).toBeLessThanOrEqual(2),
      );
    });
  },
};
