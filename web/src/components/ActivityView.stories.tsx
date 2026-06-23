import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fireEvent, fn, screen, userEvent, waitFor } from "storybook/test";
import { ActivityView } from "./ActivityView.tsx";
import { RuntimeDetailsProvider } from "../storybook/runtimeDetailsProvider.tsx";

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
    onOpenDm: fn(),
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
// a row is opened, so the play opens the deep-dive thread row to actually
// demonstrate the wider (560px) pane — threadWidth alone reserves nothing.
export const WideThreadPane: Story = {
  args: { threadWidth: 560 },
  play: async ({ canvasElement }) => {
    const row = await waitFor(() => {
      const match = [...canvasElement.querySelectorAll<HTMLElement>(".act-scroll .act-row")].find((el) =>
        /rollout checklist deep-dive/i.test(el.textContent ?? ""),
      );
      if (!match) throw new Error("deep-dive activity row not found");
      return match;
    });
    await userEvent.click(row);
    // The pane opening is the state we want to demonstrate; its existence is the
    // meaningful check (visibility/position varies with the test window size).
    await waitFor(() => {
      if (!document.querySelector(".thread-pane")) throw new Error("thread pane did not open");
    });
  },
};

export const ViewProfileFlow: Story = {
  decorators: [
    (Story) => (
      <RuntimeDetailsProvider>
        <Story />
      </RuntimeDetailsProvider>
    ),
  ],
  play: async ({ canvasElement, step }) => {
    await step("Open the activity actor menu for Atlas", async () => {
      const atlasRow = await waitFor(() => {
        const match = [...canvasElement.querySelectorAll<HTMLElement>(".act-row")].find((el) =>
          /want me to try a darker variant/i.test(el.textContent ?? ""),
        );
        if (!match) throw new Error("Atlas activity row not found");
        return match;
      });
      const atlasActor = atlasRow.querySelector<HTMLElement>(".author-chip");
      expect(atlasActor).toBeTruthy();
      await fireEvent.contextMenu(atlasActor!);
      await waitFor(() => expect(screen.getByText("View profile")).toBeTruthy());
      expect(screen.getByText("Open DM")).toBeTruthy();
      expect(screen.getByText("Copy AOE attach command")).toBeTruthy();
      expect(screen.getByText("Archive session...")).toBeTruthy();
      expect(screen.getByText("Resume session...")).toBeTruthy();
      expect(screen.getByText("Copy @handle")).toBeTruthy();
      expect(screen.queryByText(/Focus on/i)).toBeNull();
    });

    await step("Select View profile from Activity", async () => {
      await userEvent.click(screen.getByText("View profile"));
      await waitFor(() => expect(screen.getByText("Atlas profile")).toBeTruthy());
      await waitFor(() => expect(screen.getByText("claude-sonnet-4-6")).toBeTruthy());
    });
  },
};
