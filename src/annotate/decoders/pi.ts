// Pi session-transcript decoder. Ports the Python annotator
// (scripts/.../pi_session/annotation.py) to the unified Annotation contract.
//
// One JSONL record (already JSON-parsed) → zero or more Annotations. We produce
// only FORMAT-level fields; the writer (index.ts) owns seq/turn_index/ts_ms/
// est_tokens. Defensive throughout: `record` is `unknown`, fields may be missing
// or the wrong type — we guard and never throw.
//
// Record-type → category/kind mapping (faithful to the Python):
//   session              → session / session_metadata
//   model_change         → runtime / model_change
//   thinking_level_change→ runtime / thinking_level_change
//   compaction           → runtime / compaction
//   message              → message + per-block assistant/user/tool annotations
//   (missing message obj)→ unknown / message_without_object
//   (other)              → unknown / unknown_record
//
// Tool classification and synchronize-XML extraction are delegated to the shared
// classify.ts helpers (classifyTool / toolCallKind / extractSynchronizeEvents /
// summarize) so behaviour stays identical across agents.

import type { Annotation, DecodeContext, Decoder } from "../types.ts";
import { classifyTool, toolCallKind, extractSynchronizeEvents, summarize } from "../classify.ts";

export const version = "0.1.0";

// ---- small defensive accessors -------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseIntOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value !== "string") return null;
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? null : n;
}

// Per-record carrier of the fields shared by every annotation a record emits.
interface RecordCtx {
  recordType: string | null;
  uuid: string | null; // record.id
  parentUuid: string | null; // record.parentId
  ts: string | null; // record.timestamp
}

function baseAnnotation(rc: RecordCtx, a: Partial<Annotation> & Pick<Annotation, "category" | "kind">): Annotation {
  return {
    recordType: rc.recordType,
    uuid: rc.uuid,
    parentUuid: rc.parentUuid,
    ts: rc.ts,
    ...a,
  };
}

// ---- main decoder --------------------------------------------------------------

export const decode: Decoder = (record: unknown, _lineNumber: number, _ctx: DecodeContext): Annotation[] => {
  const rec = asRecord(record);
  if (!rec) {
    // Mirror the Python file-loop guard: non-object records are diagnostics, not
    // annotations. The writer's reader already drops unparseable lines; an array
    // or scalar JSON line yields no annotations here.
    return [];
  }

  const rc: RecordCtx = {
    recordType: stringOrNull(rec.type),
    uuid: stringOrNull(rec.id),
    parentUuid: stringOrNull(rec.parentId),
    ts: stringOrNull(rec.timestamp),
  };

  const out: Annotation[] = [];

  switch (rc.recordType) {
    case "session": {
      const id = stringOrNull(rec.id);
      const sessionVersion = typeof rec.version === "number" ? rec.version : null;
      out.push(
        baseAnnotation(rc, {
          category: "session",
          kind: "session_metadata",
          summary: summarize(`Pi session ${id ?? ""}`.trim()),
          data: {
            session_id: id,
            version: sessionVersion,
            cwd: stringOrNull(rec.cwd),
          },
        }),
      );
      break;
    }
    case "model_change": {
      const provider = stringOrNull(rec.provider);
      const modelId = stringOrNull(rec.modelId);
      out.push(
        baseAnnotation(rc, {
          category: "runtime",
          kind: "model_change",
          summary: `${provider ?? "provider"} -> ${modelId ?? "model"}`,
          data: { provider, model_id: modelId },
        }),
      );
      break;
    }
    case "thinking_level_change": {
      const level = stringOrNull(rec.thinkingLevel);
      out.push(
        baseAnnotation(rc, {
          category: "runtime",
          kind: "thinking_level_change",
          summary: `thinking level ${level ?? ""}`.trim(),
          data: { thinking_level: level },
        }),
      );
      break;
    }
    case "compaction": {
      const summaryText = stringOrNull(rec.summary) ?? "";
      out.push(
        baseAnnotation(rc, {
          category: "runtime",
          kind: "compaction",
          summary: summarize(summaryText, 160),
          text: summaryText || null,
          data: { first_kept_entry_id: stringOrNull(rec.firstKeptEntryId) },
        }),
      );
      break;
    }
    case "message": {
      const message = asRecord(rec.message);
      if (!message) {
        out.push(
          baseAnnotation(rc, {
            category: "unknown",
            kind: "message_without_object",
            summary: "message record has no message object",
          }),
        );
      } else {
        annotateMessage(message, rc, out);
      }
      break;
    }
    default: {
      out.push(
        baseAnnotation(rc, {
          category: "unknown",
          kind: "unknown_record",
          summary: `unclassified record type ${rc.recordType === null ? "null" : JSON.stringify(rc.recordType)}`,
          data: { keys: Object.keys(rec).map(String).sort() },
        }),
      );
    }
  }

  return out;
};

// ---- message handling ----------------------------------------------------------

function annotateMessage(message: Record<string, unknown>, rc: RecordCtx, out: Annotation[]): void {
  const role = stringOrNull(message.role);
  const content = message.content;
  // Normalize content into an item list: array as-is, lone string → [string],
  // anything else → [] (matches the Python).
  const items: unknown[] = Array.isArray(content)
    ? content
    : typeof content === "string"
      ? [content]
      : [];

  out.push(
    baseAnnotation(rc, {
      category: "message",
      kind: `${role ?? "unknown"}_message`,
      role,
      summary: messageSummary(role, items, message),
      data: messageMetadata(message),
    }),
  );

  items.forEach((item, index) => {
    if (typeof item === "string") {
      annotateText(item, index, role, rc, out);
    } else {
      const block = asRecord(item);
      if (block) {
        annotateContentBlock(block, index, role, rc, out);
      } else {
        out.push(
          baseAnnotation(rc, {
            category: "unknown",
            kind: "unknown_content_block",
            role,
            contentIndex: index,
            summary: `unclassified content block ${item === null ? "null" : typeof item}`,
          }),
        );
      }
    }
  });

  if (role === "toolResult") {
    annotateToolResultMessage(message, rc, out);
  }

  const details = asRecord(message.details);
  if (details && details.mode === "call" && stringOrNull(details.tool)) {
    annotateToolCall(
      {
        tool: stringOrNull(details.tool) ?? "",
        args: details.arguments ?? details.input,
        toolCallId: stringOrNull(details.toolCallId),
        role,
        contentIndex: null,
        source: "message.details",
      },
      rc,
      out,
    );
  }
}

function annotateContentBlock(
  item: Record<string, unknown>,
  index: number,
  role: string | null,
  rc: RecordCtx,
  out: Annotation[],
): void {
  const blockType = stringOrNull(item.type);
  if (blockType === "text") {
    annotateText(stringOrNull(item.text) ?? "", index, role, rc, out);
  } else if (blockType === "thinking") {
    const thinking = stringOrNull(item.thinking) ?? "";
    out.push(
      baseAnnotation(rc, {
        category: "assistant",
        kind: "assistant_thinking",
        role,
        contentIndex: index,
        summary: summarize(thinking, 160) ?? "thinking block",
        text: thinking || null,
        data: { has_signature: Boolean(item.thinkingSignature) },
      }),
    );
  } else if (blockType === "toolCall") {
    annotateToolCall(
      {
        tool: stringOrNull(item.name) ?? "",
        args: item.arguments,
        toolCallId: stringOrNull(item.id),
        role,
        contentIndex: index,
        source: "content.toolCall",
      },
      rc,
      out,
    );
  } else {
    out.push(
      baseAnnotation(rc, {
        category: "unknown",
        kind: "unknown_content_block",
        role,
        contentIndex: index,
        summary: `unclassified content block type ${blockType === null ? "null" : JSON.stringify(blockType)}`,
        data: { keys: Object.keys(item).map(String).sort() },
      }),
    );
  }
}

function annotateText(
  text: string,
  index: number | null,
  role: string | null,
  rc: RecordCtx,
  out: Annotation[],
): void {
  // Embedded synchronize envelopes first, one annotation per match.
  for (const ev of extractSynchronizeEvents(text)) {
    const attrs = ev.attrs;
    const eventId = parseIntOrNull(attrs.event_id);
    out.push(
      baseAnnotation(rc, {
        category: "synchronize",
        kind: "synchronize_event",
        role,
        contentIndex: index,
        summary: synchronizeSummary(attrs.type ?? null, eventId, ev.body),
        text: ev.body || null,
        data: {
          event_type: attrs.type ?? null,
          event_id: eventId,
          sender_peer_id: attrs.from ?? null,
          recipient_peer_id: attrs.to ?? null,
          group_id: attrs.group_id ?? null,
          group_name: attrs.group_name ?? null,
          media_id: attrs.media_id ?? null,
          sent_at: attrs.sent_at ?? null,
        },
      }),
    );
  }

  let category: string;
  let kind: string;
  if (role === "assistant") {
    category = "assistant";
    kind = "assistant_text";
  } else if (role === "user") {
    category = "user";
    kind = text.trimStart().startsWith("<synchronize_event") ? "synchronize_injection" : "user_text";
  } else if (role === "toolResult") {
    category = "tool";
    kind = "tool_result_text";
  } else {
    category = "message";
    kind = "message_text";
  }

  out.push(
    baseAnnotation(rc, {
      category,
      kind,
      role,
      contentIndex: index,
      summary: summarize(text, 160),
      text: text || null,
    }),
  );
}

interface ToolCallArgs {
  tool: string;
  args: unknown;
  toolCallId: string | null;
  role: string | null;
  contentIndex: number | null;
  source: string;
}

function annotateToolCall(call: ToolCallArgs, rc: RecordCtx, out: Annotation[]): void {
  const cls = classifyTool(call.tool);
  out.push(
    baseAnnotation(rc, {
      category: cls.category,
      kind: toolCallKind(cls),
      role: call.role,
      contentIndex: call.contentIndex,
      tool: call.tool,
      normalizedTool: cls.normalizedTool,
      toolCallId: call.toolCallId,
      toolServer: cls.toolServer,
      source: call.source,
      summary: toolSummary(toolCallKind(cls), call.tool, call.args),
      data: { arguments: call.args ?? null },
    }),
  );
}

function annotateToolResultMessage(message: Record<string, unknown>, rc: RecordCtx, out: Annotation[]): void {
  const details = asRecord(message.details) ?? {};
  const server = stringOrNull(details.server);
  const detailTool = stringOrNull(details.tool);
  const rawTool = stringOrNull(message.toolName) ?? detailTool ?? "";
  const cls = classifyTool(rawTool);
  const isMcpResult = Boolean(server) || cls.category === "mcp";
  const isError = Boolean(message.isError);
  out.push(
    baseAnnotation(rc, {
      category: isMcpResult ? "mcp" : cls.category,
      kind: isMcpResult ? "mcp_tool_result" : "tool_result",
      role: "toolResult",
      tool: rawTool,
      // Prefer the explicit detail tool name (matches the Python's detail_tool ||
      // tool normalization) over the family-classified one.
      normalizedTool: detailTool ?? cls.normalizedTool,
      toolCallId: stringOrNull(message.toolCallId),
      toolServer: server ?? cls.toolServer,
      source: "message.toolResult",
      isError,
      summary: toolResultSummary(rawTool, server, detailTool, isError),
      data: {
        details,
        content_text_count: textBlocks(message.content).length,
      },
    }),
  );
}

// ---- summary / helper formatting (faithful to the Python) ----------------------

function messageSummary(role: string | null, items: unknown[], message: Record<string, unknown>): string {
  const stopReason = stringOrNull(message.stopReason);
  const suffix = stopReason ? `, stop=${stopReason}` : "";
  return `${role ?? "unknown"} message with ${items.length} content block(s)${suffix}`;
}

function messageMetadata(message: Record<string, unknown>): Record<string, unknown> {
  return {
    api: stringOrNull(message.api),
    provider: stringOrNull(message.provider),
    model: stringOrNull(message.model),
    stop_reason: stringOrNull(message.stopReason),
    error_message: stringOrNull(message.errorMessage),
    response_id: stringOrNull(message.responseId),
    message_timestamp: message.timestamp ?? null,
    usage: asRecord(message.usage),
  };
}

// Single-line tool-call summary mirroring the Python's tool_summary: sorted arg
// keys (first 6) for object args, type name otherwise.
function toolSummary(kind: string, tool: string, args: unknown): string {
  const argRec = asRecord(args);
  if (argRec && Object.keys(argRec).length > 0) {
    const keys = Object.keys(argRec)
      .map(String)
      .sort()
      .slice(0, 6)
      .join(", ");
    return `${kind} ${tool} args=${keys}`;
  }
  const isEmpty =
    args === null ||
    args === undefined ||
    (argRec && Object.keys(argRec).length === 0) ||
    (Array.isArray(args) && args.length === 0);
  if (!isEmpty) {
    return `${kind} ${tool} args=${argTypeName(args)}`;
  }
  return `${kind} ${tool}`;
}

function argTypeName(args: unknown): string {
  if (Array.isArray(args)) return "list";
  if (args !== null && typeof args === "object") return "dict";
  if (typeof args === "string") return "str";
  if (typeof args === "number") return Number.isInteger(args) ? "int" : "float";
  if (typeof args === "boolean") return "bool";
  return typeof args;
}

function toolResultSummary(tool: string, server: string | null, detailTool: string | null, isError: boolean): string {
  const status = isError ? "error" : "ok";
  if (server && detailTool) return `${status} result from ${server}.${detailTool}`;
  return `${status} result from ${tool}`;
}

function synchronizeSummary(eventType: string | null, eventId: number | null, body: string): string {
  const type = eventType ?? "event";
  const snippet = summarize(body, 80) ?? "";
  return eventId !== null ? `${type} #${eventId}: ${snippet}` : `${type}: ${snippet}`;
}

// Count of plain-text content blocks (string items or {type:"text", text:string}),
// mirroring the Python parser's text_blocks().
function textBlocks(content: unknown): string[] {
  if (typeof content === "string") return [content];
  if (!Array.isArray(content)) return [];
  const texts: string[] = [];
  for (const item of content) {
    if (typeof item === "string") {
      texts.push(item);
    } else {
      const block = asRecord(item);
      if (block && block.type === "text" && typeof block.text === "string") {
        texts.push(block.text);
      }
    }
  }
  return texts;
}
