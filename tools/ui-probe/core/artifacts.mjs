import { mkdirSync } from "node:fs";
import { join } from "node:path";

export const artifactDir = process.env.UI_PROBE_ARTIFACT_DIR ?? "tools/ui-probe/artifacts/latest";
export const screenshotDir = join(artifactDir, "screenshots");

export function ensureScreenshotDir() {
  mkdirSync(screenshotDir, { recursive: true });
  return screenshotDir;
}

export function screenshotPath(filename) {
  ensureScreenshotDir();
  return join(screenshotDir, filename);
}
