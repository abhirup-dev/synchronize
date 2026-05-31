import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, delimiter, join, resolve } from "node:path";
import type { SkillCatalogEntry, SkillRuntime } from "./api/types.ts";

const MAX_SCAN_DEPTH = 3;

interface LoadSkillCatalogInput {
  repoRoot: string;
  env?: NodeJS.ProcessEnv;
}

interface SkillSource {
  runtime: SkillRuntime;
  root: string;
}

export async function loadSkillCatalog(input: LoadSkillCatalogInput): Promise<SkillCatalogEntry[]> {
  const env = input.env ?? process.env;
  const sources = skillSources(input.repoRoot, env);
  const byName = new Map<string, SkillCatalogEntry>();

  for (const source of sources) {
    for (const skillPath of await findSkillFiles(source.root, MAX_SCAN_DEPTH)) {
      const entry = await readSkillEntry(skillPath, source.runtime);
      if (!entry) continue;
      const existing = byName.get(entry.name);
      if (!existing) {
        byName.set(entry.name, entry);
        continue;
      }
      if (!existing.runtimes.includes(source.runtime)) {
        existing.runtimes = [...existing.runtimes, source.runtime].sort(runtimeSort);
      }
      if (!existing.description && entry.description) existing.description = entry.description;
      if (!existing.source_path && entry.source_path) existing.source_path = entry.source_path;
    }
  }

  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function skillSources(repoRoot: string, env: NodeJS.ProcessEnv): SkillSource[] {
  const home = homedir();
  const claudeRoots = [
    ...envPaths(env.SYNCHRONIZE_CLAUDE_SKILL_DIRS),
    join(repoRoot, ".claude", "skills"),
    join(home, ".claude", "skills"),
  ];
  const piRoots = [
    ...envPaths(env.SYNCHRONIZE_PI_SKILL_DIRS),
    join(home, ".pi", "agent", "skills"),
    join(home, ".agents", "skills"),
  ];
  return uniqueSources([
    ...claudeRoots.map((root) => ({ runtime: "claude" as const, root })),
    ...piRoots.map((root) => ({ runtime: "pi" as const, root })),
  ]);
}

function envPaths(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(delimiter)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => resolve(part));
}

function uniqueSources(sources: SkillSource[]): SkillSource[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = `${source.runtime}:${source.root}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function findSkillFiles(root: string, maxDepth: number): Promise<string[]> {
  const results: string[] = [];

  async function visit(dir: string, depth: number): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((entry) => entry.isFile() && entry.name === "SKILL.md")) {
      results.push(join(dir, "SKILL.md"));
      return;
    }
    if (depth >= maxDepth) return;
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .filter((entry) => entry.name !== "node_modules" && entry.name !== ".git")
        .map((entry) => visit(join(dir, entry.name), depth + 1)),
    );
  }

  await visit(root, 0);
  return results;
}

async function readSkillEntry(path: string, runtime: SkillRuntime): Promise<SkillCatalogEntry | null> {
  let markdown: string;
  try {
    markdown = await readFile(path, "utf8");
  } catch {
    return null;
  }
  const metadata = parseFrontmatter(markdown);
  const fallbackName = basename(resolve(path, ".."));
  const name = sanitizeSkillName(metadata.name ?? fallbackName);
  if (!name) return null;
  return {
    id: name,
    name,
    description: metadata.description ?? "",
    runtimes: [runtime],
    source_path: path,
  };
}

function parseFrontmatter(markdown: string): { name?: string; description?: string } {
  const match = /^---\n([\s\S]*?)\n---/.exec(markdown);
  if (!match) return {};
  const result: { name?: string; description?: string } = {};
  const lines = match[1]!.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const keyMatch = /^(name|description):\s*(.*)$/.exec(line);
    if (!keyMatch) continue;
    let value = keyMatch[2]!.trim().replace(/^["']|["']$/g, "");
    if ((value === ">" || value === "|") && keyMatch[1] === "description") {
      const blockStyle = value;
      const block: string[] = [];
      while (index + 1 < lines.length && /^\s+/.test(lines[index + 1]!)) {
        index += 1;
        block.push(lines[index]!.trim());
      }
      value = blockStyle === ">" ? block.join(" ") : block.join("\n");
    }
    if (keyMatch[1] === "name") result.name = value;
    if (keyMatch[1] === "description") result.description = value;
  }
  return result;
}

function sanitizeSkillName(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed;
}

function runtimeSort(left: SkillRuntime, right: SkillRuntime): number {
  const order: Record<SkillRuntime, number> = { claude: 0, pi: 1 };
  return order[left] - order[right];
}
