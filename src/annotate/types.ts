// Unified session-annotation types. One transcript record (JSONL line) decodes
// into zero or more Annotations. Decoders produce only FORMAT-level fields; the
// writer (index.ts) owns the cross-cutting ordering keys (seq, turn_index,
// ts_ms, est_tokens) and inline text storage.
// See session-tracker/plan-unified-session-annotation-v0.md.

export type HostTool = "claude" | "pi";

// Canonical categories (union across agents):
//   session | runtime | message | assistant | user | tool | mcp | synchronize
//   | attachment | system | unknown
export interface Annotation {
  category: string;
  kind: string;
  recordType?: string | null;
  role?: string | null;
  uuid?: string | null;
  parentUuid?: string | null;
  contentIndex?: number | null;
  tool?: string | null;
  normalizedTool?: string | null;
  toolCallId?: string | null;
  toolServer?: string | null;
  source?: string | null;
  isError?: boolean | null;
  summary?: string | null;
  text?: string | null;
  // ISO-8601 timestamp for this annotation, if the record carries one. The
  // writer normalizes it to ts_ms. Omit/null when the record has no time.
  ts?: string | null;
  // Structured extras → data_json.
  data?: Record<string, unknown> | null;
}

export interface DecodeContext {
  // Per-session running state a decoder may accumulate across lines (e.g. a map
  // of tool_use_id → tool name so a later tool_result can resolve its tool).
  // Decoders own the shape; the writer just constructs one per session.
  state: Record<string, unknown>;
}

// A decoder turns one parsed JSONL record into annotations. It must NOT set
// seq/turn_index/ts_ms/est_tokens — the writer assigns those. `record` is the
// already-JSON-parsed line. Pure and synchronous.
export type Decoder = (record: unknown, lineNumber: number, ctx: DecodeContext) => Annotation[];

export interface Diagnostic {
  lineNumber: number;
  message: string;
  raw: string;
}
