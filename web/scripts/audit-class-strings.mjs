#!/usr/bin/env bun
// Class-bundle audit: finds repeated Tailwind utility bundles worth extracting
// into a shared class. Scans ONLY class-bearing contexts (className={...}, and
// cva/clsx/cn/classNames/twMerge/cx/tw(...) calls) — not every string literal, so
// prose/seed data never reads as a "class bundle". Token classification strips
// variant chains (md:, hover:, dark:, data-[state=open]:, [&>svg]:, supports-[…]:)
// before matching a known Tailwind utility head, so variant-prefixed utilities are
// recognised rather than missed. Rough report / codemod queue, not a hard gate.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src");
const minTokens = Number(process.env["CLASS_AUDIT_MIN_TOKENS"] ?? 4);
const minUses = Number(process.env["CLASS_AUDIT_MIN_USES"] ?? 2);
const json = process.argv.includes("--json");

// First segment (head) of a Tailwind utility, i.e. the part before the first "-"
// or "[". `bg-paper` → bg, `min-h-0` → min, `flex` → flex, `text-[length:…]` → text.
const UTILITY_HEADS = new Set([
  // layout / display / position
  "block", "inline", "flex", "grid", "table", "contents", "hidden", "flow", "isolate",
  "static", "fixed", "absolute", "relative", "sticky", "inset", "top", "right", "bottom", "left",
  "z", "float", "clear", "box", "object", "overflow", "overscroll", "container", "columns",
  "break", "aspect", "visible", "collapse",
  // flex / grid
  "basis", "grow", "shrink", "order", "col", "row", "gap", "place", "content", "items", "justify", "self", "auto",
  // spacing
  "p", "px", "py", "pt", "pr", "pb", "pl", "ps", "pe", "m", "mx", "my", "mt", "mr", "mb", "ml", "ms", "me",
  "space", "divide", "indent",
  // sizing
  "w", "h", "min", "max", "size",
  // typography
  "font", "text", "tracking", "leading", "list", "placeholder", "decoration", "underline", "overline",
  "line", "uppercase", "lowercase", "capitalize", "italic", "truncate", "whitespace", "hyphens",
  "antialiased", "subpixel", "ordinal", "align", "not",
  // backgrounds / borders / effects
  "bg", "from", "via", "to", "gradient", "border", "rounded", "outline", "ring", "shadow", "opacity", "mix",
  // filters
  "blur", "brightness", "contrast", "grayscale", "invert", "saturate", "sepia", "backdrop", "drop",
  // transition / transform / animation
  "transition", "duration", "ease", "delay", "animate", "transform", "scale", "rotate", "translate", "skew",
  "origin", "will", "perspective",
  // interactivity / svg / misc
  "cursor", "select", "resize", "scroll", "snap", "touch", "pointer", "accent", "caret", "appearance",
  "fill", "stroke", "sr", "forced",
]);

// A leading variant segment ending in ":" — a bracketed selector ([&>svg], [@media…]),
// or an identifier optionally carrying an arbitrary value (data-[state=open], max-[600px]).
// Anchored, applied repeatedly to peel a whole chain (md:hover:dark:…).
const VARIANT = /^(?:\[[^\]]*\]|[a-zA-Z0-9_-]+(?:-\[[^\]]*\])?):/;

function stripVariants(token) {
  let t = token;
  while (VARIANT.test(t)) {
    const next = t.replace(VARIANT, "");
    if (next === t) break;
    t = next;
  }
  return t;
}

function isUtility(token) {
  const base = stripVariants(token).replace(/^!/, "").replace(/^-/, "");
  if (!base) return false;
  if (/^\[[^\]]+\]$/.test(base)) return true; // arbitrary property: [mask-type:luminance]
  return UTILITY_HEADS.has(base.split(/[-[]/)[0]);
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "storybook-static") continue;
    const path = join(dir, entry);
    statSync(path).isDirectory() ? walk(path, out) : out.push(path);
  }
  return out;
}

function rel(path) {
  return relative(root, path).split(sep).join("/");
}

function lineForOffset(text, offset) {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (text.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

function normalizeClassString(value) {
  return value.replace(/\s+/g, " ").trim();
}

// Scan from an opening delimiter to its match, string-aware so braces/parens inside
// string literals don't throw off the depth count.
function scanBalanced(text, startIdx, open, close) {
  let depth = 0;
  let inStr = null;
  for (let i = startIdx; i < text.length; i += 1) {
    const c = text[i];
    if (inStr) {
      if (c === "\\") { i += 1; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
    if (c === open) depth += 1;
    else if (c === close) { depth -= 1; if (depth === 0) return i + 1; }
  }
  return text.length;
}

function scanString(text, i) {
  const quote = text[i];
  for (let j = i + 1; j < text.length; j += 1) {
    if (text[j] === "\\") { j += 1; continue; }
    if (text[j] === quote) return j + 1;
  }
  return text.length;
}

// The byte ranges that actually carry class names: className={…}/"…" and the
// className helper calls. Everything else (props, prose, seed data) is ignored.
function extractClassRegions(text) {
  const regions = [];
  const attr = /\bclassName\s*=\s*/g;
  let m;
  while ((m = attr.exec(text))) {
    const i = m.index + m[0].length;
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") regions.push({ start: i, end: scanString(text, i) });
    else if (c === "{") regions.push({ start: i, end: scanBalanced(text, i, "{", "}") });
  }
  const call = /\b(?:cva|clsx|classNames|cn|cx|twMerge|twJoin|tw)\s*\(/g;
  while ((m = call.exec(text))) {
    const paren = m.index + m[0].length - 1;
    regions.push({ start: paren, end: scanBalanced(text, paren, "(", ")") });
  }
  return regions;
}

function extractStringLiterals(slice, base) {
  const literals = [];
  const re = /(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
  for (const match of slice.matchAll(re)) {
    const quote = match[1];
    const raw = match[2];
    if (quote === "`" && raw.includes("${")) continue;
    literals.push({ value: raw, index: base + (match.index ?? 0) });
  }
  return literals;
}

function looksLikeUtilityBundle(value) {
  if (value.includes("${")) return false;
  const tokens = normalizeClassString(value).split(" ").filter(Boolean);
  return tokens.length >= minTokens && tokens.some(isUtility);
}

const bundles = new Map();
const tokenCounts = new Map();
const files = walk(src).filter((file) => /\.(ts|tsx)$/.test(file));

for (const filePath of files) {
  const file = rel(filePath);
  const text = readFileSync(filePath, "utf8");
  const seen = new Set(); // dedupe literals reached via overlapping regions (className={cva(...)})
  for (const region of extractClassRegions(text)) {
    const slice = text.slice(region.start, region.end);
    for (const literal of extractStringLiterals(slice, region.start)) {
      if (seen.has(literal.index)) continue;
      seen.add(literal.index);

      const normalized = normalizeClassString(literal.value);
      if (!looksLikeUtilityBundle(normalized)) continue;

      const utilityTokens = normalized.split(" ").filter(isUtility);
      if (utilityTokens.length < minTokens) continue;

      const key = utilityTokens.join(" ");
      const entry = bundles.get(key) ?? { className: key, tokenCount: utilityTokens.length, uses: [] };
      entry.uses.push({ file, line: lineForOffset(text, literal.index) });
      bundles.set(key, entry);

      for (const token of utilityTokens) {
        const tokenEntry = tokenCounts.get(token) ?? { token, count: 0 };
        tokenEntry.count += 1;
        tokenCounts.set(token, tokenEntry);
      }
    }
  }
}

const repeatedBundles = [...bundles.values()]
  .filter((entry) => entry.uses.length >= minUses)
  .sort((a, b) => b.uses.length - a.uses.length || b.tokenCount - a.tokenCount || a.className.localeCompare(b.className));

const repeatedTokens = [...tokenCounts.values()]
  .filter((entry) => entry.count >= 12)
  .sort((a, b) => b.count - a.count || a.token.localeCompare(b.token))
  .slice(0, 40);

if (json) {
  process.stdout.write(JSON.stringify({ repeatedBundles, repeatedTokens }, null, 2));
  process.exit(0);
}

console.log(`class bundle audit: ${files.length} source files`);
console.log(`repeated bundles: ${repeatedBundles.length} (min tokens ${minTokens}, min uses ${minUses})\n`);

for (const entry of repeatedBundles.slice(0, 30)) {
  console.log(`${entry.uses.length} uses, ${entry.tokenCount} tokens`);
  console.log(`  ${entry.className}`);
  for (const use of entry.uses.slice(0, 6)) console.log(`    ${use.file}:${use.line}`);
  if (entry.uses.length > 6) console.log(`    ... ${entry.uses.length - 6} more`);
  console.log("");
}

console.log("frequent utility tokens:");
for (const entry of repeatedTokens) console.log(`  ${String(entry.count).padStart(3)}  ${entry.token}`);
