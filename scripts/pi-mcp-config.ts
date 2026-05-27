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
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
  command: "sh",
  args: ["-c", buildMcpCommand()],
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

function buildMcpCommand(): string {
  const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const configuredCli = join(repoRoot, "bin", "synchronize");
  const configuredMcp = join(repoRoot, "bin", "synchronize-mcp");
  return [
    `SYNCHRONIZE_CONFIGURED_CLI=${shellQuote(configuredCli)}`,
    `SYNCHRONIZE_CONFIGURED_MCP=${shellQuote(configuredMcp)}`,
    "for cli in \"${SYNCHRONIZE_CLI:-}\" \"${SYNCHRONIZE_CONFIGURED_CLI:-}\" \"$(command -v synchronize 2>/dev/null)\"; do",
    "  [ -n \"$cli\" ] || continue",
    "  [ -x \"$cli\" ] || continue",
    "  \"$cli\" status >/dev/null 2>&1 || continue",
    "  for mcp in \"${SYNCHRONIZE_MCP:-}\" \"${SYNCHRONIZE_CONFIGURED_MCP:-}\" \"$(command -v synchronize-mcp 2>/dev/null)\"; do",
    "    [ -n \"$mcp\" ] || continue",
    "    [ -x \"$mcp\" ] || continue",
    "    exec \"$mcp\"",
    "  done",
    "done",
    "exit 1",
  ].join("\n");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function main(): void {
  const { remove, path } = parseArgs(process.argv);
  const config = readConfig(path);
  const result = remove ? applyRemove(config) : applyAdd(config);
  if (result.changed) writeConfig(path, config);
  process.stdout.write(`${path}: ${result.reason}\n`);
}

main();
