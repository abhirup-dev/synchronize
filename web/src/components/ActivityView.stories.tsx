import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fireEvent, fn, screen, userEvent, waitFor } from "storybook/test";
import { ActivityView } from "./ActivityView.tsx";
import { RuntimeDetailsProvider } from "../storybook/runtimeDetailsProvider.tsx";
import { inMainColumn } from "../storybook/shellFrames.tsx";

// Provider-backed shell: ActivityView pulls the cross-room feed, agents, and
// rooms through hooks (useActivity / useAgents / useRooms / ...) off the
// MockDataSource supplied by the global StorybookProviders decorator. The story
// only wires the three callback/layout props the component actually accepts.
const meta = {
  title: "Activity/ActivityView",
  component: ActivityView,
  parameters: { layout: "fullscreen" },
  decorators: [inMainColumn],
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
    await step("Unified top bar carries the shared TabGroup switchers", async () => {
      await waitFor(() => {
        // Filter tabs are the shared TopBar TabGroup (All / Mentions / Awaiting).
        const tabs = canvasElement.querySelectorAll('[aria-label="activity filter"] [role="tab"]');
        if (tabs.length !== 3) throw new Error("activity filter tabs not found");
      });
      expect(canvasElement.querySelectorAll('[aria-label="activity layout"] [role="tab"]').length).toBe(2);
      expect(canvasElement.querySelector(".top-bar .act-sort-toggle")).toBeTruthy();
      expect(canvasElement.querySelector(".top-bar .act-markall")).toBeTruthy();

      const roomTrigger = canvasElement.querySelector<HTMLElement>(".act-room-filter-trigger");
      expect(roomTrigger).toBeTruthy();
      expect(roomTrigger?.classList.contains("rail-chip")).toBe(true);
      expect(roomTrigger?.querySelector(".rail-chip-label")?.textContent).toBe("Room");
      expect(Number(roomTrigger?.querySelector(".rail-chip-badge")?.textContent)).toBeGreaterThan(0);
      expect(roomTrigger?.querySelector(".rail-chip-icon svg")).toBeTruthy();
      expect(roomTrigger?.getAttribute("data-tooltip")).toBe("Filter activity by room");
      expect(canvasElement.querySelector(".top-bar .act-room-filter-wrap")).toBeTruthy();
    });

    await step("Layout tabs drive the matching feed layout", async () => {
      const tabByLabel = (label: string) =>
        [...canvasElement.querySelectorAll<HTMLButtonElement>('[aria-label="activity layout"] [role="tab"]')]
          .find((tab) => tab.textContent === label);
      const flatToggle = tabByLabel("Flat");
      const groupedToggle = tabByLabel("Grouped");
      expect(flatToggle).toBeTruthy();
      expect(groupedToggle).toBeTruthy();

      await waitFor(() => expect(groupedToggle?.getAttribute("aria-selected")).toBe("true"));
      expect(flatToggle?.getAttribute("aria-selected")).toBe("false");
      expect(canvasElement.querySelector(".act-digest")).toBeTruthy();

      await userEvent.click(flatToggle!);
      await waitFor(() => expect(flatToggle?.getAttribute("aria-selected")).toBe("true"));
      await waitFor(() => {
        if (!canvasElement.querySelector(".act-flat")) throw new Error("flat timeline layout not active");
      });

      await userEvent.click(groupedToggle!);
      await waitFor(() => expect(groupedToggle?.getAttribute("aria-selected")).toBe("true"));
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
      expect(groupHeader.querySelector(".act-room-count")).toBeNull();
    });

    await step("DM digest headers use the canonical message avatar", async () => {
      const avatar = canvasElement.querySelector<HTMLElement>(".act-digest-head .identity-icon");
      expect(avatar).toBeTruthy();
      expect(avatar?.classList.contains("identity-icon")).toBe(true);
      // Reference activity spec: DM group headers carry a 22px bare sigil.
      expect(Math.round(avatar!.getBoundingClientRect().width)).toBe(22);
      expect(Math.round(avatar!.getBoundingClientRect().height)).toBe(22);
      expect(avatar?.classList.contains("act-room-icon")).toBe(false);
    });

    await step("Activity rows share the canonical agent identity cluster", async () => {
      const row = [...canvasElement.querySelectorAll<HTMLElement>(".act-row")].find((candidate) =>
        candidate.querySelector(".act-row-author .identity-name-pill"),
      );
      expect(row).toBeTruthy();
      expect(row?.querySelector(".act-row-author .identity-icon")).toBeTruthy();
      expect(row?.querySelector(".act-row-author .identity-name-pill")).toBeTruthy();
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
      const flatToggle = [...canvasElement.querySelectorAll<HTMLButtonElement>('[aria-label="activity layout"] [role="tab"]')]
        .find((tab) => tab.textContent === "Flat");
      expect(flatToggle).toBeTruthy();
      await userEvent.click(flatToggle!);
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
