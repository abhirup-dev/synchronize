import type { Decorator } from "@storybook/react-vite";
import baseMeta, * as base from "./BoardView.stories.tsx";

// Dark-theme sibling of BoardView — the SAME component, rendered with the canonical
// dark palette (kanagawa-wave, DEFAULT_DARK_THEME) so the gallery shows the real
// dark mode alongside light BoardView.
const dark: Decorator = (Story) => {
  if (typeof document !== "undefined") {
    document.documentElement.dataset["theme"] = "kanagawa-wave";
    document.documentElement.dataset["skin"] = "brutal";
  }
  return <Story />;
};

const meta = {
  ...baseMeta,
  title: "Surfaces/BoardView Dark",
  globals: { ...((baseMeta as { globals?: Record<string, unknown> }).globals ?? {}), theme: "kanagawa-wave" },
  decorators: [dark, ...((baseMeta as { decorators?: Decorator[] }).decorators ?? [])],
};
export default meta;

export const Populated = base.Populated;
export const Empty = base.Empty;
