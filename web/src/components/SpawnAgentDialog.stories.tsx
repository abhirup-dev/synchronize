import type { Meta, StoryObj } from "@storybook/react-vite";
import { within, userEvent, expect } from "storybook/test";
import { SpawnAgentDialog } from "./SpawnAgentDialog.tsx";
import { GROUPS } from "../data/seed.ts";
import type { Room } from "../data/types.ts";
import type { MockLaunchFixture } from "../storybook/StorybookProviders.tsx";

// Two axes here, and they are deliberately different kinds of thing:
//   ROOM args      — launch PATHS and member aliases, which are room-scoped.
//   launch params  — which runtimes the DAEMON can spawn, which is not. It comes
//                    from the agents surface's scoped endpoint in the app, so a
//                    story supplies it the same way rather than as a room prop.
const base = GROUPS.find((r) => r.id === "checkout-revamp")!;

const withPaths: Room = {
  ...base,
  paths: [
    { id: "p1", path: "/Users/dev/work/checkout-revamp", label: "checkout-revamp" },
    { id: "p2", path: "/Users/dev/work/checkout-revamp/web" },
  ],
  memberAliases: { cortex: "cortex", atlas: "atlas" },
};

const bothRuntimes: MockLaunchFixture = {
  tools: {
    claude: { tool: "claude", available: true, path: "/usr/local/bin/claude" },
    pi: { tool: "pi", available: true, path: "/usr/local/bin/pi" },
  },
  profiles: [{ name: "glaude", tool: "claude", available: true, path: "/Users/dev/.local/bin/claude" }],
};

// Provider-backed: SpawnAgentDialog reads useSpawnAgent(), useToast() and the
// launch snapshots off the global StorybookProviders decorator, and renders via
// a Base UI portal.
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
  parameters: { launch: bothRuntimes },
  args: { room: withPaths },
};

// No launch paths and a daemon reporting no tooling — the Path fieldset is empty
// and tools fall back to available.
export const NoLaunchConfig: Story = {
  args: { room: base },
};

// Pi not installed: it is disabled and the form defaults to Claude.
export const RuntimeUnavailable: Story = {
  parameters: {
    launch: {
      tools: {
        claude: { tool: "claude", available: true, path: "/usr/local/bin/claude" },
        pi: { tool: "pi", available: false },
      },
    } satisfies MockLaunchFixture,
  },
  args: { room: withPaths },
};

// Validation: clearing the required name and submitting surfaces an inline error.
export const NameRequiredValidation: Story = {
  parameters: { launch: bothRuntimes },
  args: { room: withPaths },
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
