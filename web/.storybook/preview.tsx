import type { Preview } from "@storybook/react-vite";
import { StorybookProviders } from "../src/storybook/StorybookProviders.tsx";

// Exact same CSS stack as the app — both import the one shared list so they can
// never drift (a previous hand-kept copy here silently lost tokens.css).
import "../src/styles/css.ts";

// Product themes (palette) and skins (aesthetic layer) — the SAME contract the
// app uses (App.tsx writes documentElement.dataset.theme / .skin; styles.css owns
// the [data-theme]/[data-skin] blocks). No Storybook-only theme system.
export const globalTypes = {
  theme: {
    description: "Palette (data-theme)",
    toolbar: {
      title: "Theme",
      icon: "paintbrush",
      dynamicTitle: true,
      // Canonical pair: Light + Kanagawa Wave. Kanagawa is the only supported
      // dark palette.
      items: [
        { value: "light", title: "Light" },
        { value: "kanagawa-wave", title: "Kanagawa Wave" },
        { value: "rose-pine-dawn", title: "Rosé Pine Dawn" },
      ],
    },
  },
  skin: {
    description: "Aesthetic layer (data-skin)",
    toolbar: {
      title: "Skin",
      icon: "contrast",
      dynamicTitle: true,
      items: [
        { value: "brutal", title: "Brutal" },
        { value: "glass", title: "Glass" },
      ],
    },
  },
};

export const initialGlobals = { theme: "light", skin: "brutal" };

const preview: Preview = {
  // Every component gets an auto-generated Docs page (args/argTypes table) so the
  // catalog answers "what UI pieces exist and what props do they take" with no
  // per-component doc writing.
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    // Responsive matrix incl. Android-class widths (sync-i24s.4): mobile stories
    // must show no horizontal overflow at 390/412.
    viewport: {
      options: {
        mobileNarrow: { name: "Mobile narrow · 390", styles: { width: "390px", height: "844px" } },
        androidPixel: { name: "Android · 412", styles: { width: "412px", height: "915px" } },
        tablet: { name: "Tablet · 768", styles: { width: "768px", height: "1024px" } },
        mediumShell: { name: "Medium shell · 1024", styles: { width: "1024px", height: "800px" } },
        desktop: { name: "Desktop · 1440", styles: { width: "1440px", height: "900px" } },
      },
    },
  },
  decorators: [
    // Map toolbar globals onto the real document attributes the app uses, and tint
    // the canvas with the theme's paper token so the whole preview reflects it.
    (Story, context) => {
      const root = document.documentElement;
      const requestedTheme = context.globals["theme"];
      root.dataset["theme"] =
        requestedTheme === "kanagawa-wave" || requestedTheme === "rose-pine-dawn" || requestedTheme === "light"
          ? requestedTheme
          : "kanagawa-wave";
      root.dataset["skin"] = context.globals["skin"] ?? "brutal";
      document.body.style.background = "var(--paper)";
      return <Story />;
    },
    (Story) => (
      <StorybookProviders>
        <Story />
      </StorybookProviders>
    ),
  ],
};

export default preview;
