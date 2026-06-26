import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, within, userEvent, expect } from "storybook/test";
import { AgentColorPicker } from "./AgentColorPicker.tsx";
import { AGENTS } from "../data/seed.ts";
import { normalizeIdentityColorRef } from "../theme/identity.ts";

const atlas = AGENTS.find((a) => a.id === "atlas")!;
const you = AGENTS.find((a) => a.id === "you")!;
const pulse = AGENTS.find((a) => a.id === "pulse")!;

// Pure-prop popover: it's `fixed` and anchored to screen coords, so pin it a bit
// in from the top-left corner of the canvas so the whole popover is visible.
const meta = {
  title: "Agent States/AgentColorPicker",
  component: AgentColorPicker,
  parameters: { layout: "fullscreen" },
  args: {
    x: 32,
    y: 32,
    onPick: fn(),
    onReset: fn(),
    onClose: fn(),
  },
} satisfies Meta<typeof AgentColorPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

const colorRefFor = (agent: typeof atlas) => agent.colorRef ?? normalizeIdentityColorRef(agent.color, agent.id);

// Atlas's seeded legacy color maps to an identity slot, so that slot shows the
// selected checkmark under the active Storybook theme.
export const OnPaletteSwatch: Story = {
  args: {
    agentName: atlas.name,
    currentRef: colorRefFor(atlas),
    defaultRef: colorRefFor(atlas),
  },
};

// A custom current color: no slot is marked selected, and the custom input
// carries the real hex.
export const CustomColor: Story = {
  args: {
    agentName: pulse.name,
    currentRef: { kind: "custom", hex: "#3B0A45" },
    defaultRef: colorRefFor(pulse),
  },
};

// The "You" identity maps through the neutral token path, exercising token refs.
export const BlackIdentity: Story = {
  args: {
    agentName: you.name,
    currentRef: colorRefFor(you),
    defaultRef: colorRefFor(you),
  },
};

// Picking a slot fires onPick with that slot ref.
export const PickingASwatch: Story = {
  args: {
    agentName: atlas.name,
    currentRef: colorRefFor(atlas),
    defaultRef: colorRefFor(atlas),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "slot 2" }));
    await expect(args.onPick).toHaveBeenCalledWith({ kind: "slot", slot: 2 });
  },
};
