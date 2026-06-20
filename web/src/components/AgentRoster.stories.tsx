import type { Meta, StoryObj } from "@storybook/react-vite";
import { AgentRoster } from "./AgentRoster.tsx";
import { GROUPS } from "../data/seed.ts";
import { inRosterColumn } from "../storybook/shellFrames.tsx";

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
