import type { Decorator } from "@storybook/react-vite";
import baseMeta, * as base from "./Sidebar.stories.tsx";

// Glass-skin sibling of Sidebar — the SAME component, rendered with the glass
// aesthetic layer (data-skin="glass"; skin-glass.css translucent user-bubble +
// dock buttons) so the gallery shows the real glass treatment alongside the
// brutal default. skin is also passed as a prop so the display-settings toggle
// label agrees with the rendered surface.
const glass: Decorator = (Story) => {
  if (typeof document !== "undefined") {
    document.documentElement.dataset["skin"] = "glass";
  }
  return <Story />;
};

const meta = {
  ...baseMeta,
  title: "Navigation/Sidebar Glass",
  args: { ...((baseMeta as { args?: Record<string, unknown> }).args ?? {}), skin: "glass" },
  globals: { ...((baseMeta as { globals?: Record<string, unknown> }).globals ?? {}), skin: "glass" },
  decorators: [glass, ...((baseMeta as { decorators?: Decorator[] }).decorators ?? [])],
};
export default meta;

export const GroupSelected = base.GroupSelected;
export const DmSelected = base.DmSelected;
export const ActivityDock = base.ActivityDock;
export const DisplaySettingsMenu = base.DisplaySettingsMenu;
export const TypingMode = base.TypingMode;
