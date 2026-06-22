import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fireEvent, screen, userEvent, waitFor, within } from "storybook/test";
import { AgentRoster } from "./AgentRoster.tsx";
import { GROUPS } from "../data/seed.ts";
import { inRosterColumn } from "../storybook/shellFrames.tsx";
import { RuntimeDetailsProvider } from "../storybook/runtimeDetailsProvider.tsx";

// Provider-backed: AgentRoster reads the agent set through useAgents() off the
// MockDataSource supplied by the global StorybookProviders decorator. The story
// only chooses which room to scope the roster to (room.members filters which
// agents appear) and which agent, if any, is focused.
const checkoutRevamp = GROUPS.find((r) => r.id === "checkout-revamp")!;
// heartbeat-checks includes every agent, so all four status groups
// (WORKING / READY / IDLE / OFF) render — including offline `pulse`.
const heartbeat = GROUPS.find((r) => r.id === "heartbeat-checks")!;

const meta = {
  title: "Navigation/AgentRoster",
  component: AgentRoster,
  parameters: { layout: "fullscreen" },
  // Mount in the real 260px roster column so the focused card stays within the
  // roster width instead of stretching into a full-bleed band.
  decorators: [inRosterColumn],
  args: { focusedAgent: null, onFocus: () => {} },
} satisfies Meta<typeof AgentRoster>;

export default meta;
type Story = StoryObj<typeof meta>;

// Default project room — a busy/idle mix (cortex+atlas+nova busy, vega idle,
// you online). No agent is focused.
export const Default: Story = {
  args: { room: checkoutRevamp },
};

// Every agent present, so all four status sections show at once, including the
// offline OFF group (pulse).
export const AllStatuses: Story = {
  args: { room: heartbeat },
};

// A focused agent surfaces the "focused on @handle" banner and highlights the
// matching roster card.
export const FocusedAgent: Story = {
  args: { room: checkoutRevamp, focusedAgent: "cortex" },
};

export const ViewProfileFlow: Story = {
  args: { room: checkoutRevamp },
  decorators: [
    (Story) => (
      <RuntimeDetailsProvider>
        <Story />
      </RuntimeDetailsProvider>
    ),
  ],
  play: async ({ canvasElement, step }) => {
    const openProfileFor = async (agentId: string, expectedName: string, expectedModel: string) => {
      const card = canvasElement.querySelector<HTMLElement>(`[data-vim-item="agent-${agentId}"]`);
      expect(card).toBeTruthy();
      await fireEvent.contextMenu(card!);
      await waitFor(() => expect(screen.getByText("View profile")).toBeTruthy());
      await userEvent.click(screen.getByText("View profile"));
      await waitFor(() => expect(screen.getByText(`${expectedName} profile`)).toBeTruthy());
      await waitFor(() => expect(screen.getByText(expectedModel)).toBeTruthy());
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByText(`${expectedName} profile`)).toBeNull());
    };

    await step("Open the roster profile for Atlas", async () => {
      await openProfileFor("atlas", "Atlas", "claude-sonnet-4-6");
    });

    await step("Open the roster profile for Cortex", async () => {
      await openProfileFor("cortex", "Cortex", "gpt-5.5");
    });

    await step("Do not expose View profile for You", async () => {
      const canvas = within(canvasElement);
      expect(await canvas.findByText("AGENTS")).toBeTruthy();
      const youCard = canvasElement.querySelector<HTMLElement>('[data-vim-item="agent-you"]');
      expect(youCard).toBeTruthy();
      await fireEvent.contextMenu(youCard!);
      await waitFor(() => {
        expect(screen.queryByText("View profile")).toBeNull();
      });
    });
  },
};
