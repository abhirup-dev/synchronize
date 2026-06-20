import { defineConfig, devices } from "@playwright/test";

const artifactDir = process.env.UI_PROBE_ARTIFACT_DIR ?? "tools/ui-probe/artifacts/latest";
const mode = process.env.UI_PROBE_MODE ?? "offline";
const isDemo = mode === "demo";
const slowMo = Number(process.env.UI_PROBE_SLOW_MO_MS ?? (isDemo ? "500" : "0"));

const desktopProject = {
  name: "desktop",
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 960 },
  },
};

export default defineConfig({
  testDir: "./probes",
  testMatch: /.*\.probe\.ts/,
  outputDir: `${artifactDir}/playwright-results`,
  timeout: 60_000,
  fullyParallel: false,
  workers: isDemo ? 1 : undefined,
  reporter: [
    ["list"],
    ["json", { outputFile: `${artifactDir}/playwright-report.json` }],
  ],
  use: {
    baseURL: process.env.UI_PROBE_BASE_URL,
    headless: !isDemo,
    launchOptions: slowMo > 0 ? { slowMo } : undefined,
    screenshot: "only-on-failure",
    trace: "on",
    video: isDemo ? "on" : "retain-on-failure",
  },
  projects: isDemo ? [desktopProject] : [
    desktopProject,
    {
      name: "compact",
      use: {
        ...devices["Pixel 7"],
      },
    },
  ],
});
