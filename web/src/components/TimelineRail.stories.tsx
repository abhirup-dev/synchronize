import type { Meta, StoryObj } from "@storybook/react-vite";
import { TimelineRail } from "./TimelineRail.tsx";
import { GROUPS } from "../data/seed.ts";

// Provider-backed: TimelineRail reads events through useTimeline(roomId) (plus
// useAgents/useRooms) off the MockDataSource supplied by the global
// StorybookProviders decorator. It takes a single `roomId` prop. The MockDataSource
// is seeded from TIMELINE, which only carries events for "checkout-revamp" — every
// other room id resolves to the empty "no events yet" state.
const populatedRoom = GROUPS.find((r) => r.id === "checkout-revamp")!;
const emptyRoom = GROUPS.find((r) => r.id === "ml-ranking")!;

const meta = {
  title: "Surfaces/TimelineRail",
  component: TimelineRail,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof TimelineRail>;

export default meta;
type Story = StoryObj<typeof meta>;

// checkout-revamp seeds the full event spread: kickoff, claim, analyze, review,
// deliver, ship — exercising distinct node colors/glyphs and the count badge.
export const Populated: Story = {
  args: { roomId: populatedRoom.id },
};

// A room with no timeline events renders the dimmed "no events yet" empty state
// with a 0 count badge.
export const Empty: Story = {
  args: { roomId: emptyRoom.id },
};
