#!/usr/bin/env bun
/**
 * Print a shell command that starts synchronize-mcp from the most reliable
 * available location: explicit env override, this checkout's bin/, then PATH.
 * It first verifies that a synchronize CLI can reach/start the daemon.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const configuredCli = join(repoRoot, "bin", "synchronize");
const configuredMcp = join(repoRoot, "bin", "synchronize-mcp");

const command = [
  `SYNCHRONIZE_CONFIGURED_CLI=${shellQuote(configuredCli)}`,
  `SYNCHRONIZE_CONFIGURED_MCP=${shellQuote(configuredMcp)}`,
  'for cli in "${SYNCHRONIZE_CLI:-}" "${SYNCHRONIZE_CONFIGURED_CLI:-}" "$(command -v synchronize 2>/dev/null)"; do',
  '  [ -n "$cli" ] || continue',
  '  [ -x "$cli" ] || continue',
  '  "$cli" status >/dev/null 2>&1 || continue',
  '  for mcp in "${SYNCHRONIZE_MCP:-}" "${SYNCHRONIZE_CONFIGURED_MCP:-}" "$(command -v synchronize-mcp 2>/dev/null)"; do',
  '    [ -n "$mcp" ] || continue',
  '    [ -x "$mcp" ] || continue',
  '    exec "$mcp"',
  "  done",
  "done",
  "exit 1",
].join("\n");

process.stdout.write(command);

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
