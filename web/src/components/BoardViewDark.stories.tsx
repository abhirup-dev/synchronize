import type { Decorator } from "@storybook/react-vite";
import baseMeta, * as base from "./BoardView.stories.tsx";

// Dark-theme sibling of BoardView — the SAME component, rendered with
// data-theme="dark" so the gallery shows the dark palette alongside light BoardView.
const dark: Decorator = (Story) => {
  if (typeof document !== "undefined") {
    document.documentElement.dataset["theme"] = "dark";
    document.documentElement.dataset["skin"] = "brutal";
  }
  return <Story />;
};

const meta = {
  ...baseMeta,
  title: "Surfaces/BoardView Dark",
  globals: { ...((baseMeta as { globals?: Record<string, unknown> }).globals ?? {}), theme: "dark" },
  decorators: [dark, ...(baseMeta.decorators ?? [])],
};
export default meta;

export const Populated = base.Populated;
export const Empty = base.Empty;
