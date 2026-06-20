import type { Meta, StoryObj } from "@storybook/react-vite";
import { ActivityView } from "./ActivityView.tsx";

// Provider-backed shell: ActivityView pulls the cross-room feed, agents, and
// rooms through hooks (useActivity / useAgents / useRooms / ...) off the
// MockDataSource supplied by the global StorybookProviders decorator. The story
// only wires the three callback/layout props the component actually accepts.
const meta = {
  title: "Activity/ActivityView",
  component: ActivityView,
  parameters: { layout: "fullscreen" },
  args: {
    onJumpToRoom: () => {},
    threadWidth: 420,
    onThreadWidth: () => {},
  },
} satisfies Meta<typeof ActivityView>;

export default meta;
type Story = StoryObj<typeof meta>;

// Default landing state: the Grouped (Digest) view over the full seeded feed,
// with the filter bar, room rail, and "awaiting you" header indicator.
export const Grouped: Story = {};

// Same feed with a wider thread side-panel preference. The pane only mounts once
// a row is opened, but threadWidth still drives the reserved column width.
export const WideThreadPane: Story = {
  args: { threadWidth: 560 },
};
