import type { Decorator } from "@storybook/react-vite";
import baseMeta, * as base from "./ActivityView.stories.tsx";

// Dark-theme sibling of ActivityView — the SAME component, rendered with the
// canonical dark palette (kanagawa-wave, DEFAULT_DARK_THEME) so the gallery shows
// the real dark mode alongside light ActivityView.
const dark: Decorator = (Story) => {
  if (typeof document !== "undefined") {
    document.documentElement.dataset["theme"] = "kanagawa-wave";
    document.documentElement.dataset["skin"] = "brutal";
  }
  return <Story />;
};

const meta = {
  ...baseMeta,
  title: "Activity/ActivityView Dark",
  globals: { ...((baseMeta as { globals?: Record<string, unknown> }).globals ?? {}), theme: "kanagawa-wave" },
  decorators: [dark, ...(baseMeta.decorators ?? [])],
};
export default meta;

export const Grouped = base.Grouped;
export const WideThreadPane = base.WideThreadPane;
