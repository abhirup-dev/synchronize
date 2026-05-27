#!/usr/bin/env bun
/**
 * Merge or remove the synchronize Claude SessionStart hook in settings.json.
 * The installed hook is env-gated before resolving the synchronize binary:
 * without SYNCHRONIZE_HOOK_ENABLE=1 it exits successfully without touching
 * PATH, Bun shims, or the daemon.
 *
 * Usage:
 *   bun run scripts/claude-hooks-config.ts <path>
 *   bun run scripts/claude-hooks-config.ts --remove <path>
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
const LEGACY_COMMAND = "synchronize hook claude-session";
const CONFIGURED_CLI = join(dirname(dirname(fileURLToPath(import.meta.url))), "bin", "synchronize");
const COMMAND = buildHookCommand(CONFIGURED_CLI);

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
  let changed = false;
  for (const entry of entries) {
    for (const hook of entry.hooks ?? []) {
      if (hook.command === LEGACY_COMMAND) {
        hook.command = COMMAND;
        changed = true;
      }
    }
  }
  const existing = entries.some((entry) => entry.hooks?.some((hook) => hook.command === COMMAND));
  if (existing) {
    settings.hooks[EVENT] = entries;
    return changed ? "updated synchronize SessionStart hook" : "synchronize SessionStart hook already present";
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
      hooks: entry.hooks?.filter((hook) => hook.command !== COMMAND && hook.command !== LEGACY_COMMAND),
    }))
    .filter((entry) => (entry.hooks?.length ?? 0) > 0);
  settings.hooks![EVENT] = next;
  return next.length === entries.length ? "synchronize SessionStart hook not present" : "removed synchronize SessionStart hook";
}

function buildHookCommand(configuredCli: string): string {
  const script = [
    '[ "${SYNCHRONIZE_HOOK_ENABLE:-}" = "1" ] || exit 0',
    'for candidate in "${SYNCHRONIZE_CLI:-}" "${SYNCHRONIZE_CONFIGURED_CLI:-}" "$(command -v synchronize 2>/dev/null)"; do',
    '  [ -n "$candidate" ] || continue',
    '  [ -x "$candidate" ] || continue',
    '  "$candidate" status >/dev/null 2>&1 || continue',
    '  exec "$candidate" hook claude-session',
    "done",
    "exit 0",
  ].join("\n");
  return `SYNCHRONIZE_CONFIGURED_CLI=${shellQuote(configuredCli)} sh -c ${shellQuote(script)}`;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

const { remove, path } = parseArgs(process.argv);
const settings = readSettings(path);
const message = remove ? applyRemove(settings) : applyAdd(settings);
writeSettings(path, settings);
process.stdout.write(`${path}: ${message}\n`);
