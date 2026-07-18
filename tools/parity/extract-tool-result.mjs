#!/usr/bin/env node
// Decode a Claude-Design read_file result to disk — the large-file path.
//
// When a file is too big for the cheap-model pull (tools/parity/pull-file.sh),
// pull it in the MAIN session with the MCP tool:
//
//     mcp__claude_design__read_file  (project_id, path)
//
// The Claude Code harness spills any large tool result to a JSON file under
// the session's tool-results/ dir (only a ~2 KiB preview enters context) and
// prints its path. read_file wraps the bytes in an <untrusted-project-content>
// tag and HTML-entity-escapes & < > so they can't close the tag. This script
// unwraps + unescapes that back to the original file bytes — no model ever
// re-emits the content, so nothing is truncated or transcribed.
//
// Usage:
//   node tools/parity/extract-tool-result.mjs <tool-results.json> <outFile> [--expect N]
//   # accepts a raw .txt/.json spill or the wrapper text on stdin (pass - as input)

import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const inPath = args[0];
const outPath = args[1];
const expect = (() => { const i = args.indexOf("--expect"); return i >= 0 ? +args[i + 1] : null; })();
if (!inPath || !outPath) { console.error("usage: extract-tool-result.mjs <in.json|-> <out> [--expect N]"); process.exit(1); }

let raw = readFileSync(inPath === "-" ? 0 : inPath, "utf8");

// Unwrap the harness envelope: a spilled MCP result is [{type:"text",text:"..."}].
try { const j = JSON.parse(raw); if (Array.isArray(j) && j[0]?.text) raw = j[0].text; } catch {}

// Strip the read_file wrapper tag + the trailing "(body is escaped…)" note.
const open = raw.match(/<untrusted-project-content[^>]*>\n?/);
if (open) raw = raw.slice(open.index + open[0].length);
raw = raw.replace(/\n?<\/untrusted-project-content>[\s\S]*$/, "");

// Reverse read_file's entity escaping. Decode &amp; LAST so a literal "&lt;"
// in the source (escaped as "&amp;lt;") is not double-decoded.
const bytes = raw.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

writeFileSync(outPath, bytes);
const got = Buffer.byteLength(bytes);
console.log(`wrote ${got} bytes -> ${outPath}`);
if (expect != null && got !== expect) {
  // Boundary newline handling can differ by ±a couple bytes; larger gaps mean
  // the read was windowed/capped (>256 KiB) and you did not capture it all.
  console.error(`WARN: expected ${expect}, got ${got} (diff ${got - expect})`);
  if (Math.abs(got - expect) > 4) process.exit(3);
}
