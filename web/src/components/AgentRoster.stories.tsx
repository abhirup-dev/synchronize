import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fireEvent, fn, screen, userEvent, waitFor, within } from "storybook/test";
import { AgentRoster } from "./AgentRoster.tsx";
import { GROUPS } from "../data/seed.ts";
import { inRosterPanel } from "../storybook/shellFrames.tsx";
import { RuntimeDetailsProvider } from "../storybook/runtimeDetailsProvider.tsx";

// Provider-backed: AgentRoster reads the agent set through useAgents() off the
// MockDataSource supplied by the global StorybookProviders decorator. The story
// chooses which room to scope the roster to (room.members filters which agents
// appear) and passes onClose so the desktop/medium panel head renders, exactly
// as App.tsx mounts it inside the shell-overlay-agents panel.
const checkoutRevamp = GROUPS.find((r) => r.id === "checkout-revamp")!;
// heartbeat-checks includes every agent, so all statuses render at once.
const heartbeat = GROUPS.find((r) => r.id === "heartbeat-checks")!;

async function expectSharedAgentMenu() {
  await waitFor(() => expect(screen.getByText("Open DM")).toBeTruthy());
  expect(screen.getByText("View profile")).toBeTruthy();
  expect(screen.getByText("Copy AOE attach command")).toBeTruthy();
  expect(screen.getByText("Archive session...")).toBeTruthy();
  expect(screen.getByText("Resume session...")).toBeTruthy();
  expect(screen.getByText("Copy @handle")).toBeTruthy();
  expect(screen.queryByText(/Focus on/i)).toBeNull();
}

const meta = {
  title: "Navigation/AgentRoster",
  component: AgentRoster,
  parameters: { layout: "fullscreen" },
  decorators: [inRosterPanel],
  args: { onClose: fn() },
} satisfies Meta<typeof AgentRoster>;

export default meta;
type Story = StoryObj<typeof meta>;

// Default project room — a busy/idle mix.
export const Default: Story = {
  args: { room: checkoutRevamp },
};

// Every agent present: one flat "In this group" list (no status grouping),
// each row carrying the avatar status dot AND the right-aligned mono status
// label; the operator ("you") never appears as crew.
export const AllStatuses: Story = {
  args: { room: heartbeat },
  play: async ({ canvasElement }) => {
    const cards = await waitFor(() => {
      const found = [...canvasElement.querySelectorAll<HTMLElement>(".roster-card")];
      if (found.length === 0) throw new Error("roster rows not found");
      return found;
    });
    cards.forEach((card) => {
      expect(card.querySelector(".identity-status-dot")).toBeTruthy();
      expect(card.textContent).toMatch(/WORKING|READY|IDLE|OFF/);
    });
    expect(canvasElement.querySelector('[data-vim-item="agent-you"]')).toBeNull();
  },
};

// The panel head is the ref x-panel head: Agents title, mono room meta with
// agent/working counts, and a close control wired to onClose.
export const Header: Story = {
  args: { room: checkoutRevamp },
  play: async ({ canvasElement, args }) => {
    const header = await waitFor(() => {
      const match = canvasElement.querySelector<HTMLElement>(".roster-head");
      if (!match) throw new Error("roster header not found");
      return match;
    });
    expect(within(header).getByRole("heading", { name: "Agents" })).toBeTruthy();
    expect(header.textContent).toMatch(/# checkout-revamp/);
    expect(header.textContent).toMatch(/\d+ agents · \d+ working/i);
    await userEvent.click(within(header).getByRole("button", { name: "close agents panel" }));
    expect(args.onClose).toHaveBeenCalled();
  },
};

// The + Spawn agent button opens the real spawn dialog scoped to the room.
export const SpawnFromPanel: Story = {
  args: { room: checkoutRevamp },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "+ Spawn agent" }));
    await expect(await screen.findByRole("heading", { name: /Spawn into #checkout-revamp/i })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "close" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: /Spawn into/i })).toBeNull());
  },
};

export const ViewProfileFlow: Story = {
  args: { room: checkoutRevamp, onOpenDm: fn() },
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
      await expectSharedAgentMenu();
      await userEvent.click(screen.getByText("View profile"));
      await waitFor(() => expect(screen.getByText(`${expectedName} profile`)).toBeTruthy());
      // The model also appears on the roster runtime line, so scope the
      // assertion to the profile dialog (rendered in a portal backdrop).
      await waitFor(() => {
        const dialog = document.querySelector(".modal-backdrop");
        expect(dialog).toBeTruthy();
        expect(within(dialog as HTMLElement).getByText(expectedModel)).toBeTruthy();
      });
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByText(`${expectedName} profile`)).toBeNull());
    };

    await step("Open the roster profile for Atlas", async () => {
      await openProfileFor("atlas", "Atlas", "claude-sonnet-4-6");
    });

    await step("Open the roster profile for Cortex", async () => {
      await openProfileFor("cortex", "Cortex", "gpt-5.5");
    });

    await step("Switch Atlas's model from the profile picker", async () => {
      const card = canvasElement.querySelector<HTMLElement>('[data-vim-item="agent-atlas"]');
      await fireEvent.contextMenu(card!);
      await userEvent.click(await screen.findByText("View profile"));
      const dialog = await waitFor(() => {
        const d = document.querySelector(".modal-backdrop");
        if (!d) throw new Error("profile dialog not open");
        return d as HTMLElement;
      });
      // The MODEL picker lists claude options; Atlas is on Sonnet — pick Opus.
      const opus = within(dialog).getByRole("radio", { name: "Opus" });
      await userEvent.click(opus);
      // Switching toasts confirmation (the daemon/mock mutation ran).
      await waitFor(() => expect(screen.getByText(/switched to Opus/i)).toBeTruthy());
      await userEvent.keyboard("{Escape}");
    });

    await step("The operator is not listed as crew", async () => {
      const canvas = within(canvasElement);
      expect(await canvas.findByText("In this group")).toBeTruthy();
      expect(canvasElement.querySelector('[data-vim-item="agent-you"]')).toBeNull();
    });
  },
};
