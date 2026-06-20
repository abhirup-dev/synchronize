import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, within, userEvent, expect } from "storybook/test";
import { AgentColorPicker } from "./AgentColorPicker.tsx";
import { AGENTS } from "../data/seed.ts";

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

// Atlas's seeded color (#FF5DA2) is one of the palette swatches, so the "pink"
// swatch shows the selected ✓ outline.
export const OnPaletteSwatch: Story = {
  args: {
    agentName: atlas.name,
    currentHex: atlas.color,
    defaultHex: atlas.color,
  },
};

// An off-palette current color: no swatch is marked selected, and the custom
// input / default chip carry the real hex.
export const CustomColor: Story = {
  args: {
    agentName: pulse.name,
    currentHex: "#3B0A45",
    defaultHex: pulse.color,
  },
};

// The "You" identity is black (#111111) — a valid identity that lives outside
// the bright swatch grid, exercising the dark-ink contrast path.
export const BlackIdentity: Story = {
  args: {
    agentName: you.name,
    currentHex: you.color,
    defaultHex: you.color,
  },
};

// Picking a swatch fires onPick with that swatch's hex.
export const PickingASwatch: Story = {
  args: {
    agentName: atlas.name,
    currentHex: atlas.color,
    defaultHex: atlas.color,
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "blue" }));
    await expect(args.onPick).toHaveBeenCalledWith("#4D7CFE");
  },
};
