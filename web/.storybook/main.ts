import type { StorybookConfig } from "@storybook/react-vite";
import tailwindcss from "@tailwindcss/vite";

// Storybook runs on its own Vite pipeline (dev-only). The production /web bundle
// stays on Bun (web/build.ts + bun-plugin-tailwind) and is untouched. tw.css uses
// Tailwind v4 `@import "tailwindcss/..."`, which Bun's plugin compiles but Vite
// does not — so we add @tailwindcss/vite here to compile the same entry.
const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  framework: { name: "@storybook/react-vite", options: {} },
  addons: [],
  core: { disableTelemetry: true },
  viteFinal: async (cfg) => {
    cfg.plugins = cfg.plugins ?? [];
    cfg.plugins.push(tailwindcss());
    return cfg;
  },
};

export default config;
