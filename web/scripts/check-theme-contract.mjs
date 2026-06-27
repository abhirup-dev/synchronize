#!/usr/bin/env bun
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src");
const strict = process.argv.includes("--strict");

const registry = JSON.parse(readFileSync(join(src, "theme/theme-registry.json"), "utf8"));
const themeIds = Object.keys(registry.theme ?? {});
const skinIds = Object.keys(registry.skin ?? {});

const cssTokenFiles = new Set(["src/styles/tokens.css", "src/tw.css"]);
const rawColorAllowed = [
  /^src\/styles\/tokens\.css$/,
  /^src\/skin-glass\.css$/,
  /^src\/styles\/code-light\.css$/,
  /^src\/chat-bg\.css$/,
  /^src\/data\/chatBackgrounds\.ts$/,
  /^src\/data\/seed\.ts$/,
  /^src\/theme\/identity\.ts$/,
  /^src\/theme\/contrast\.ts$/,
  /^src\/components\/AgentColorPicker\.tsx$/,
  /^src\/.*\.stories\.tsx$/,
];

const errors = [];
const warnings = [];
const legacyUndefinedVars = new Set(["--opt-color"]);

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
  warnings.push(`${file}${line ? `:${line}` : ""}: ${message}`);
}

function isRawColorAllowed(file) {
  return rawColorAllowed.some((pattern) => pattern.test(file));
}

const files = walk(src).filter((file) => /\.(css|ts|tsx|json)$/.test(file));
const cssFiles = files.filter((file) => file.endsWith(".css"));
const sourceFiles = files.filter((file) => /\.(css|ts|tsx)$/.test(file));

const cssTextByFile = new Map(cssFiles.map((file) => [rel(file), readFileSync(file, "utf8")]));
const allSource = sourceFiles.map((file) => [rel(file), readFileSync(file, "utf8")]);

const definedVars = new Map();
function rememberVar(name, file, line) {
  if (!definedVars.has(name)) definedVars.set(name, []);
  definedVars.get(name).push({ file, line });
}

for (const [file, text] of allSource) {
  text.split(/\r?\n/).forEach((line, index) => {
    for (const match of line.matchAll(/(?:^|[;{])\s*--([a-z0-9-]+)\s*:/gi)) {
      rememberVar(`--${match[1]}`, file, index + 1);
    }
    for (const match of line.matchAll(/["'](--[a-z0-9-]+)["']\s*:/gi)) {
      rememberVar(match[1], file, index + 1);
    }
    for (const match of line.matchAll(/setProperty\(["'](--[a-z0-9-]+)["']/gi)) {
      rememberVar(match[1], file, index + 1);
    }
  });
}

const rootTokenNames = new Set();
for (const file of cssTokenFiles) {
  const text = cssTextByFile.get(file) ?? "";
  for (const match of text.matchAll(/(?:^|[;{])\s*--([a-z0-9-]+)\s*:/gim)) {
    rootTokenNames.add(`--${match[1]}`);
  }
}

const rawColor = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|lab|lch)\(/;
const varRef = /var\((--[a-z0-9-]+)/g;
const retiredToken = /--message-card-/;

for (const [file, text] of allSource) {
  text.split(/\r?\n/).forEach((line, index) => {
    const lineNumber = index + 1;

    if (retiredToken.test(line)) {
      addError(file, lineNumber, "retired --message-card-* token");
    }

    if (!isRawColorAllowed(file) && rawColor.test(line) && !line.trim().startsWith("//")) {
      addWarning(file, lineNumber, "raw color literal outside token/asset/story allowlist");
    }

    for (const match of line.matchAll(varRef)) {
      if (!definedVars.has(match[1]) && !match[1].endsWith("-")) {
        if (legacyUndefinedVars.has(match[1])) {
          addWarning(file, lineNumber, `legacy undefined CSS variable ${match[1]}`);
          continue;
        }
        addError(file, lineNumber, `unknown CSS variable ${match[1]}`);
      }
    }

    const definition = line.match(/(?:^|[;{])\s*--([a-z0-9-]+)\s*:/i);
    if (definition) {
      const name = `--${definition[1]}`;
      if (!cssTokenFiles.has(file) && rootTokenNames.has(name)) {
        addError(file, lineNumber, `global token ${name} redefined outside token files`);
      } else if (!cssTokenFiles.has(file) && /:root|\[data-theme=|\[data-skin=/.test(line)) {
        addWarning(file, lineNumber, `theme-scope variable ${name} defined outside token files`);
      }
    }

    if (!cssTokenFiles.has(file) && /\b(?:bg|text|border|shadow)-\[(?:#[0-9a-fA-F]|rgba?\(|hsla?\(|oklch\()/i.test(line)) {
      addError(file, lineNumber, "raw color embedded in Tailwind arbitrary utility");
    }
  });
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

const maxWarnings = 12;
if (warnings.length) {
  console.warn(`Theme contract warnings (${warnings.length}; ${strict ? "strict mode fails" : "non-fatal"}):`);
  for (const warning of warnings.slice(0, maxWarnings)) console.warn(`  ${warning}`);
  if (warnings.length > maxWarnings) console.warn(`  ... ${warnings.length - maxWarnings} more`);
}

if (errors.length || (strict && warnings.length)) {
  console.error(`Theme contract check failed (${errors.length} errors, ${warnings.length} warnings).`);
  for (const error of errors) console.error(`  ${error}`);
  process.exit(1);
}

console.log(`Theme contract check passed (${sourceFiles.length} source files, ${definedVars.size} CSS variables).`);
