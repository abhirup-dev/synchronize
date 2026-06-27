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
export const Grouped: Story = {
  play: async ({ canvasElement, step }) => {
    await step("Top bar uses compact shared controls", async () => {
      await waitFor(() => {
        const controls = canvasElement.querySelectorAll(".act-filterbar .topbar-control");
        if (controls.length < 4) throw new Error("activity topbar controls not found");
      });
      const title = canvasElement.querySelector<HTMLElement>(".act-title");
      expect(title).toBeTruthy();
      expect(Number.parseFloat(getComputedStyle(title!).fontSize)).toBeLessThanOrEqual(18);
      await waitFor(() => expect(canvasElement.textContent).toMatch(/implementing|reviewing|testing/i));

      const roomTrigger = canvasElement.querySelector<HTMLElement>(".act-room-filter-trigger");
      expect(roomTrigger).toBeTruthy();
      expect(roomTrigger?.classList.contains("topbar-control")).toBe(true);
      expect(canvasElement.querySelector(".act-filterbar .act-room-filter-wrap")).toBeTruthy();

      const viewControls = canvasElement.querySelector<HTMLElement>(".act-view-controls");
      expect(viewControls).toBeTruthy();
      expect(viewControls?.querySelector(".act-sort-toggle")).toBeTruthy();
      expect(viewControls?.querySelectorAll(".act-view-icon").length).toBe(2);
    });

    await step("View mode controls drive the matching feed layout", async () => {
      const timelineToggle = canvasElement.querySelector<HTMLButtonElement>('[aria-label="Timeline view"]');
      const groupedToggle = canvasElement.querySelector<HTMLButtonElement>('[aria-label="Grouped view"]');
      expect(timelineToggle).toBeTruthy();
      expect(groupedToggle).toBeTruthy();

      await waitFor(() => expect(groupedToggle?.getAttribute("aria-pressed")).toBe("true"));
      expect(timelineToggle?.getAttribute("aria-pressed")).toBe("false");
      expect(canvasElement.querySelector(".act-digest")).toBeTruthy();

      await userEvent.click(timelineToggle!);
      await waitFor(() => expect(timelineToggle?.getAttribute("aria-pressed")).toBe("true"));
      await waitFor(() => {
        const titleSub = canvasElement.querySelector(".act-title-sub")?.textContent ?? "";
        if (!/timeline/i.test(titleSub)) throw new Error("timeline view label not active");
      });
      expect(canvasElement.querySelector(".act-flat")).toBeTruthy();

      await userEvent.click(groupedToggle!);
      await waitFor(() => expect(groupedToggle?.getAttribute("aria-pressed")).toBe("true"));
      await waitFor(() => {
        if (!canvasElement.querySelector(".act-digest")) throw new Error("grouped digest not restored");
      });
    });

    await step("Group digest headers do not duplicate the # glyph", async () => {
      const groupHeader = await waitFor(() => {
        const match = [...canvasElement.querySelectorAll<HTMLElement>(".act-digest-head")].find((el) =>
          /^#/.test(el.querySelector(".act-room-name")?.textContent ?? ""),
        );
        if (!match) throw new Error("group digest header not found");
        return match;
      });
      expect(groupHeader.querySelector(".act-room-name")?.textContent).toMatch(/^#/);
      expect(groupHeader.querySelector(".act-room-icon")).toBeNull();
    });
  },
};

export const ScopedAcknowledgeControls: Story = {
  play: async ({ canvasElement, step }) => {
    await step("Grouped room headers can acknowledge only that room", async () => {
      const groupAck = await waitFor(() => {
        const button = canvasElement.querySelector<HTMLButtonElement>(".act-digest-room .act-scope-ack");
        if (!button) throw new Error("group scoped acknowledge control not found");
        return button;
      });
      await userEvent.click(groupAck);
      await waitFor(() => {
        if (groupAck.isConnected) throw new Error("group scoped acknowledge control still visible");
      });
    });

    await step("Timeline buckets can acknowledge only that time interval", async () => {
      const timelineToggle = canvasElement.querySelector<HTMLButtonElement>('[aria-label="Timeline view"]');
      expect(timelineToggle).toBeTruthy();
      await userEvent.click(timelineToggle!);
      const bucketAck = await waitFor(() => {
        const button = canvasElement.querySelector<HTMLButtonElement>(".act-timeline-bucket .act-scope-ack");
        if (!button) throw new Error("timeline bucket scoped acknowledge control not found");
        return button;
      });
      await userEvent.click(bucketAck);
      await waitFor(() => {
        if (bucketAck.isConnected) throw new Error("timeline bucket acknowledge control still visible");
      });
    });
  },
};

// Same feed with a wider thread side-panel preference. The pane only mounts once
// a row is opened, so the play opens the deep-dive thread row to actually
// demonstrate the wider (560px) pane — threadWidth alone reserves nothing.
export const WideThreadPane: Story = {
  args: { threadWidth: 560 },
  play: async ({ canvasElement }) => {
    const row = await waitFor(() => {
      const match = [...canvasElement.querySelectorAll<HTMLElement>(".act-scroll .act-row")].find((el) =>
        /ramp to 50%/i.test(el.textContent ?? ""),
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
      const atlasMarker = atlasRow.querySelector<HTMLElement>(".act-message-marker");
      expect(atlasMarker).toBeTruthy();
      await fireEvent.contextMenu(atlasMarker!);
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
