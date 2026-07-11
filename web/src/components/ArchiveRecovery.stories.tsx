import type { Meta, StoryObj } from "@storybook/react-vite";
import { within, userEvent, expect } from "storybook/test";
import { useArchiveWorkflow } from "./ArchiveRecovery.tsx";
import { AGENTS, GROUPS } from "../data/seed.ts";
import { roomNameText } from "./primitives.tsx";

// Provider-backed surface: ArchiveRecoveryProvider is mounted by the global
// StorybookProviders decorator and seeds an archived session ("pulse") via the
// MockDataSource. There is no standalone render — the chrome (console, preview
// dialog) is driven imperatively through the useArchiveWorkflow() hook. Each
// story is a tiny in-file launcher that opens one entry point of the flow.
const pulse = AGENTS.find((a) => a.id === "pulse")!;
const room = GROUPS.find((r) => r.id === "checkout-revamp")!;

function ArchiveLauncher() {
  const workflow = useArchiveWorkflow();
  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      <button type="button" onClick={() => workflow.openConsole()}>
        Open archive console
      </button>
      <button type="button" onClick={() => workflow.archiveSession(pulse)}>
        Archive @pulse
      </button>
      <button type="button" onClick={() => workflow.resumeSession(pulse)}>
        Resume @pulse
      </button>
      <button type="button" onClick={() => workflow.archiveGroup(room)}>
        Archive {roomNameText(room.kind, room.name)}
      </button>
    </div>
  );
}

const meta = {
  title: "Surfaces/ArchiveRecovery",
  component: ArchiveLauncher,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ArchiveLauncher>;

export default meta;
type Story = StoryObj<typeof meta>;

// The launcher buttons themselves — the resting state with no overlay open.
export const Launcher: Story = {};

// Opens the archive console listing archived sessions and reserved group seats.
export const Console: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Open archive console" }));
    await expect(await within(document.body).findByRole("dialog", { name: "archive" })).toBeInTheDocument();
  },
};

// Opens the archive dry-run preview dialog for a single session.
export const ArchivePreview: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Archive @pulse" }));
    await expect(await within(document.body).findByRole("dialog", { name: "Archive Pulse" })).toBeInTheDocument();
  },
};

// Opens the resume dry-run preview, which may surface a "force" option for
// blocked/live sessions.
export const ResumePreview: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Resume @pulse" }));
    await expect(await within(document.body).findByRole("dialog", { name: "Resume Pulse" })).toBeInTheDocument();
  },
};
