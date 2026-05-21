#!/usr/bin/env bun
/**
 * Merge or remove the `synchronize` MCP server entry in a Pi MCP config file
 * (typically ~/.pi/agent/mcp.json). Preserves any other servers already
 * defined and pretty-prints the result with 2-space indent.
 *
 * Usage:
 *   bun run scripts/pi-mcp-config.ts <path>            # add/update synchronize
 *   bun run scripts/pi-mcp-config.ts --remove <path>   # remove synchronize
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";

interface ServerEntry {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface PiMcpConfig {
  mcpServers?: Record<string, ServerEntry>;
  [key: string]: unknown;
}

function parseArgs(argv: string[]): { remove: boolean; path: string } {
  const args = argv.slice(2);
  let remove = false;
  const positional: string[] = [];
  for (const arg of args) {
    if (arg === "--remove" || arg === "-r") remove = true;
    else if (arg === "--help" || arg === "-h") {
      process.stderr.write(
        "Usage: pi-mcp-config.ts [--remove] <path-to-mcp.json>\n",
      );
      process.exit(0);
    } else positional.push(arg);
  }
  if (positional.length !== 1) {
    process.stderr.write("error: expected exactly one path argument\n");
    process.exit(2);
  }
  return { remove, path: positional[0]! };
}

function readConfig(path: string): PiMcpConfig {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, "utf8").trim();
  if (raw === "") return {};
  try {
    return JSON.parse(raw) as PiMcpConfig;
  } catch (error) {
    throw new Error(`failed to parse ${path}: ${(error as Error).message}`);
  }
}

function writeConfig(path: string, config: PiMcpConfig): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
}

const SYNCHRONIZE_ENTRY: ServerEntry = {
  command: "synchronize-mcp",
  env: { SYNCHRONIZE_MCP_MODE: "codex" },
};

function applyAdd(config: PiMcpConfig): { changed: boolean; reason: string } {
  const servers: Record<string, ServerEntry> = { ...(config.mcpServers ?? {}) };
  const existing = servers["synchronize"];
  if (existing && JSON.stringify(existing) === JSON.stringify(SYNCHRONIZE_ENTRY)) {
    return { changed: false, reason: "synchronize entry already up to date" };
  }
  servers["synchronize"] = SYNCHRONIZE_ENTRY;
  config.mcpServers = servers;
  return { changed: true, reason: existing ? "updated synchronize entry" : "added synchronize entry" };
}

function applyRemove(config: PiMcpConfig): { changed: boolean; reason: string } {
  if (!config.mcpServers || !("synchronize" in config.mcpServers)) {
    return { changed: false, reason: "synchronize entry not present" };
  }
  const { synchronize: _drop, ...rest } = config.mcpServers;
  config.mcpServers = rest;
  return { changed: true, reason: "removed synchronize entry" };
}

function main(): void {
  const { remove, path } = parseArgs(process.argv);
  const config = readConfig(path);
  const result = remove ? applyRemove(config) : applyAdd(config);
  if (result.changed) writeConfig(path, config);
  process.stdout.write(`${path}: ${result.reason}\n`);
}

main();
