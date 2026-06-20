import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { ResizeHandle } from "./ResizeHandle.tsx";

// ResizeHandle is absolutely positioned against `--thread-pane-width` and drags
// the right-hand pane wider/narrower. The handle has no standalone render, so
// each story wires it into a two-pane layout that mirrors the chat + thread
// shell, driving `--thread-pane-width` from the live `width` state.
function PaneSplit({
  initial,
  min,
  max,
}: {
  initial: number;
  min?: number;
  max?: number;
}) {
  const [width, setWidth] = useState(initial);
  return (
    <div
      style={
        {
          position: "relative",
          display: "flex",
          height: "100%",
          background: "var(--paper)",
          "--thread-pane-width": `${width}px`,
        } as React.CSSProperties
      }
    >
      <div
        style={{
          flex: 1,
          minWidth: 0,
          padding: 24,
          color: "var(--ink)",
          fontSize: 13,
          lineHeight: 1.6,
        }}
      >
        <strong>Chat column</strong>
        <p>Grab the divider on the right and drag left to widen the thread pane.</p>
        <p>
          Pane width: <code>{Math.round(width)}px</code> (clamp {min ?? 320}–{max ?? 820})
        </p>
      </div>
      <div
        style={{
          width,
          flexShrink: 0,
          borderLeft: "1px solid var(--rule)",
          padding: 24,
          color: "var(--ink)",
          fontSize: 13,
          background: "color-mix(in srgb, var(--ink) 4%, transparent)",
        }}
      >
        <strong>Thread pane</strong>
        <p>Resizes as you drag.</p>
      </div>
      <ResizeHandle
        width={width}
        onChange={setWidth}
        {...(min !== undefined ? { min } : {})}
        {...(max !== undefined ? { max } : {})}
      />
    </div>
  );
}

const meta = {
  title: "Primitives/ResizeHandle",
  component: ResizeHandle,
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj;

// Default clamp (320–820), pane parked at its design default width.
export const Default: Story = {
  render: () => <PaneSplit initial={460} />,
};

// Pinned to the minimum width — dragging right is a no-op, left widens.
export const AtMinWidth: Story = {
  render: () => <PaneSplit initial={320} />,
};

// Pinned to the maximum width — dragging left is a no-op, right narrows.
export const AtMaxWidth: Story = {
  render: () => <PaneSplit initial={820} />,
};

// A tighter clamp range exercises the min/max props directly.
export const NarrowClamp: Story = {
  render: () => <PaneSplit initial={300} min={240} max={400} />,
};
