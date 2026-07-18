#!/usr/bin/env bun
// Static server for the interactive parity viewer. Serves the repo root
// (design bundle + storybook-static + this tool) on one origin.
//
// When the manifest names an `implSeed`, this server injects it as
// window.__PARITY_SEED__ into the Storybook iframe.html BEFORE the bundle's
// module scripts run, so MockDataSource renders the same world the reference
// does (matching the diff runner). Stable Storybook is untouched.
//
// Usage: bun tools/parity/serve.mjs [port] [manifest.json]
import { join, resolve, dirname } from "node:path";
import { readFileSync, existsSync } from "node:fs";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const manifestPath = process.argv[3] ??
  join(ROOT, "tools/parity/manifests/sigil-vs-aesthetic-rerun-r3.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

// Load the impl seed once (bun imports TS directly) and build the inject script.
const SEED_KEYS = ["AGENTS", "ARTIFACTS", "DMS", "GROUPS", "MESSAGES", "TASKS", "THREAD_REPLIES", "THREAD_SUMMARIES"];
let injectTag = "";
if (manifest.implSeed) {
  const seedPath = join(ROOT, manifest.implSeed);
  if (!existsSync(seedPath)) { console.error(`implSeed not found: ${manifest.implSeed}`); process.exit(1); }
  const m = await import(seedPath);
  const json = JSON.stringify(Object.fromEntries(SEED_KEYS.map((k) => [k, m[k]])));
  injectTag = `<script>window.__PARITY_SEED__ = ${json};</script>`;
}

const IFRAME_PATH = new URL(manifest.vars?.impl ?? "/web/storybook-static/iframe.html", "http://x").pathname;

const server = Bun.serve({
  port: Number(process.argv[2] ?? 8788),
  async fetch(r) {
    const path = decodeURIComponent(new URL(r.url).pathname);
    // The viewer shell changes as we iterate — never let the browser cache it,
    // so a normal refresh always picks up the latest index.html (the in-page
    // Reload button only re-runs already-loaded JS; only a fetch reloads this).
    const NO_STORE = { "cache-control": "no-store, must-revalidate" };
    // Inject the seed into the Storybook iframe shell (classic script in <head>
    // runs before the deferred module bundle, so the global is set in time).
    if (injectTag && path === IFRAME_PATH) {
      const f = Bun.file(join(ROOT, path.slice(1)));
      if (await f.exists()) {
        const html = (await f.text()).replace(/<head>/i, `<head>${injectTag}`);
        return new Response(html, { headers: { "content-type": "text/html", ...NO_STORE } });
      }
    }
    const isShell = path === "/" || path === "/tools/parity/index.html";
    const f = Bun.file(join(ROOT, path === "/" ? "tools/parity/index.html" : path.slice(1)));
    if (!(await f.exists())) return new Response("not found", { status: 404 });
    return new Response(f, isShell ? { headers: NO_STORE } : undefined);
  },
});
console.log(`parity viewer: http://127.0.0.1:${server.port}/  (seed: ${manifest.implSeed ?? "none — stable"})`);
