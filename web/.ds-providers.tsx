// Generated for /design-sync — exposes the data-source provider + a ready,
// seeded mock DataSource on window.SynchronizeWeb so cfg.provider can wrap every
// preview in the SAME provider instances the components read from (the bundled
// .storybook decorator builds a separate context instance → "Provider missing").
// The other providers (ContextMenu/Toast/ArchiveRecovery) ride the barrel.
export { DataSourceProvider } from "./src/data/context.tsx";
import { MockDataSource } from "./src/data/mock.ts";

export const mockDataSource = new MockDataSource();

// Mirror .storybook/preview.tsx's theme decorator: the app reads data-theme /
// data-skin off documentElement. Set them at bundle load (light / brutal — the
// storybook initialGlobals) so previews render themed before first paint.
if (typeof document !== "undefined") {
  document.documentElement.dataset["theme"] = "light";
  document.documentElement.dataset["skin"] = "brutal";
}
