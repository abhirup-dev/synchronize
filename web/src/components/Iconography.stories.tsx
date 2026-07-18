import type { Meta, StoryObj } from "@storybook/react-vite";
import { Iconography } from "./Iconography.tsx";

const meta: Meta<typeof Iconography> = {
  title: "Design/Iconography",
  component: Iconography,
  parameters: { layout: "centered" },
};

export default meta;
type Story = StoryObj<typeof meta>;

// Theme and skin are global toolbar traits; this one gallery exercises the
// shared Sigil identity and activity icon vocabulary in either palette.
export const Gallery: Story = {
  render: () => <Iconography />,
};
