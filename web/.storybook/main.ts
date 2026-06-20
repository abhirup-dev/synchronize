import type { StorybookConfig } from "@storybook/react-vite";
import tailwindcss from "@tailwindcss/vite";

// Storybook runs on its own Vite pipeline (dev-only). The production /web bundle
// stays on Bun (web/build.ts + bun-plugin-tailwind) and is untouched. tw.css uses
// Tailwind v4 `@import "tailwindcss/..."`, which Bun's plugin compiles but Vite
// does not — so we add @tailwindcss/vite here to compile the same entry.
const config: StorybookConfig = {
  stories: ["../src/**/*.mdx", "../src/**/*.stories.@(ts|tsx)"],
  framework: { name: "@storybook/react-vite", options: {} },
  // addon-mcp (preview) exposes a /mcp endpoint while `storybook dev` runs, so
  // Claude/Codex can query the component glossary and docs. The docs/dev toolsets
  // work today; the test toolset (run-story-tests) lights up with sync-i24s.3.
  addons: ["@storybook/addon-docs", "@storybook/addon-mcp", "@storybook/addon-vitest", "@storybook/addon-a11y"],
  core: { disableTelemetry: true },
  viteFinal: async (cfg) => {
    cfg.plugins = cfg.plugins ?? [];
    cfg.plugins.push(tailwindcss());
    return cfg;
  },
};

export default config;
