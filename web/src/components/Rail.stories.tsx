import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { within, userEvent, expect, fn, waitFor } from "storybook/test";
import {
  MessageSquare,
  LayoutGrid,
  FileText,
  List,
  Bell,
  AtSign,
  Rows3,
  ArrowDownUp,
  CheckCheck,
  Activity,
  ListFilter,
  ChevronDown,
} from "lucide-react";
import { Rail, RailSegment, RailChip } from "./rail.tsx";

// The Sigil expanding-rail control standard. A well holds square icon segments;
// the ONE active segment expands into a raised pane revealing its real label
// (+ optional count). Chips are standalone companions sharing the well surface.
const meta = {
  title: "Primitives/Rail",
  component: Rail,
  parameters: { layout: "centered" },
  // Every story supplies its own markup via `render`; this default satisfies the
  // required `children` prop so stories don't each repeat it.
  args: { children: null },
} satisfies Meta<typeof Rail>;

export default meta;
type Story = StoryObj<typeof meta>;

// Room-header tab rail: Chat/Board/Artifacts, Chat active.
export const Rest: Story = {
  render: () => (
    <Rail role="tablist" aria-label="Room surface">
      <RailSegment icon={<MessageSquare />} label="Chat" active onSelect={fn()} />
      <RailSegment icon={<LayoutGrid />} label="Board" onSelect={fn()} />
      <RailSegment icon={<FileText />} label="Artifacts" onSelect={fn()} />
    </Rail>
  ),
};

// The active segment expands to reveal its label pane.
export const ActiveWithLabel: Story = {
  render: () => (
    <Rail role="tablist" aria-label="Room surface">
      <RailSegment icon={<MessageSquare />} label="Chat" onSelect={fn()} />
      <RailSegment icon={<LayoutGrid />} label="Board" active onSelect={fn()} />
      <RailSegment icon={<FileText />} label="Artifacts" onSelect={fn()} />
    </Rail>
  ),
};

// Activity filters: the active segment also trails a count badge in last.
export const WithCountBadge: Story = {
  render: () => (
    <Rail role="tablist" aria-label="Activity filter">
      <RailSegment icon={<List />} label="All" count={128} onSelect={fn()} />
      <RailSegment icon={<Bell />} label="Awaiting" count={23} active onSelect={fn()} />
      <RailSegment icon={<AtSign />} label="Mentions" count={4} onSelect={fn()} />
    </Rail>
  ),
};

// Layout toggle expressed as a radiogroup (single-select, not tabs).
export const LayoutToggle: Story = {
  render: () => (
    <Rail role="radiogroup" aria-label="Activity layout">
      <RailSegment icon={<List />} label="Timeline" onSelect={fn()} />
      <RailSegment icon={<Rows3 />} label="Grouped" active onSelect={fn()} />
    </Rail>
  ),
};

// Companion chips: same height/surface as a well, never accent-filled except the
// live toggle's genuine active state. The sort chip carries aria-pressed and a
// tooltip that tracks direction.
export const Chips: Story = {
  render: () => {
    const [newest, setNewest] = useState(true);
    const [working, setWorking] = useState(false);
    return (
      <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        <RailChip
          icon={<ArrowDownUp />}
          pressed={newest}
          tooltip={newest ? "Sort: newest first" : "Sort: oldest first"}
          onClick={() => setNewest((v) => !v)}
        />
        <RailChip icon={<CheckCheck />} tooltip="Mark all read" onClick={fn()} />
        <RailChip
          icon={<Activity />}
          label="Working"
          active={working}
          pressed={working}
          tooltip="Only working agents"
          onClick={() => setWorking((v) => !v)}
        />
        <RailChip icon={<ListFilter />} label="Room" badge={12} trailing={<ChevronDown />} tooltip="Filter activity by room" ariaLabel="Filter rooms, all rooms" onClick={fn()} />
      </div>
    );
  },
};

export const ComposedMenuChip: Story = {
  render: () => (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <Rail role="tablist" aria-label="Activity filter">
        <RailSegment icon={<List />} label="All" count={30} active onSelect={fn()} />
        <RailSegment icon={<Bell />} label="Awaiting" count={10} onSelect={fn()} />
      </Rail>
      <RailChip icon={<ListFilter />} label="Room" badge={12} trailing={<ChevronDown />} tooltip="Filter activity by room" ariaLabel="Filter rooms, all rooms" onClick={fn()} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const segmentBadge = canvasElement.querySelector<HTMLElement>(".rail-seg-count");
    const chipBadge = canvasElement.querySelector<HTMLElement>(".rail-chip-badge");
    await expect(segmentBadge).toBeTruthy();
    await expect(chipBadge).toBeTruthy();
    const segmentStyle = getComputedStyle(segmentBadge!);
    const chipStyle = getComputedStyle(chipBadge!);
    await expect(chipStyle.borderRadius).toBe(segmentStyle.borderRadius);
    await expect(chipStyle.fontFamily).toBe(segmentStyle.fontFamily);
    await expect(chipStyle.fontSize).toBe(segmentStyle.fontSize);
  },
};

// Hover a collapsed (inactive) segment: after ~0.28s its label appears as a
// floating pill below. Active segments show their label inline, so they get no
// tooltip. (CSS `:hover` behaviour — verify visually via the toolbar sweep.)
export const HoverTooltip: Story = {
  render: () => (
    <Rail role="tablist" aria-label="Room surface">
      <RailSegment icon={<MessageSquare />} label="Chat" active onSelect={fn()} />
      <RailSegment icon={<LayoutGrid />} label="Board" onSelect={fn()} />
      <RailSegment icon={<FileText />} label="Artifacts" onSelect={fn()} />
    </Rail>
  ),
};

// ── Play tests ──────────────────────────────────────────────────────────────

// (1) Clicking a segment makes it the active pane and reveals its label.
export const SelectsSegment: Story = {
  render: () => {
    const [active, setActive] = useState(0);
    const tabs = [
      { icon: <MessageSquare />, label: "Chat" },
      { icon: <LayoutGrid />, label: "Board" },
      { icon: <FileText />, label: "Artifacts" },
    ];
    return (
      <Rail role="tablist" aria-label="Room surface">
        {tabs.map((t, i) => (
          <RailSegment
            key={t.label}
            icon={t.icon}
            label={t.label}
            active={active === i}
            onSelect={() => setActive(i)}
          />
        ))}
      </Rail>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const board = canvas.getByRole("tab", { name: "Board" });
    await userEvent.click(board);
    await expect(board).toHaveAttribute("aria-selected", "true");
    // The label pane opens (max-width animates 0 → 220px); wait for real width.
    const label = board.querySelector<HTMLElement>(".rail-seg-label");
    await waitFor(() => expect(label && label.offsetWidth).toBeGreaterThan(0));
  },
};

// (2) The "shrinking order" regression guard: every well is exactly 40px tall,
// every segment 32px, every chip 40px — measured, not asserted from CSS.
export const Geometry: Story = {
  render: () => (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <Rail role="tablist" aria-label="Room surface">
        <RailSegment icon={<MessageSquare />} label="Chat" active onSelect={fn()} />
        <RailSegment icon={<LayoutGrid />} label="Board" onSelect={fn()} />
        <RailSegment icon={<FileText />} label="Artifacts" onSelect={fn()} />
      </Rail>
      <RailChip icon={<ArrowDownUp />} tooltip="Sort" onClick={fn()} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const well = canvasElement.querySelector<HTMLElement>(".rail");
    await expect(well).not.toBeNull();
    await expect(Math.round(well!.getBoundingClientRect().height)).toBe(40);

    for (const seg of canvasElement.querySelectorAll<HTMLElement>(".rail-seg")) {
      await expect(Math.round(seg.getBoundingClientRect().height)).toBe(32);
    }
    for (const chip of canvasElement.querySelectorAll<HTMLElement>(".rail-chip")) {
      await expect(Math.round(chip.getBoundingClientRect().height)).toBe(40);
    }
  },
};

// (3) A collapsed (inactive) segment's label AND count badge must be fully
// collapsed to 0 width (the flex min-width:auto gotcha).
export const CollapsedIsZeroWidth: Story = {
  render: () => (
    <Rail role="tablist" aria-label="Activity filter">
      <RailSegment icon={<List />} label="All" count={128} active onSelect={fn()} />
      <RailSegment icon={<Bell />} label="Awaiting" count={23} onSelect={fn()} />
      <RailSegment icon={<AtSign />} label="Mentions" count={4} onSelect={fn()} />
    </Rail>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const collapsed = canvas.getByRole("tab", { name: /Awaiting/ });
    const label = collapsed.querySelector<HTMLElement>(".rail-seg-label");
    const count = collapsed.querySelector<HTMLElement>(".rail-seg-count");
    await expect(label).not.toBeNull();
    await expect(count).not.toBeNull();
    await expect(label!.offsetWidth).toBe(0);
    await expect(count!.offsetWidth).toBe(0);
  },
};
