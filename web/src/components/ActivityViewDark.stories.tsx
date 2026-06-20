import type { Decorator } from "@storybook/react-vite";
import baseMeta, * as base from "./ActivityView.stories.tsx";

// Dark-theme sibling of ActivityView — the SAME component, rendered with
// data-theme="dark" so the gallery shows the dark palette alongside light ActivityView.
const dark: Decorator = (Story) => {
  if (typeof document !== "undefined") {
    document.documentElement.dataset["theme"] = "dark";
    document.documentElement.dataset["skin"] = "brutal";
  }
  return <Story />;
};

const meta = {
  ...baseMeta,
  title: "Activity/ActivityView Dark",
  globals: { ...((baseMeta as { globals?: Record<string, unknown> }).globals ?? {}), theme: "dark" },
  decorators: [dark, ...(baseMeta.decorators ?? [])],
};
export default meta;

export const Grouped = base.Grouped;
export const WideThreadPane = base.WideThreadPane;
