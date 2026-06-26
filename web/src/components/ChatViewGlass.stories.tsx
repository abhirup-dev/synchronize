import type { Decorator } from "@storybook/react-vite";
import baseMeta, * as base from "./ChatView.stories.tsx";

// Glass-skin sibling of ChatView — the SAME component, rendered with the glass
// aesthetic layer (data-skin="glass"; skin-glass.css + chat-bg.css shine-through)
// so the gallery shows the real glass treatment alongside the brutal default.
// Component is skin-agnostic; this just pins the skin on the root, the same
// contract the app uses (App.tsx writes documentElement.dataset.skin).
const glass: Decorator = (Story) => {
  if (typeof document !== "undefined") {
    document.documentElement.dataset["skin"] = "glass";
  }
  return <Story />;
};

const meta = {
  ...baseMeta,
  title: "Surfaces/ChatView Glass",
  globals: { ...((baseMeta as { globals?: Record<string, unknown> }).globals ?? {}), skin: "glass" },
  decorators: [glass, ...((baseMeta as { decorators?: Decorator[] }).decorators ?? [])],
};
export default meta;

export const GroupConversation = base.GroupConversation;
export const DirectMessage = base.DirectMessage;
export const Quiet = base.Quiet;
export const WithThreadSummary = base.WithThreadSummary;
export const ThreadOpen = base.ThreadOpen;
