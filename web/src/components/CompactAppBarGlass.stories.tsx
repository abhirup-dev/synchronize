import type { Decorator } from "@storybook/react-vite";
import baseMeta, * as base from "./CompactAppBar.stories.tsx";

// Glass-skin sibling of CompactAppBar — the SAME component, rendered with the
// glass aesthetic layer (data-skin="glass"; skin-glass.css) so the gallery shows
// the real glass treatment alongside the brutal default. Component is
// skin-agnostic; this just pins the skin on the root.
const glass: Decorator = (Story) => {
  if (typeof document !== "undefined") {
    document.documentElement.dataset["skin"] = "glass";
  }
  return <Story />;
};

const meta = {
  ...baseMeta,
  title: "Navigation/CompactAppBar Glass",
  globals: { ...((baseMeta as { globals?: Record<string, unknown> }).globals ?? {}), skin: "glass" },
  decorators: [glass, ...((baseMeta as { decorators?: Decorator[] }).decorators ?? [])],
};
export default meta;

export const ChatsOverlay = base.ChatsOverlay;
export const AgentsOverlay = base.AgentsOverlay;
export const LongTitle = base.LongTitle;
export const Controls = base.Controls;
