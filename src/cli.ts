#!/usr/bin/env bun
export { main } from "./cli/index.ts";
export { renderSummary } from "./cli/render/summary.ts";

import { main } from "./cli/index.ts";

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
