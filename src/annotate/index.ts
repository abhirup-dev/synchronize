// Parser core: reads a host session transcript, decodes each record with the
// per-agent decoder, and writes the annotation lake + catalog state.
//
// Pluggability: register a new agent by adding `decoders/<agent>.ts` exporting
// { version, decode } and one entry in DECODERS. No other change.
//
// v0 ingestion is a FULL reparse per session (delete + reinsert) — idempotent
// and simple; sessions are small. Incremental append from annotated_offset is a
// later optimization (the reader already supports the offset).

import type { Database } from "bun:sqlite";
import type { Annotation, Decoder, Diagnostic, HostTool } from "./types.ts";
import { readJsonlLines } from "./reader.ts";
import { decode as decodeClaude, version as claudeVersion } from "./decoders/claude.ts";
import { decode as decodePi, version as piVersion } from "./decoders/pi.ts";

interface DecoderModule {
  version: string;
  decode: Decoder;
}

export const DECODERS: Record<HostTool, DecoderModule> = {
  claude: { version: claudeVersion, decode: decodeClaude },
  pi: { version: piVersion, decode: decodePi },
};

export const SCHEMA_VERSION = 1;

export interface AnnotateResult {
  bindingId: string;
  hostTool: string;
  annotationCount: number;
  diagnosticsCount: number;
  parsedLines: number;
  tsMin: number | null;
  tsMax: number | null;
  byCategory: Record<string, number>;
  byKind: Record<string, number>;
  byTool: Record<string, number>;
}

interface SessionRow {
  host_tool: string;
  host_session_file: string | null;
  cwd: string | null;
}

function tsToMs(ts: string | null | undefined): number | null {
  if (!ts) return null;
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? null : ms;
}

function estTokens(a: Annotation): number {
  const s = (a.text ?? a.summary ?? "").length;
  return Math.ceil(s / 4);
}

function projectSlug(cwd: string | null): string | null {
  if (!cwd) return null;
  const parts = cwd.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1]! : null;
}

const INSERT_SQL = `
  INSERT INTO session_annotations (
    binding_id, seq, turn_index, ts_ms, line_number, category, kind, record_type,
    role, uuid, parent_uuid, content_index, tool, normalized_tool, tool_call_id,
    tool_server, source, is_error, summary, text, est_tokens, data_json
  ) VALUES (
    $binding_id, $seq, $turn_index, $ts_ms, $line_number, $category, $kind, $record_type,
    $role, $uuid, $parent_uuid, $content_index, $tool, $normalized_tool, $tool_call_id,
    $tool_server, $source, $is_error, $summary, $text, $est_tokens, $data_json
  )
`;

// Annotate a single session by binding_id. Full reparse, transactional.
export async function annotateSession(db: Database, bindingId: string): Promise<AnnotateResult> {
  const session = db
    .query<SessionRow, [string]>(
      "SELECT host_tool, host_session_file, cwd FROM agent_sessions WHERE binding_id = ?",
    )
    .get(bindingId);
  if (!session) throw new Error(`unknown binding_id: ${bindingId}`);

  const hostTool = session.host_tool as HostTool;
  const mod = DECODERS[hostTool];
  if (!mod) throw new Error(`no decoder for host_tool: ${session.host_tool}`);
  if (!session.host_session_file) {
    throw new Error(`binding ${bindingId} has no host_session_file (fallback locator is post-v0)`);
  }

  const { lines, endOffset } = await readJsonlLines(session.host_session_file, 0);

  const annotations: Array<Annotation & { seq: number; turnIndex: number; lineNumber: number }> = [];
  const diagnostics: Diagnostic[] = [];
  const ctx = { state: {} };
  let seq = 0;
  let turnIndex = -1;

  for (const line of lines) {
    let record: unknown;
    try {
      record = JSON.parse(line.text);
    } catch (err) {
      diagnostics.push({ lineNumber: line.lineNumber, message: String(err), raw: line.text.slice(0, 500) });
      continue;
    }
    let decoded: Annotation[];
    try {
      decoded = mod.decode(record, line.lineNumber, ctx);
    } catch (err) {
      diagnostics.push({ lineNumber: line.lineNumber, message: `decode: ${String(err)}`, raw: line.text.slice(0, 500) });
      continue;
    }
    if (decoded.length === 0) continue;
    turnIndex++;
    for (const a of decoded) {
      annotations.push({ ...a, seq: seq++, turnIndex, lineNumber: line.lineNumber });
    }
  }

  const byCategory: Record<string, number> = {};
  const byKind: Record<string, number> = {};
  const byTool: Record<string, number> = {};
  let tsMin: number | null = null;
  let tsMax: number | null = null;
  for (const a of annotations) {
    byCategory[a.category] = (byCategory[a.category] ?? 0) + 1;
    byKind[a.kind] = (byKind[a.kind] ?? 0) + 1;
    if (a.normalizedTool) byTool[a.normalizedTool] = (byTool[a.normalizedTool] ?? 0) + 1;
    const ms = tsToMs(a.ts);
    if (ms !== null) {
      if (tsMin === null || ms < tsMin) tsMin = ms;
      if (tsMax === null || ms > tsMax) tsMax = ms;
    }
  }

  const insert = db.query(INSERT_SQL);
  const writeAll = db.transaction(() => {
    db.query("DELETE FROM session_annotations WHERE binding_id = ?").run(bindingId);
    for (const a of annotations) {
      insert.run({
        binding_id: bindingId,
        seq: a.seq,
        turn_index: a.turnIndex,
        ts_ms: tsToMs(a.ts),
        line_number: a.lineNumber,
        category: a.category,
        kind: a.kind,
        record_type: a.recordType ?? null,
        role: a.role ?? null,
        uuid: a.uuid ?? null,
        parent_uuid: a.parentUuid ?? null,
        content_index: a.contentIndex ?? null,
        tool: a.tool ?? null,
        normalized_tool: a.normalizedTool ?? null,
        tool_call_id: a.toolCallId ?? null,
        tool_server: a.toolServer ?? null,
        source: a.source ?? null,
        is_error: a.isError === null || a.isError === undefined ? null : a.isError ? 1 : 0,
        summary: a.summary ?? null,
        text: a.text ?? null,
        est_tokens: estTokens(a),
        data_json: a.data ? JSON.stringify(a.data) : null,
      });
    }
    db.query(
      `INSERT INTO session_annotation_state (
         binding_id, project, schema_version, parser_version, content_hash,
         annotated_offset, annotated_lines, annotation_count, ts_min, ts_max,
         by_category_json, by_kind_json, by_tool_json, diagnostics_count, annotated_at
       ) VALUES (
         $binding_id, $project, $schema_version, $parser_version, NULL,
         $annotated_offset, $annotated_lines, $annotation_count, $ts_min, $ts_max,
         $by_category_json, $by_kind_json, $by_tool_json, $diagnostics_count,
         strftime('%Y-%m-%dT%H:%M:%fZ','now')
       )
       ON CONFLICT(binding_id) DO UPDATE SET
         project=excluded.project, schema_version=excluded.schema_version,
         parser_version=excluded.parser_version, annotated_offset=excluded.annotated_offset,
         annotated_lines=excluded.annotated_lines, annotation_count=excluded.annotation_count,
         ts_min=excluded.ts_min, ts_max=excluded.ts_max,
         by_category_json=excluded.by_category_json, by_kind_json=excluded.by_kind_json,
         by_tool_json=excluded.by_tool_json, diagnostics_count=excluded.diagnostics_count,
         annotated_at=excluded.annotated_at`,
    ).run({
      binding_id: bindingId,
      project: projectSlug(session.cwd),
      schema_version: SCHEMA_VERSION,
      parser_version: `${hostTool}-decoder@${mod.version}`,
      annotated_offset: endOffset,
      annotated_lines: lines.length,
      annotation_count: annotations.length,
      ts_min: tsMin,
      ts_max: tsMax,
      by_category_json: JSON.stringify(byCategory),
      by_kind_json: JSON.stringify(byKind),
      by_tool_json: JSON.stringify(byTool),
      diagnostics_count: diagnostics.length,
    });
  });
  writeAll();

  return {
    bindingId,
    hostTool,
    annotationCount: annotations.length,
    diagnosticsCount: diagnostics.length,
    parsedLines: lines.length,
    tsMin,
    tsMax,
    byCategory,
    byKind,
    byTool,
  };
}
