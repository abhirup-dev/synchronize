import type { Decorator } from "@storybook/react-vite";
import baseMeta, * as base from "./ChatView.stories.tsx";

// Dark-theme sibling of ChatView — the SAME component, rendered with
// data-theme="dark" so the gallery shows the dark palette alongside the light
// ChatView. The component is theme-agnostic; this just pins the theme.
const dark: Decorator = (Story) => {
  if (typeof document !== "undefined") {
    document.documentElement.dataset["theme"] = "dark";
    document.documentElement.dataset["skin"] = "brutal";
  }
  return <Story />;
};

const meta = {
  ...baseMeta,
  title: "Surfaces/ChatView Dark",
  globals: { ...((baseMeta as { globals?: Record<string, unknown> }).globals ?? {}), theme: "dark" },
  decorators: [dark, ...(baseMeta.decorators ?? [])],
};
export default meta;

export const GroupConversation = base.GroupConversation;
export const DirectMessage = base.DirectMessage;
export const Quiet = base.Quiet;
export const WithThreadSummary = base.WithThreadSummary;
export const ThreadOpen = base.ThreadOpen;
