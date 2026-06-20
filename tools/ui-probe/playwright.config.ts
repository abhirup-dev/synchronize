import { defineConfig, devices } from "@playwright/test";

const artifactDir = process.env.UI_PROBE_ARTIFACT_DIR ?? "tools/ui-probe/artifacts/latest";

export default defineConfig({
  testDir: "./probes",
  testMatch: /.*\.probe\.ts/,
  outputDir: `${artifactDir}/playwright-results`,
  timeout: 60_000,
  fullyParallel: false,
  reporter: [
    ["list"],
    ["json", { outputFile: `${artifactDir}/playwright-report.json` }],
  ],
  use: {
    baseURL: process.env.UI_PROBE_BASE_URL,
    screenshot: "only-on-failure",
    trace: "on",
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 960 },
      },
    },
    {
      name: "compact",
      use: {
        ...devices["Pixel 7"],
      },
    },
  ],
});
