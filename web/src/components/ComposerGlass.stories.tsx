import type { Decorator } from "@storybook/react-vite";
import baseMeta, * as base from "./Composer.stories.tsx";

// Glass-skin sibling of Composer — the SAME component, rendered with the glass
// aesthetic layer (data-skin="glass"; skin-glass.css translucent composer bar)
// so the gallery shows the real glass treatment alongside the brutal default.
// Component is skin-agnostic; this just pins the skin on the root.
const glass: Decorator = (Story) => {
  if (typeof document !== "undefined") {
    document.documentElement.dataset["skin"] = "glass";
  }
  return <Story />;
};

const meta = {
  ...baseMeta,
  title: "Composer/Composer Glass",
  globals: { ...((baseMeta as { globals?: Record<string, unknown> }).globals ?? {}), skin: "glass" },
  decorators: [glass, ...((baseMeta as { decorators?: Decorator[] }).decorators ?? [])],
};
export default meta;

export const Default = base.Default;
export const ThreadReply = base.ThreadReply;
export const Collapsed = base.Collapsed;
export const WithThreadSummary = base.WithThreadSummary;
export const DirectMessage = base.DirectMessage;
export const Compact = base.Compact;
