import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { ThreadPane } from "./ThreadPane.tsx";
import { GROUPS } from "../data/seed.ts";

const room = GROUPS.find((r) => r.id === "checkout-revamp")!;

// Provider-backed exemplar: ThreadPane reads replies through useThreadReplies()
// off the MockDataSource supplied by the global StorybookProviders decorator.
const meta = {
  title: "Surfaces/ThreadPane",
  component: ThreadPane,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ThreadPane>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithReplies: Story = {
  args: { room, parentId: "m2", onClose: () => {} },
  play: async ({ canvasElement }) => {
    if (canvasElement.ownerDocument.documentElement.dataset.skin !== "glass") return;
    const pane = canvasElement.querySelector<HTMLElement>(".thread-pane")!;
    const composer = canvasElement.querySelector<HTMLElement>(".thread-pane > .composer")!;
    await expect(Math.abs(pane.getBoundingClientRect().bottom - composer.getBoundingClientRect().bottom)).toBeLessThan(1);
    const style = getComputedStyle(composer);
    await expect(style.borderBottomLeftRadius).toBe("0px");
    await expect(style.borderBottomRightRadius).toBe("0px");
  },
};
