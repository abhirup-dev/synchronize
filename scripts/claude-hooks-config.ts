#!/usr/bin/env bun
/**
 * Merge or remove the synchronize Claude SessionStart hook in settings.json.
 * The hook is env-gated by the CLI command itself: without
 * SYNCHRONIZE_HOOK_ENABLE=1 it exits successfully without registration.
 *
 * Usage:
 *   bun run scripts/claude-hooks-config.ts <path>
 *   bun run scripts/claude-hooks-config.ts --remove <path>
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

interface HookCommand {
  type: string;
  command: string;
}

interface HookEntry {
  matcher?: string;
  hooks?: HookCommand[];
  [key: string]: unknown;
}

interface ClaudeSettings {
  hooks?: Record<string, HookEntry[]>;
  [key: string]: unknown;
}

const EVENT = "SessionStart";
const COMMAND = "synchronize hook claude-session";

function parseArgs(argv: string[]): { remove: boolean; path: string } {
  const args = argv.slice(2);
  let remove = false;
  const positional: string[] = [];
  for (const arg of args) {
    if (arg === "--remove" || arg === "-r") remove = true;
    else positional.push(arg);
  }
  if (positional.length !== 1) {
    process.stderr.write("Usage: claude-hooks-config.ts [--remove] <settings.json>\n");
    process.exit(2);
  }
  return { remove, path: positional[0]! };
}

function readSettings(path: string): ClaudeSettings {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, "utf8").trim();
  if (raw === "") return {};
  return JSON.parse(raw) as ClaudeSettings;
}

function writeSettings(path: string, settings: ClaudeSettings): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
}

function applyAdd(settings: ClaudeSettings): string {
  settings.hooks ??= {};
  const entries = settings.hooks[EVENT] ?? [];
  const existing = entries.some((entry) => entry.hooks?.some((hook) => hook.command === COMMAND));
  if (existing) {
    settings.hooks[EVENT] = entries;
    return "synchronize SessionStart hook already present";
  }
  entries.push({
    matcher: "",
    hooks: [{ type: "command", command: COMMAND }],
  });
  settings.hooks[EVENT] = entries;
  return "added synchronize SessionStart hook";
}

function applyRemove(settings: ClaudeSettings): string {
  const entries = settings.hooks?.[EVENT];
  if (!entries) return "synchronize SessionStart hook not present";
  const next = entries
    .map((entry) => ({
      ...entry,
      hooks: entry.hooks?.filter((hook) => hook.command !== COMMAND),
    }))
    .filter((entry) => (entry.hooks?.length ?? 0) > 0);
  settings.hooks![EVENT] = next;
  return next.length === entries.length ? "synchronize SessionStart hook not present" : "removed synchronize SessionStart hook";
}

const { remove, path } = parseArgs(process.argv);
const settings = readSettings(path);
const message = remove ? applyRemove(settings) : applyAdd(settings);
writeSettings(path, settings);
process.stdout.write(`${path}: ${message}\n`);
