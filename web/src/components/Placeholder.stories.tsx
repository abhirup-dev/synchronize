import type { Meta, StoryObj } from "@storybook/react-vite";
import { Placeholder } from "../App.tsx";

// Stamp shown for not-yet-built surfaces (e.g. the Artifacts tab).
const meta = {
  title: "Surfaces/Placeholder",
  component: Placeholder,
  parameters: { layout: "fullscreen" },
  args: { label: "ARTIFACTS — coming in V2" },
} satisfies Meta<typeof Placeholder>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Artifacts: Story = {};
