#!/usr/bin/env bun
// Parity harness diff runner: renders a design-bundle reference and the worktree
// implementation from a manifest, screenshots both sides per scene x theme, and
// pixel-diffs them into a ranked report.
//
// Usage:
//   bun tools/parity/parity-diff.mjs [manifest.json] [--scene name] [--theme dark]
//                                    [--allow-stale] [--no-report]
//
// Outputs (gitignored): tools/parity/out/<manifest-name>/
//   ref/ impl/ diff/ <scene>--<theme>.png, report.json, report.html (reg-cli)

import { createRequire } from "node:module";
import { mkdirSync, readdirSync, statSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";

const HERE = dirname(new URL(import.meta.url).pathname);
const ROOT = resolve(HERE, "../..");
const WEB = join(ROOT, "web");
// Harness deps live in web/node_modules (playwright, pixelmatch, pngjs, reg-cli).
const req = createRequire(join(WEB, "package.json"));
const { chromium } = await import(req.resolve("playwright"));
const pixelmatch = (await import(req.resolve("pixelmatch"))).default;
const { PNG } = await import(req.resolve("pngjs"));

// ---- args ----------------------------------------------------------------
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const manifestPath = args.find((a) => a.endsWith(".json")) ??
  join(HERE, "manifests/sigil-vs-aesthetic-rerun-r3.json");
const onlyScene = opt("--scene");
const onlyTheme = opt("--theme");

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const OUT = join(HERE, "out", manifest.name);
for (const d of ["ref", "impl", "diff"]) mkdirSync(join(OUT, d), { recursive: true });

// ---- optional impl-side seed injection (data parity) ----------------------
// When the manifest names `implSeed` (a repo-relative app seed module), load it
// (bun imports TS directly) and inject it as window.__PARITY_SEED__ into the
// impl iframe BEFORE its bundle runs — MockDataSource reads that global and
// renders this world instead of its stable seed, so both sides show identical
// content and the pixel diff is pure design gap. Stable Storybook is untouched
// (the global is undefined in every normal render).
const SEED_KEYS = ["AGENTS", "ARTIFACTS", "DMS", "GROUPS", "MESSAGES", "TASKS", "THREAD_REPLIES", "THREAD_SUMMARIES"];
let PARITY_SEED = null;
if (manifest.implSeed) {
  const seedPath = join(ROOT, manifest.implSeed);
  if (!existsSync(seedPath)) fail(`manifest.implSeed not found: ${manifest.implSeed}`);
  const m = await import(seedPath);
  PARITY_SEED = JSON.stringify(Object.fromEntries(SEED_KEYS.map((k) => [k, m[k]])));
}

// ---- staleness guard (hard fail; the #1 source of false conclusions) ------
function newestMtime(dir) {
  let newest = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) newest = Math.max(newest, newestMtime(p));
    else newest = Math.max(newest, statSync(p).mtimeMs);
  }
  return newest;
}
if (manifest.staleness && !flag("--allow-stale")) {
  const build = join(ROOT, manifest.staleness.build);
  if (!existsSync(build)) fail(`impl build missing: ${manifest.staleness.build}`);
  const buildTime = statSync(build).mtimeMs;
  for (const src of manifest.staleness.sources) {
    const dir = join(ROOT, src);
    if (existsSync(dir) && newestMtime(dir) > buildTime) {
      fail(`STALE impl build: ${src} is newer than ${manifest.staleness.build}.\n` +
        `  Rebuild it (cd web && bun run storybook:build) or pass --allow-stale.`);
    }
  }
}
function fail(msg) { console.error(`\nparity: ${msg}\n`); process.exit(1); }

// ---- same-origin static server over the repo root -------------------------
const server = Bun.serve({
  port: 0,
  async fetch(r) {
    const path = decodeURIComponent(new URL(r.url).pathname);
    const f = Bun.file(join(ROOT, path === "/" ? "index.html" : path.slice(1)));
    return (await f.exists()) ? new Response(f) : new Response("not found", { status: 404 });
  },
});
const BASE = `http://127.0.0.1:${server.port}`;

// ---- capture ---------------------------------------------------------------
const NEUTRALIZE_CSS =
  "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}";

const sub = (tpl, themeKey, side) =>
  tpl.replace(/\{theme\}/g, manifest.themes[themeKey][side])
     .replace(/\{(\w+)\}/g, (_, k) => manifest.vars?.[k] ?? `{${k}}`);

async function capture(page, side, scene, themeKey, file) {
  const spec = scene[side];
  // Seed the impl before its bundle evaluates (addInitScript runs pre-page-scripts).
  if (side === "impl" && PARITY_SEED) await page.addInitScript(`window.__PARITY_SEED__ = ${PARITY_SEED};`);
  await page.goto(BASE + sub(spec.url, themeKey, side), { waitUntil: "networkidle" });
  await page.addStyleTag({ content: NEUTRALIZE_CSS + (manifest.hideCss?.[side] ?? "") });
  for (const step of spec.setup ?? []) {
    if (step.click) await page.click(step.click);
    if (step.eval) await page.evaluate(step.eval);
    if (step.wait) await page.waitForTimeout(step.wait);
  }
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150); // post-setup re-render settle
  const sel = spec.selector ?? (side === "impl" ? manifest.implRootSelector : null);
  const target = sel ? page.locator(sel).first() : page;
  await target.screenshot({ path: file, animations: "disabled" });
}

// pixelmatch needs equal dims; place both on a union canvas so size drift
// shows up as diff instead of crashing.
function diffPngs(refFile, implFile, diffFile) {
  const a = PNG.sync.read(readFileSync(refFile));
  const b = PNG.sync.read(readFileSync(implFile));
  const w = Math.max(a.width, b.width), h = Math.max(a.height, b.height);
  const pad = (img) => {
    if (img.width === w && img.height === h) return img;
    const c = new PNG({ width: w, height: h });
    PNG.bitblt(img, c, 0, 0, img.width, img.height, 0, 0);
    return c;
  };
  const pa = pad(a), pb = pad(b), out = new PNG({ width: w, height: h });
  const n = pixelmatch(pa.data, pb.data, out.data, w, h, { threshold: 0.1, includeAA: false });
  writeFileSync(diffFile, PNG.sync.write(out));
  return { pct: +(100 * n / (w * h)).toFixed(2), dims: `${w}x${h}`, sizeMismatch: a.width !== b.width || a.height !== b.height };
}

const browser = await chromium.launch();
const results = [];
const themes = Object.keys(manifest.themes).filter((t) => !onlyTheme || t === onlyTheme);
const scenes = manifest.scenes.filter((s) => !onlyScene || s.name === onlyScene);
if (!scenes.length) fail(`no scene named "${onlyScene}" in ${manifestPath}`);

for (const scene of scenes) {
  for (const theme of themes) {
    const key = `${scene.name}--${theme}`;
    const files = Object.fromEntries(["ref", "impl", "diff"].map((d) => [d, join(OUT, d, `${key}.png`)]));
    const ctxs = [];
    try {
      for (const side of ["ref", "impl"]) {
        const viewport = scene[side].viewport ?? scene.viewport ?? manifest.viewport;
        const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
        ctxs.push(ctx);
        await capture(await ctx.newPage(), side, scene, theme, files[side]);
      }
      const d = diffPngs(files.ref, files.impl, files.diff);
      results.push({ scene: scene.name, theme, ...d, ...files });
      console.log(`  ${key.padEnd(28)} ${String(d.pct).padStart(6)}%${d.sizeMismatch ? "  (size mismatch)" : ""}`);
    } catch (e) {
      results.push({ scene: scene.name, theme, error: String(e.message ?? e) });
      console.error(`  ${key.padEnd(28)}  ERROR ${e.message}`);
    } finally {
      for (const c of ctxs) await c.close();
    }
  }
}
await browser.close();
server.stop();

// ---- report ----------------------------------------------------------------
results.sort((x, y) => (y.pct ?? 101) - (x.pct ?? 101));
const report = { manifest: manifest.name, generatedBy: "parity-diff.mjs", caveats: manifest.caveats ?? [], results };
writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));

console.log(`\nRanked gaps (highest first) -> ${join(OUT, "report.json")}`);
for (const c of manifest.caveats ?? []) console.log(`  caveat: ${c}`);

if (!flag("--no-report")) {
  const regCli = join(WEB, "node_modules/.bin/reg-cli");
  const p = Bun.spawnSync([regCli, join(OUT, "impl"), join(OUT, "ref"), join(OUT, "diff"),
    "-R", join(OUT, "report.html"), "--matchingThreshold", "0.1"], { stdout: "inherit", stderr: "inherit" });
  if (p.exitCode === 0 || p.exitCode === 1) // 1 = differences found, still wrote report
    console.log(`Interactive report: ${join(OUT, "report.html")}`);
}
