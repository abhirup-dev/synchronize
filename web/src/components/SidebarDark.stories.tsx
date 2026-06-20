import type { Decorator } from "@storybook/react-vite";
import baseMeta, * as base from "./Sidebar.stories.tsx";

// Dark-theme sibling of Sidebar — the SAME component, rendered with
// data-theme="dark" so the gallery shows the dark palette alongside light Sidebar.
const dark: Decorator = (Story) => {
  if (typeof document !== "undefined") {
    document.documentElement.dataset["theme"] = "dark";
    document.documentElement.dataset["skin"] = "brutal";
  }
  return <Story />;
};

const meta = {
  ...baseMeta,
  title: "Navigation/Sidebar Dark",
  globals: { ...((baseMeta as { globals?: Record<string, unknown> }).globals ?? {}), theme: "dark" },
  decorators: [dark, ...(baseMeta.decorators ?? [])],
};
export default meta;

export const GroupSelected = base.GroupSelected;
export const DmSelected = base.DmSelected;
export const ActivityDock = base.ActivityDock;
export const TypingMode = base.TypingMode;
