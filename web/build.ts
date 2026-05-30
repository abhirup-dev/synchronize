#!/usr/bin/env bun
// Build pipeline for the synchronize web UI.
//
// Uses Bun's built-in bundler (no Vite / Webpack). Produces web/dist/ with:
//   - index.html        (rewritten to point at the hashed bundles)
//   - main.<hash>.js    (React bundle)
//   - main.<hash>.css   (stylesheet)
//   - <assets>          (any imported static files)
//
// Run:
//   bun run web/build.ts            # one-shot build
//   bun run web/build.ts --watch    # rebuild on change (poor man's HMR via reload)

import { rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";

const ROOT = dirname(new URL(import.meta.url).pathname);
const SRC = join(ROOT, "src");
const DIST = join(ROOT, "dist");
const HTML_IN = join(ROOT, "index.html");
const WATCH = process.argv.includes("--watch");

async function build(): Promise<void> {
  const t0 = performance.now();
  if (existsSync(DIST)) await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  const result = await Bun.build({
    entrypoints: [join(SRC, "main.tsx")],
    outdir: DIST,
    target: "browser",
    format: "esm",
    splitting: true,
    minify: !WATCH,
    sourcemap: WATCH ? "external" : "linked",
    naming: {
      entry: "[name].[hash].[ext]",
      chunk: "[name].[hash].[ext]",
      asset: "[name].[hash].[ext]",
    },
    define: {
      "process.env.NODE_ENV": JSON.stringify(WATCH ? "development" : "production"),
    },
  });

  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error("web build failed");
  }

  // Bun emits a top-level main.<hash>.js and a separate main.<hash>.css (when the
  // entrypoint imports styles.css). Discover them by scanning result.outputs.
  const jsEntry = result.outputs.find((o) => o.path.endsWith(".js") && o.kind === "entry-point");
  const cssEntry = result.outputs.find((o) => o.path.endsWith(".css"));
  if (!jsEntry) throw new Error("no JS entry produced");

  const jsHref = jsEntry.path.split("/").pop()!;
  const cssHref = cssEntry?.path.split("/").pop();

  // Use absolute /web/ paths so the bundle loads correctly whether the URL is
  // /web, /web/, or /web/index.html — relative ./ paths break the first form.
  const html = (await readFile(HTML_IN, "utf8"))
    .replace("__JS_BUNDLE__", `/web/${jsHref}`)
    .replace(
      "__CSS_BUNDLE__",
      cssHref ? `<link rel="stylesheet" href="/web/${cssHref}" />` : "",
    );
  await writeFile(join(DIST, "index.html"), html, "utf8");

  const dt = (performance.now() - t0).toFixed(0);
  console.log(`web bundle: ${jsHref}${cssHref ? ` + ${cssHref}` : ""} (${dt} ms)`);
}

await build();

if (WATCH) {
  const watcher = (await import("node:fs/promises")).watch(SRC, { recursive: true });
  console.log("watching web/src/ for changes…");
  for await (const _ of watcher) {
    try {
      await build();
    } catch (err) {
      console.error(err);
    }
  }
}
