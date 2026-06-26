import type { Decorator } from "@storybook/react-vite";
import baseMeta, * as base from "./TimelineRail.stories.tsx";

// Glass-skin sibling of TimelineRail — the SAME component, rendered with the
// glass aesthetic layer (data-skin="glass"; skin-glass.css translucent nodes +
// tooltips) so the gallery shows the real glass treatment alongside the brutal
// default. Component is skin-agnostic; this just pins the skin on the root.
const glass: Decorator = (Story) => {
  if (typeof document !== "undefined") {
    document.documentElement.dataset["skin"] = "glass";
  }
  return <Story />;
};

const meta = {
  ...baseMeta,
  title: "Surfaces/TimelineRail Glass",
  globals: { ...((baseMeta as { globals?: Record<string, unknown> }).globals ?? {}), skin: "glass" },
  decorators: [glass, ...((baseMeta as { decorators?: Decorator[] }).decorators ?? [])],
};
export default meta;

export const Populated = base.Populated;
export const Empty = base.Empty;
