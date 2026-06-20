import type { Meta, StoryObj } from "@storybook/react-vite";
import { within, userEvent, expect } from "storybook/test";
import { SpawnAgentDialog } from "./SpawnAgentDialog.tsx";
import { GROUPS } from "../data/seed.ts";
import type { Room } from "../data/types.ts";

// Base room from seed; the dialog only reads room-scoped launch metadata
// (paths / launchTools / memberAliases), which the seed group omits, so we
// derive enriched variants here rather than duplicating seed data.
const base = GROUPS.find((r) => r.id === "checkout-revamp")!;

const withLaunchConfig: Room = {
  ...base,
  paths: [
    { id: "p1", path: "/Users/dev/work/checkout-revamp", label: "checkout-revamp" },
    { id: "p2", path: "/Users/dev/work/checkout-revamp/web" },
  ],
  launchTools: {
    claude: { tool: "claude", available: true, path: "/usr/local/bin/claude" },
    pi: { tool: "pi", available: true, path: "/usr/local/bin/pi" },
  },
  memberAliases: { cortex: "cortex", atlas: "atlas" },
};

// Pi is uninstalled — the component falls back to the first available tool
// (Claude) and renders the Pi radio disabled with a "not installed" meta.
const piUnavailable: Room = {
  ...withLaunchConfig,
  launchTools: {
    claude: { tool: "claude", available: true, path: "/usr/local/bin/claude" },
    pi: { tool: "pi", available: false },
  },
};

// Provider-backed: SpawnAgentDialog reads useSpawnAgent() + useToast() off the
// global StorybookProviders decorator and renders via a Base UI portal.
const meta = {
  title: "Agent States/SpawnAgentDialog",
  component: SpawnAgentDialog,
  parameters: { layout: "fullscreen" },
  args: { onClose: () => {} },
} satisfies Meta<typeof SpawnAgentDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

// Fully configured: two runtimes available, two launch paths, default name.
export const Default: Story = {
  args: { room: withLaunchConfig },
};

// No room-scoped paths or launch metadata at all — the Path fieldset is empty
// and tools default to available.
export const NoLaunchConfig: Story = {
  args: { room: base },
};

// Pi runtime not installed: it is disabled and the form defaults to Claude.
export const RuntimeUnavailable: Story = {
  args: { room: piUnavailable },
};

// Validation: clearing the required name and submitting surfaces an inline error.
export const NameRequiredValidation: Story = {
  args: { room: withLaunchConfig },
  play: async () => {
    const dialog = within(document.body);
    const name = await dialog.findByLabelText("Name");
    await userEvent.clear(name);
    const submit = dialog.getByRole("button", { name: "Spawn" });
    await userEvent.click(submit);
    const alert = await dialog.findByRole("alert");
    await expect(alert).toHaveTextContent("Name is required");
  },
};
