import type { Decorator } from "@storybook/react-vite";
import baseMeta, * as base from "./ThreadSummaryPanel.stories.tsx";

// Glass-skin sibling of ThreadSummaryPanel — the SAME component, rendered with
// the glass aesthetic layer (data-skin="glass"; skin-glass.css) so the gallery
// shows the real glass treatment alongside the brutal default. Component is
// skin-agnostic; this just pins the skin on the root.
const glass: Decorator = (Story) => {
  if (typeof document !== "undefined") {
    document.documentElement.dataset["skin"] = "glass";
  }
  return <Story />;
};

const meta = {
  ...baseMeta,
  title: "Surfaces/ThreadSummaryPanel Glass",
  globals: { ...((baseMeta as { globals?: Record<string, unknown> }).globals ?? {}), skin: "glass" },
  decorators: [glass, ...((baseMeta as { decorators?: Decorator[] }).decorators ?? [])],
};
export default meta;

export const Populated = base.Populated;
export const SingleThread = base.SingleThread;
export const Empty = base.Empty;
