import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const host = process.argv[2];
const target = process.argv[3];

if (!host || !target) {
  console.error("Usage: bun run scripts/install-skill.ts <claude|pi> <target-dir>");
  process.exit(1);
}

const routerByHost: Record<string, string> = {
  claude: "synchronize-claude",
  pi: "synchronize-pi",
};

const routerDir = routerByHost[host];
if (!routerDir) {
  console.error(`Unknown skill host: ${host}`);
  process.exit(1);
}

const targetDir = resolve(target);

rmSync(targetDir, { recursive: true, force: true });
mkdirSync(targetDir, { recursive: true });

cpSync(join(root, "skills", routerDir, "SKILL.md"), join(targetDir, "SKILL.md"));
cpSync(join(root, "skills", "synchronize-shared", "workflows"), join(targetDir, "workflows"), {
  recursive: true,
});
cpSync(join(root, "skills", "synchronize-shared", "reference"), join(targetDir, "reference"), {
  recursive: true,
});

validateSkillPackage(targetDir);

console.log(`Installed synchronize ${host} skill to ${targetDir}`);

function validateSkillPackage(skillDir: string): void {
  const errors: string[] = [];
  const markdownFiles = listMarkdownFiles(skillDir);
  const requiredPaths = [
    "SKILL.md",
    "workflows/reply-to-event.md",
    "workflows/check-group.md",
    "workflows/catch-up-thread.md",
    "workflows/missed-delivery.md",
    "workflows/lightweight-ack.md",
    "reference/identity.md",
    "reference/peers.md",
    "reference/dms.md",
    "reference/groups.md",
    "reference/threads.md",
    "reference/mentions.md",
    "reference/inbox.md",
    "reference/reactions.md",
    "reference/sql-queries.md",
    "reference/event-delivery.md",
    "reference/cli-fallback.md",
    "reference/troubleshooting.md",
  ];

  for (const path of requiredPaths) assertNonEmpty(skillDir, path, errors);

  for (const refPath of readdirSync(join(skillDir, "reference")).filter((name) => name.endsWith(".md"))) {
    const deepPath = `reference/deep-dives/${refPath}`;
    assertNonEmpty(skillDir, deepPath, errors);
    const refText = readFileSync(join(skillDir, "reference", refPath), "utf8");
    if (!refText.includes(deepPath)) {
      errors.push(`${relative(skillDir, join(skillDir, "reference", refPath))} does not link to ${deepPath}`);
    }
  }

  for (const file of markdownFiles) {
    const text = readFileSync(file, "utf8");
    const refs = text.matchAll(/\b(?:workflows|reference)\/[A-Za-z0-9._/-]+\.md\b/g);
    for (const match of refs) {
      const targetPath = match[0];
      if (!existsSync(join(skillDir, targetPath))) {
        errors.push(`${relative(skillDir, file)} points to missing ${targetPath}`);
      }
    }
  }

  if (errors.length > 0) {
    console.error(`Invalid synchronize ${host} skill package:`);
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
}

function assertNonEmpty(skillDir: string, path: string, errors: string[]): void {
  const fullPath = join(skillDir, path);
  if (!existsSync(fullPath)) {
    errors.push(`missing ${path}`);
    return;
  }
  if (statSync(fullPath).size === 0) errors.push(`empty ${path}`);
}

function listMarkdownFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) files.push(...listMarkdownFiles(fullPath));
    else if (entry.endsWith(".md")) files.push(fullPath);
  }
  return files;
}
