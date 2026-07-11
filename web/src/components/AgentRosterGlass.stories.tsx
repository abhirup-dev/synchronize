import type { Decorator } from "@storybook/react-vite";
import baseMeta, * as base from "./AgentRoster.stories.tsx";

// Glass-skin sibling of AgentRoster — the SAME component, rendered with the
// glass aesthetic layer (data-skin="glass"; skin-glass.css translucent roster
// head) so the gallery shows the real glass treatment alongside the brutal
// default. Component is skin-agnostic; this just pins the skin on the root.
// Header is intentionally not re-exported: its base story pins skin="brutal" in
// story globals, which would override the glass layer.
const glass: Decorator = (Story) => {
  if (typeof document !== "undefined") {
    document.documentElement.dataset["skin"] = "glass";
  }
  return <Story />;
};

const meta = {
  ...baseMeta,
  title: "Navigation/AgentRoster Glass",
  globals: { ...((baseMeta as { globals?: Record<string, unknown> }).globals ?? {}), skin: "glass" },
  decorators: [glass, ...((baseMeta as { decorators?: Decorator[] }).decorators ?? [])],
};
export default meta;

export const Default = base.Default;
export const AllStatuses = base.AllStatuses;
