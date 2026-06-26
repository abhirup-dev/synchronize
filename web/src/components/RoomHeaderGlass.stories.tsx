import type { Decorator } from "@storybook/react-vite";
import baseMeta, * as base from "./RoomHeader.stories.tsx";

// Glass-skin sibling of RoomHeader — the SAME component, rendered with the glass
// aesthetic layer (data-skin="glass"; skin-glass.css topbar backdrop) so the
// gallery shows the real glass treatment alongside the brutal default. skin is
// also passed as a prop so the display-settings toggle label agrees with the
// rendered surface.
const glass: Decorator = (Story) => {
  if (typeof document !== "undefined") {
    document.documentElement.dataset["skin"] = "glass";
  }
  return <Story />;
};

const meta = {
  ...baseMeta,
  title: "Navigation/RoomHeader Glass",
  args: { ...((baseMeta as { args?: Record<string, unknown> }).args ?? {}), skin: "glass" },
  globals: { ...((baseMeta as { globals?: Record<string, unknown> }).globals ?? {}), skin: "glass" },
  decorators: [glass, ...((baseMeta as { decorators?: Decorator[] }).decorators ?? [])],
};
export default meta;

export const Group = base.Group;
export const DirectMessage = base.DirectMessage;
export const LongTitleAndDescription = base.LongTitleAndDescription;
export const Compact = base.Compact;
