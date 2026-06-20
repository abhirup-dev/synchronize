// Dead-CSS selector check (sync-imeu.1.14). Lists class selectors defined in
// web/src/**/*.css that have no reference anywhere in the .ts/.tsx source.
//
// Deliberately CONSERVATIVE — a class counts as "live" if its name appears as a
// substring anywhere in code, OR a dynamic prefix it could be built from appears
// (e.g. `shell-overlay-${mode}`). So short/common names (open, on, code) are
// never reported, and the flagged set is high-confidence dead. Injected vendor
// classes (highlight.js) live in node_modules CSS, not here, so they're absent.
//
//   bun run scripts/dead-css.mjs
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const walk = (dir, out = []) => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    statSync(p).isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
};
const files = walk(SRC);
const code = files.filter((f) => f.endsWith(".tsx") || f.endsWith(".ts")).map((f) => readFileSync(f, "utf8")).join("\n");

const defined = new Map(); // class -> Set<file>
for (const f of files.filter((f) => f.endsWith(".css"))) {
  const css = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of css.matchAll(/\.(-?[a-zA-Z_][\w-]*)/g)) {
    if (!defined.has(m[1])) defined.set(m[1], new Set());
    defined.get(m[1]).add(f.slice(SRC.length + 1));
  }
}

// Classes built dynamically from a literal prefix + interpolation in code.
const DYNAMIC_PREFIXES = ["shell-overlay-", "shell-", "flash-"];
const isReferenced = (cls) =>
  code.includes(cls) || DYNAMIC_PREFIXES.some((p) => cls.startsWith(p) && code.includes(p));

const dead = [...defined.entries()].filter(([cls]) => !isReferenced(cls)).sort((a, b) => a[0].localeCompare(b[0]));
console.log(`defined classes: ${defined.size}  |  dead candidates: ${dead.length}\n`);
for (const [cls, fs] of dead) console.log(`  ${cls.padEnd(36)} ${[...fs].join(", ")}`);
if (process.env["DEAD_CSS_STRICT"] && dead.length) process.exit(1);
