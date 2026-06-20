// UI smoke gate (sync-imeu.1.23). Self-contained: builds a root-asset bundle
// (which boots the deterministic MockDataSource — no daemon/DB needed), serves
// it, and drives Playwright across compact/medium/desktop in light + dark,
// asserting each shell renders and a room/chat opens with no console errors.
// Exits non-zero on any failure so it can gate CI / pre-push.
//
//   bun run scripts/verify-ui.mjs            # headless, builds + serves mock
//   VERIFY_HEADED=1 bun run scripts/...      # watch it run
//   VERIFY_BASE_URL=http://127.0.0.1:PORT/web/ bun run scripts/...  # hit a live daemon (real data)
//
// Requires the chromium browser once: bunx playwright install chromium
import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "medium", width: 1000, height: 820 },
  { name: "compact", width: 390, height: 844 },
];
const THEMES = ["kanagawa-wave", "light"];

let server;
async function baseUrl() {
  if (process.env["VERIFY_BASE_URL"]) return process.env["VERIFY_BASE_URL"];
  // Build the root-asset (mock) bundle and serve it so location.pathname is "/"
  // → pickDataSource() uses MockDataSource (deterministic, no daemon).
  const dist = join(ROOT, "dist-verify");
  const build = Bun.spawnSync(["bun", "run", "build.ts"], {
    cwd: ROOT,
    env: { ...process.env, WEB_ASSET_BASE: "/", WEB_DIST_DIR: "dist-verify" },
    stdout: "inherit",
    stderr: "inherit",
  });
  if (build.exitCode !== 0) throw new Error("build failed");
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const p = new URL(req.url).pathname;
      const file = Bun.file(join(dist, p === "/" ? "index.html" : p));
      return file.exists().then((ok) => (ok ? new Response(file) : new Response(Bun.file(join(dist, "index.html")))));
    },
  });
  return `http://127.0.0.1:${server.port}/`;
}

async function run() {
  const BASE = await baseUrl();
  const browser = await chromium.launch({ headless: !process.env["VERIFY_HEADED"] });
  const failures = [];
  for (const theme of THEMES) {
    for (const vp of VIEWPORTS) {
      const tag = `${theme}/${vp.name}`;
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const page = await ctx.newPage();
      const errors = [];
      page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
      page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
      await page.addInitScript((t) => { try { localStorage.setItem("synchronize.theme", t); } catch {} }, theme);
      try {
        await page.goto(BASE, { waitUntil: "networkidle", timeout: 30000 });
        // shell renders
        await page.waitForSelector(".app-shell", { timeout: 10000 });
        const shellMode = await page.getAttribute(".app-shell", "data-shell-mode");
        if (shellMode !== vp.name) failures.push(`${tag}: shell-mode "${shellMode}" != "${vp.name}"`);
        // open a room → chat view renders. Compact first taps the Chats nav.
        if (vp.name === "compact") {
          await page.locator('button[aria-label="Chats"]').click();
        }
        await page.locator(".room-item").first().click();
        await page.waitForSelector(".chat-view", { timeout: 10000 });
        const real = errors.filter((e) => !/favicon|ERR_INCOMPLETE_CHUNKED|\/web\/events|404/.test(e));
        if (real.length) failures.push(`${tag}: console errors → ${real.join(" | ")}`);
        console.log(`  ✓ ${tag}`);
      } catch (e) {
        failures.push(`${tag}: ${e.message.split("\n")[0]}`);
        console.log(`  ✗ ${tag}`);
      }
      await ctx.close();
    }
  }
  await browser.close();
  server?.stop();
  if (failures.length) {
    console.error("\nUI smoke FAILED:\n  " + failures.join("\n  "));
    process.exit(1);
  }
  console.log("\nUI smoke passed (" + THEMES.length * VIEWPORTS.length + " mode×theme combos).");
}

run().catch((e) => { console.error(e); server?.stop(); process.exit(1); });
