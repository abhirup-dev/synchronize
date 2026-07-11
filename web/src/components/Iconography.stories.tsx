import type { Meta, StoryObj } from "@storybook/react-vite";
import { Iconography } from "./Iconography.tsx";

const meta: Meta<typeof Iconography> = {
  title: "Design/Iconography",
  component: Iconography,
  parameters: { layout: "centered" },
};

export default meta;
type Story = StoryObj<typeof meta>;

// Icon vocabulary — identity tiles + activity message-kind markers — on the
// canonical light palette.
export const Light: Story = {
  globals: { theme: "light", skin: "brutal" },
  render: () => <Iconography />,
};

// Same gallery on the canonical dark palette (kanagawa-wave).
export const KanagawaWave: Story = {
  globals: { theme: "kanagawa-wave", skin: "brutal" },
  render: () => <Iconography />,
};
