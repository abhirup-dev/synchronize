import type { Preview } from "@storybook/react-vite";
import { StorybookProviders } from "../src/storybook/StorybookProviders.tsx";

// Same CSS stack as src/main.tsx, in the same order, so stories render with the
// real production styling instead of unstyled HTML.
import "../src/tw.css";
import "../src/styles.css";
import "../src/components/extra.css";
import "../src/components/activity.css";
import "../src/chat-bg.css";
import "../src/skin-glass.css";
import "highlight.js/styles/github-dark.css";

const preview: Preview = {
  // Every component gets an auto-generated Docs page (args/argTypes table) so the
  // catalog answers "what UI pieces exist and what props do they take" with no
  // per-component doc writing.
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
  decorators: [
    (Story) => (
      <StorybookProviders>
        <Story />
      </StorybookProviders>
    ),
  ],
};

export default preview;
