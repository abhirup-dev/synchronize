#!/usr/bin/env bun
// Production build for the synchronize web UI: bun run web/build.ts
//
// web/index.html is the entrypoint, not a template. Bun follows its module
// script, bundles it, and rewrites the tags to hashed filenames. The Vite dev
// server serves that same file verbatim, so dev and production cannot drift.

import { rm, mkdir } from "node:fs/promises";
import tailwind from "bun-plugin-tailwind";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";

const ROOT = dirname(new URL(import.meta.url).pathname);
const DIST = join(ROOT, "dist");
const ASSET_BASE = "/web/";
const HTML_IN = join(ROOT, "index.html");

async function build(): Promise<void> {
  const t0 = performance.now();
  if (existsSync(DIST)) await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  const result = await Bun.build({
    entrypoints: [HTML_IN],
    outdir: DIST,
    target: "browser",
    plugins: [tailwind],
    format: "esm",
    splitting: true,
    minify: true,
    sourcemap: "linked",
    // Absolute: the daemon answers /web, /web/ and /web/index.html alike, and
    // relative ./ paths break the bare /web form.
    publicPath: ASSET_BASE,
    // No `entry` rule — index.html keeps a stable name for the daemon to serve.
    // Hashed chunks/assets are what the daemon's immutable-cache regex matches
    // (src/daemon/server.ts).
    naming: {
      chunk: "[name].[hash].[ext]",
      asset: "[name].[hash].[ext]",
    },
    // App.tsx gates ThemeTokenEditor on this folding to "production": without it
    // the dev-only token editor ships and `process` is undefined in the browser.
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
  });

  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error("web build failed");
  }

  const emitted = result.outputs
    .map((output) => output.path.split("/").pop()!)
    .filter((name) => name.endsWith(".js") || name.endsWith(".css"))
    .sort();
  const dt = (performance.now() - t0).toFixed(0);
  console.log(`web bundle: ${emitted.join(" + ")} (${dt} ms)`);
}

await build();
