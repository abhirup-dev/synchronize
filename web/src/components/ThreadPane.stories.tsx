import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { ThreadPane } from "./ThreadPane.tsx";
import { GROUPS } from "../data/seed.ts";
import { ChatSplitSurfaceFrame } from "../storybook/shellFrames.tsx";

const room = GROUPS.find((r) => r.id === "checkout-revamp")!;

// Provider-backed exemplar: ThreadPane reads replies through useThreadReplies()
// off the MockDataSource supplied by the global StorybookProviders decorator.
const meta = {
  title: "Surfaces/ThreadPane",
  component: ThreadPane,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <ChatSplitSurfaceFrame pane={<Story />}>
        <div aria-hidden />
      </ChatSplitSurfaceFrame>
    ),
  ],
} satisfies Meta<typeof ThreadPane>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithReplies: Story = {
  args: { room, parentId: "m2", onClose: () => {} },
  globals: { viewport: { value: "desktop", isRotated: false } },
  play: async ({ canvasElement }) => {
    const pane = canvasElement.querySelector<HTMLElement>(".thread-pane")!;
    const composer = canvasElement.querySelector<HTMLElement>(".thread-pane > .composer")!;
    await expect(canvasElement.querySelector(".thread-pane-heading")?.textContent).toContain("Thread");
    await expect(canvasElement.querySelector(".thread-pane-room")?.textContent).toContain("checkout-revamp");
    await expect(Math.abs(pane.getBoundingClientRect().bottom - composer.getBoundingClientRect().bottom)).toBeLessThanOrEqual(1);
    const style = getComputedStyle(composer);
    await expect(style.borderBottomLeftRadius).toBe("0px");
    await expect(style.borderBottomRightRadius).toBe("0px");
  },
};
