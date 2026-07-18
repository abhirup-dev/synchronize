#!/usr/bin/env bun
// Export the app's canonical seed data as portable fixtures for design bundles.
// The emitted JSON is the single source of truth a designer mock renders from,
// so the parity harness compares identical content on both sides.
//
// Usage:
//   bun scripts/export-fixtures.mjs                 # default seed (src/data/seed.ts)
//   bun scripts/export-fixtures.mjs --seed <name>   # src/data/seeds/<name>.ts (parallel seeds)
//   bun scripts/export-fixtures.mjs --out <dir>     # write fixtures.json + fixtures.js there
//
// Deterministic: seed timestamps are Date.now()-relative, so we pin the clock
// to a fixed epoch before importing — same seed, same bytes, same hash.

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";

const HERE = dirname(new URL(import.meta.url).pathname);
const WEB = resolve(HERE, "..");
const opt = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };

const seedName = opt("--seed") ?? "stable";
const seedPath = seedName === "stable"
  ? join(WEB, "src/data/seed.ts")
  : join(WEB, `src/data/seeds/${seedName}.ts`);
if (!existsSync(seedPath)) {
  console.error(`no such seed: ${seedPath}`);
  process.exit(1);
}

const EPOCH = Date.parse("2026-01-01T12:00:00.000Z");
Date.now = () => EPOCH; // must precede the import — seed timestamps resolve at module load

const seed = await import(seedPath);
const data = Object.fromEntries(
  Object.entries(seed).filter(([, v]) => typeof v !== "function"),
);

const body = JSON.stringify(data, null, 2);
const fixtures = {
  meta: {
    schema: "synchronize-fixtures/v1",
    seed: seedName,
    epoch: new Date(EPOCH).toISOString(),
    hash: createHash("sha256").update(body).digest("hex").slice(0, 16),
  },
  ...data,
};

// Mirror the design-project layout (fixtures/base.js + merge.js) so pulled
// templates resolve ../../fixtures/* locally without any copying step.
const outDir = opt("--out") ?? join(WEB, "..", "ds-bundle");
mkdirSync(join(outDir, "fixtures"), { recursive: true });
const json = JSON.stringify(fixtures, null, 2);
writeFileSync(join(outDir, "fixtures.json"), json);
writeFileSync(join(outDir, "fixtures/base.js"), `window.FIXTURES_BASE = ${json};\n`);
copyFileSync(join(HERE, "../../tools/parity/fixtures-merge.js"), join(outDir, "fixtures/merge.js"));
console.log(`exported seed "${seedName}" (${Object.keys(data).join(", ")})`);
console.log(`hash ${fixtures.meta.hash} -> ${outDir}/{fixtures.json, fixtures/base.js, fixtures/merge.js}`);
