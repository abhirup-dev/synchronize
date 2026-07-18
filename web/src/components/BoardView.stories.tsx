import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { BoardView } from "./BoardView.tsx";
import { GROUPS } from "../data/seed.ts";
import { inChatSurface } from "../storybook/shellFrames.tsx";

// Provider-backed surface: BoardView reads tasks via useTasks(roomId) and agents
// via useAgents() off the MockDataSource supplied by the global StorybookProviders
// decorator. We only pass roomId; the data flows through the provider stack.
const meta = {
  title: "Surfaces/BoardView",
  component: BoardView,
  parameters: { layout: "fullscreen" },
  decorators: [inChatSurface],
  globals: { viewport: { value: "desktop", isRotated: false } },
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
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector(".board-header")).toBeNull();
    await expect(canvasElement.querySelectorAll(".board-col").length).toBe(4);
    await expect(canvasElement.querySelectorAll(".task-card").length).toBe(5);
    for (const status of ["backlog", "doing", "review", "shipped"]) {
      await expect(canvasElement.querySelector(`.board-col[data-status="${status}"]`)).toBeTruthy();
    }
  },
};

export const Empty: Story = {
  args: { roomId: emptyRoom.id },
};

// The desktop Sigil treatment must not override the existing compact snap-column
// geometry or the per-column vertical scroll owner.
export const Compact: Story = {
  args: { roomId: populatedRoom.id },
  globals: { viewport: { value: "mobileNarrow", isRotated: false } },
  play: async ({ canvasElement }) => {
    const columns = canvasElement.querySelector<HTMLElement>(".board-cols")!;
    const columnBody = canvasElement.querySelector<HTMLElement>(".board-col-body")!;
    await expect(getComputedStyle(columns).gridAutoFlow).toBe("column");
    await expect(getComputedStyle(columns).overflowY).toBe("hidden");
    await expect(getComputedStyle(columnBody).overflowY).toBe("auto");
  },
};
