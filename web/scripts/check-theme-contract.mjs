#!/usr/bin/env bun
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import {
  legacyUndefinedVars,
  rawColorAllowed,
  requiredResolvedTokens,
  themeSelectorAllowed,
  tokenDefinitionFiles,
} from "./theme-contract-policy.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src");
const strict = process.argv.includes("--strict");

const registry = JSON.parse(readFileSync(join(src, "theme/theme-registry.json"), "utf8"));
const themeIds = Object.keys(registry.theme ?? {});
const skinIds = Object.keys(registry.skin ?? {});
const defaultSkin = registry.defaults?.$value?.initialSkin;

const cssTokenFiles = new Set(tokenDefinitionFiles);
const legacyUndefinedVarSet = new Set(legacyUndefinedVars);

const errors = [];
const warnings = [];

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

function addError(file, line, message) {
  errors.push(`${file}${line ? `:${line}` : ""}: ${message}`);
}

function addWarning(file, line, message) {
  warnings.push({ file, line, message });
}

function formatWarning({ file, line, message }) {
  return `${file}${line ? `:${line}` : ""}: ${message}`;
}

function matchesAny(file, patterns) {
  return patterns.some((pattern) => pattern.test(file));
}

function selectorList(selector) {
  const selectors = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < selector.length; index += 1) {
    const char = selector[index];
    if (char === "(" || char === "[") depth += 1;
    if (char === ")" || char === "]") depth = Math.max(0, depth - 1);
    if (char === "," && depth === 0) {
      selectors.push(selector.slice(start, index).trim());
      start = index + 1;
    }
  }
  selectors.push(selector.slice(start).trim());
  return selectors.filter(Boolean);
}

function selectorHasTheme(selector) {
  return /\[data-theme(?:=|\])/.test(selector);
}

function selectorHasSkin(selector) {
  return /\[data-skin(?:=|\])/.test(selector) || /:not\(\[data-skin\]\)/.test(selector);
}

function selectorThemes(selector) {
  return [...selector.matchAll(/\[data-theme=(["']?)([^"'\]]+)\1\]/g)].map((match) => match[2]);
}

function selectorSkins(selector) {
  return [...selector.matchAll(/\[data-skin=(["']?)([^"'\]]+)\1\]/g)].map((match) => match[2]);
}

function selectorAppliesToCombo(selector, combo) {
  if (!selector.includes(":root")) return false;

  const themes = selectorThemes(selector);
  if (themes.length && !themes.includes(combo.theme)) return false;

  const skins = selectorSkins(selector);
  if (skins.length && !skins.includes(combo.skin)) return false;
  if (/:not\(\[data-skin\]\)/.test(selector) && combo.skin !== defaultSkin) return false;

  return true;
}

function parseCss(file, text) {
  try {
    return postcss.parse(text, { from: file });
  } catch (error) {
    addError(file, error.line, `CSS parse failed: ${error.reason ?? error.message}`);
    return postcss.root();
  }
}

const files = walk(src).filter((file) => /\.(css|ts|tsx|json)$/.test(file));
const cssFiles = files.filter((file) => file.endsWith(".css"));
const sourceFiles = files.filter((file) => /\.(css|ts|tsx)$/.test(file));

const cssTextByFile = new Map(cssFiles.map((file) => [rel(file), readFileSync(file, "utf8")]));
const cssRoots = new Map([...cssTextByFile].map(([file, text]) => [file, parseCss(file, text)]));
const allSource = sourceFiles.map((file) => [rel(file), readFileSync(file, "utf8")]);

const definedVars = new Map();
function rememberVar(name, file, line) {
  if (!definedVars.has(name)) definedVars.set(name, []);
  definedVars.get(name).push({ file, line });
}

const tokenDefs = [];
for (const [file, cssRoot] of cssRoots) {
  cssRoot.walkDecls((decl) => {
    if (decl.prop.startsWith("--")) {
      rememberVar(decl.prop, file, decl.source?.start?.line);
      tokenDefs.push({
        file,
        line: decl.source?.start?.line,
        name: decl.prop,
        selector: decl.parent?.selector ?? "",
      });
    }
  });
}

for (const [file, text] of allSource) {
  if (file.endsWith(".css")) continue;
  text.split(/\r?\n/).forEach((line, index) => {
    for (const match of line.matchAll(/["'](--[a-z0-9-]+)["']\s*:/gi)) {
      rememberVar(match[1], file, index + 1);
    }
    for (const match of line.matchAll(/setProperty\(["'](--[a-z0-9-]+)["']/gi)) {
      rememberVar(match[1], file, index + 1);
    }
  });
}

const rootTokenNames = new Set(tokenDefs.filter((def) => cssTokenFiles.has(def.file)).map((def) => def.name));
const rawColor = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|lab|lch)\(/;
const varRef = /var\((--[a-z0-9-]+)/g;
const retiredToken = /--message-card-/;
const rawColorArbitrary = /\b(?:bg|text|border|shadow|ring|fill|stroke)-\[(?:#[0-9a-fA-F]|rgba?\(|hsla?\(|oklch\(|lab\(|lch\()/i;
const rawColorArbitraryProperty = /\[(?:background|background-color|border|border-color|box-shadow|color|outline|outline-color|text-shadow):(?:#[0-9a-fA-F]|rgba?\(|hsla?\(|oklch\(|lab\(|lch\()/i;

for (const [file, text] of allSource) {
  text.split(/\r?\n/).forEach((line, index) => {
    const lineNumber = index + 1;

    if (retiredToken.test(line)) {
      addError(file, lineNumber, "retired --message-card-* token");
    }

    if (!matchesAny(file, rawColorAllowed) && rawColor.test(line) && !line.trim().startsWith("//")) {
      addWarning(file, lineNumber, "raw color literal outside token/asset/story allowlist");
    }

    for (const match of line.matchAll(varRef)) {
      if (!definedVars.has(match[1]) && !match[1].endsWith("-")) {
        if (legacyUndefinedVarSet.has(match[1])) {
          addWarning(file, lineNumber, `legacy undefined CSS variable ${match[1]}`);
          continue;
        }
        addError(file, lineNumber, `unknown CSS variable ${match[1]}`);
      }
    }

    if (!cssTokenFiles.has(file) && (rawColorArbitrary.test(line) || rawColorArbitraryProperty.test(line))) {
      addError(file, lineNumber, "raw color embedded in Tailwind arbitrary utility");
    }
  });
}

for (const def of tokenDefs) {
  if (cssTokenFiles.has(def.file)) continue;

  if (rootTokenNames.has(def.name)) {
    addError(def.file, def.line, `global token ${def.name} redefined outside token files`);
    continue;
  }

  if (selectorHasTheme(def.selector) || selectorHasSkin(def.selector) || def.selector.includes(":root")) {
    addWarning(def.file, def.line, `scoped CSS variable ${def.name} defined outside token files`);
  }
}

for (const [file, cssRoot] of cssRoots) {
  cssRoot.walkRules((rule) => {
    const selectors = selectorList(rule.selector ?? "");
    if (!selectors.some(selectorHasTheme)) return;
    if (matchesAny(file, themeSelectorAllowed)) return;

    for (const selector of selectors) {
      if (!selectorHasTheme(selector)) continue;
      if (!selectorHasSkin(selector)) {
        addWarning(file, rule.source?.start?.line, "theme selector is not skin-scoped; prefer token values or explicit skin+theme selectors");
        break;
      }
    }
  });
}

const tokenDefinitionSelectors = tokenDefs.filter((def) => def.file === "src/styles/tokens.css");
for (const skin of skinIds) {
  for (const theme of themeIds) {
    const combo = { skin, theme };
    const resolved = new Set();
    for (const def of tokenDefinitionSelectors) {
      if (selectorList(def.selector).some((selector) => selectorAppliesToCombo(selector, combo))) {
        resolved.add(def.name);
      }
    }

    for (const token of requiredResolvedTokens) {
      if (!resolved.has(token)) {
        addError("src/styles/tokens.css", null, `missing required token ${token} for skin=${skin} theme=${theme}`);
      }
    }
  }
}

const tokensCss = cssTextByFile.get("src/styles/tokens.css") ?? "";
for (const theme of themeIds) {
  if (theme !== registry.defaults?.$value?.lightTheme && !tokensCss.includes(`data-theme="${theme}"`)) {
    addError("src/styles/tokens.css", null, `missing token selector for theme ${theme}`);
  }
}
for (const skin of skinIds) {
  if (skin !== registry.defaults?.$value?.initialSkin && !tokensCss.includes(`data-skin="${skin}"`)) {
    addError("src/styles/tokens.css", null, `missing token selector for skin ${skin}`);
  }
}

const preview = readFileSync(join(root, ".storybook/preview.tsx"), "utf8");
if (!preview.includes("../src/styles/css.ts")) addError(".storybook/preview.tsx", null, "Storybook must import the shared CSS stack");
if (!preview.includes("registry.generated.ts")) addError(".storybook/preview.tsx", null, "Storybook globals must come from registry.generated.ts");

const main = readFileSync(join(src, "main.tsx"), "utf8");
if (!main.includes("./styles/css.ts")) addError("src/main.tsx", null, "app entry must import the shared CSS stack");

const persistentTheme = readFileSync(join(src, "hooks/usePersistentTheme.ts"), "utf8");
if (!persistentTheme.includes("../theme/registry.generated.ts")) {
  addError("src/hooks/usePersistentTheme.ts", null, "theme hook must use registry.generated.ts");
}

const maxWarnings = 24;
if (warnings.length) {
  const warningReport = [`Theme contract warnings (${warnings.length}; ${strict ? "strict mode fails" : "non-fatal"}):`];
  const warningCounts = new Map();
  for (const warning of warnings) {
    warningCounts.set(warning.message, (warningCounts.get(warning.message) ?? 0) + 1);
  }
  for (const [message, count] of [...warningCounts].sort((a, b) => b[1] - a[1])) {
    warningReport.push(`  ${count}x ${message}`);
  }
  warningReport.push("Examples:");
  for (const warning of warnings.slice(0, maxWarnings)) warningReport.push(`  ${formatWarning(warning)}`);
  if (warnings.length > maxWarnings) warningReport.push(`  ... ${warnings.length - maxWarnings} more`);
  process.stdout.write(`${warningReport.join("\n")}\n`);
}

if (errors.length || (strict && warnings.length)) {
  console.error(`Theme contract check failed (${errors.length} errors, ${warnings.length} warnings).`);
  for (const error of errors) console.error(`  ${error}`);
  process.exit(1);
}

console.log(
  `Theme contract check passed (${sourceFiles.length} source files, ${definedVars.size} CSS variables, ${requiredResolvedTokens.length} required tokens).`,
);
