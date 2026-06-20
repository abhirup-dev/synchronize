import type { Meta, StoryObj } from "@storybook/react-vite";
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
};
