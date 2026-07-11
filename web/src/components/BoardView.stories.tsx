import type { Meta, StoryObj } from "@storybook/react-vite";
import { BoardView } from "./BoardView.tsx";
import { GROUPS } from "../data/seed.ts";

// Provider-backed surface: BoardView reads tasks via useTasks(roomId) and agents
// via useAgents() off the MockDataSource supplied by the global StorybookProviders
// decorator. We only pass roomId; the data flows through the provider stack.
const meta = {
  title: "Surfaces/BoardView",
  component: BoardView,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof BoardView>;

export default meta;
type Story = StoryObj<typeof meta>;

// checkout-revamp is the only seeded room with tasks — it covers every lifecycle
// column: a shipped task, two in-progress (with progress bars + a LIVE pill since
// the assignee is busy), one in review (with a reviewer stack), and one backlog.
const populatedRoom = GROUPS.find((r) => r.id === "checkout-revamp")!;

// ml-ranking has no seeded tasks, so the board renders all four empty columns.
const emptyRoom = GROUPS.find((r) => r.id === "ml-ranking")!;

export const Populated: Story = {
  args: { roomId: populatedRoom.id },
};

export const Empty: Story = {
  args: { roomId: emptyRoom.id },
};
