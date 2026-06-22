import type { Decorator } from "@storybook/react-vite";
import baseMeta, * as base from "./Sidebar.stories.tsx";

// Dark-theme sibling of Sidebar — the SAME component, rendered with the canonical
// dark palette (kanagawa-wave, DEFAULT_DARK_THEME) so the gallery shows the real
// dark mode alongside light Sidebar.
const dark: Decorator = (Story) => {
  if (typeof document !== "undefined") {
    document.documentElement.dataset["theme"] = "kanagawa-wave";
    document.documentElement.dataset["skin"] = "brutal";
  }
  return <Story />;
};

const meta = {
  ...baseMeta,
  title: "Navigation/Sidebar Dark",
  globals: { ...((baseMeta as { globals?: Record<string, unknown> }).globals ?? {}), theme: "kanagawa-wave" },
  decorators: [dark, ...(baseMeta.decorators ?? [])],
};
export default meta;

export const GroupSelected = base.GroupSelected;
export const DmSelected = base.DmSelected;
export const ActivityDock = base.ActivityDock;
export const TypingMode = base.TypingMode;
