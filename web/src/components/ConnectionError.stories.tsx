import type { Meta, StoryObj } from "@storybook/react-vite";
import { within, expect } from "storybook/test";
import { ConnectionError } from "../App.tsx";

// Full-screen fallback shown when the web client can't reach the daemon. A 401 /
// "unauthorized" message reveals the extra SYNCHRONIZE_TOKEN hint.
const meta = {
  title: "Surfaces/ConnectionError",
  component: ConnectionError,
  parameters: { layout: "fullscreen" },
  args: { message: "Failed to fetch daemon state" },
} satisfies Meta<typeof ConnectionError>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NetworkError: Story = { args: { message: "Failed to fetch daemon state" } };

export const Unauthorized: Story = {
  args: { message: "401 Unauthorized" },
  play: async ({ canvasElement }) => {
    // The auth hint about SYNCHRONIZE_TOKEN only appears for 401/unauthorized.
    await expect(within(canvasElement).getByText(/SYNCHRONIZE_TOKEN/)).toBeInTheDocument();
  },
};
