// Claude Code session-transcript decoder. One parsed JSONL record → zero or more
// Annotations. Ported faithfully from the Python prototype
// (scripts/session_annotation/claude.py): same record-type routing and same
// category/kind/tool classification.
//
// Format-level fields only — the writer (index.ts) assigns seq/turn_index/
// ts_ms/est_tokens. We DO set `ts` from the record timestamp so the writer can
// derive ts_ms. Tool classification and synchronize-XML extraction are delegated
// to the shared classify.ts helpers; we never reinvent them here.

import type { Annotation, Decoder, DecodeContext } from "../types.ts";
import {
  classifyTool,
  toolCallKind,
  extractSynchronizeEvents,
  summarize,
  type SyncEvent,
} from "../classify.ts";

export const version = "0.1.0";

// ── tiny defensive helpers ────────────────────────────────────────────────

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function sortedKeys(obj: Record<string, unknown>): string[] {
  return Object.keys(obj).map((k) => String(k)).sort();
}

// Mirror of the Python type-name used for the tool_result content_type field.
function pyTypeName(value: unknown): string {
  if (value === null || value === undefined) return "NoneType";
  if (typeof value === "string") return "str";
  if (typeof value === "boolean") return "bool";
  if (typeof value === "number") return Number.isInteger(value) ? "int" : "float";
  if (Array.isArray(value)) return "list";
  if (typeof value === "object") return "dict";
  return typeof value;
}

// Per-session running state: tool_use_id → tool name (so a later tool_result on
// another line can resolve its originating tool). Lives in ctx.state.
function toolNamesById(ctx: DecodeContext): Record<string, string> {
  let map = ctx.state.toolNamesById as Record<string, string> | undefined;
  if (!map) {
    map = {};
    ctx.state.toolNamesById = map;
  }
  return map;
}

// ── builder ───────────────────────────────────────────────────────────────
// Carries the per-record context fields applied to every annotation it emits,
// matching the Python _Builder/_Context split.

interface RecordContext {
  recordType: string | null;
  uuid: string | null;
  parentUuid: string | null;
  ts: string | null;
  role?: string | null;
}

class Builder {
  readonly out: Annotation[] = [];
  constructor(private readonly ctx: RecordContext) {}

  add(fields: Partial<Annotation> & { category: string; kind: string }): void {
    this.out.push({
      recordType: this.ctx.recordType,
      uuid: this.ctx.uuid,
      parentUuid: this.ctx.parentUuid,
      ts: this.ctx.ts,
      ...fields,
    });
  }
}

// ── synchronize envelope extraction ───────────────────────────────────────
// Delegates to the shared extractSynchronizeEvents (do not reinvent). Each
// SyncEvent becomes a synchronize annotation; useful attrs are surfaced into
// `data` (mirroring the Python without_body() structured payload).

// Python's parse_envelope() gate: an extracted <channel …>/<synchronize_event …>
// is only treated as a real envelope when it carries at least one recognized
// event attribute. The shared extractSynchronizeEvents() has no such gate (it
// matches any well-formed tag), so elided/pasted transcript fragments like
// `<synchronize_event …>` would otherwise be counted. Replicate the gate here
// rather than in the shared extractor (Pi relies on the ungated extractor).
//
// The gate runs against the RAW attribute region of the tag, not the shared
// extractor's parsed attrs: transcripts frequently carry envelopes whose quotes
// are backslash-escaped (`source=\"synchronize\"`), which the shared attr regex
// (requiring a literal `="`) parses as empty. Python's shlex-based parser tolerates
// the escaping, so gating on parsed attrs would wrongly drop real envelopes. We
// re-match the same tag regexes the shared extractor uses (identical patterns →
// identical order/count) and zip the gate decision onto each SyncEvent.
const EVENT_LIKE_KEYS = [
  "source",
  "event_id",
  "type",
  "sender_peer_id",
  "recipient_peer_id",
  "from",
  "from_id",
  "to",
  "group_id",
  "media_id",
  "sent_at",
];
const EVENT_LIKE_RE = new RegExp(`\\b(?:${EVENT_LIKE_KEYS.join("|")})\\s*=`);
const CHANNEL_TAG_RE = /<channel\b([^>]*)>([\s\S]*?)<\/channel>/g;
const SYNC_EVENT_TAG_RE = /<synchronize_event\b([^>]*)>([\s\S]*?)<\/synchronize_event>/g;

// Raw attribute regions for every channel/synchronize_event tag in `text`, in the
// same document order the shared extractor walks them.
function rawAttrRegions(text: string): string[] {
  const regions: string[] = [];
  let m: RegExpExecArray | null;
  CHANNEL_TAG_RE.lastIndex = 0;
  while ((m = CHANNEL_TAG_RE.exec(text)) !== null) regions.push(m[1]!);
  SYNC_EVENT_TAG_RE.lastIndex = 0;
  while ((m = SYNC_EVENT_TAG_RE.exec(text)) !== null) regions.push(m[1]!);
  return regions;
}

// Extract synchronize envelopes from `text` and keep only the event-like ones,
// mirroring Python's parse_envelope gate. Order matches extractSynchronizeEvents.
function gatedSynchronizeEvents(text: string): SyncEvent[] {
  const events = extractSynchronizeEvents(text);
  if (events.length === 0) return events;
  const regions = rawAttrRegions(text);
  return events.filter((_event, i) => {
    const raw = regions[i];
    return raw !== undefined && EVENT_LIKE_RE.test(raw);
  });
}

function syncData(event: SyncEvent): Record<string, unknown> {
  const a = event.attrs;
  const eventIdRaw = a.event_id;
  const eventId =
    eventIdRaw !== undefined && /^-?\d+$/.test(eventIdRaw) ? Number(eventIdRaw) : null;
  return {
    envelope_kind: event.kind === "synchronize_channel" ? "channel" : "synchronize_event",
    source: a.source ?? null,
    event_type: a.type ?? null,
    event_id: eventId,
    sender_peer_id: a.sender_peer_id ?? a.from ?? a.from_id ?? null,
    recipient_peer_id: a.recipient_peer_id ?? a.to ?? null,
    group_id: a.group_id ?? null,
    media_id: a.media_id ?? null,
    sent_at: a.sent_at ?? null,
  };
}

function syncSummary(event: SyncEvent): string {
  const data = syncData(event);
  const eventType = (data.event_type as string | null) ?? "event";
  const eventId = data.event_id as number | null;
  const body = summarize(event.body, 80) ?? "";
  return eventId !== null ? `${eventType} #${eventId}: ${body}` : `${eventType}: ${body}`;
}

function emitEmbeddedSynchronize(text: string, builder: Builder, source: string): void {
  for (const event of gatedSynchronizeEvents(text)) {
    builder.add({
      category: "synchronize",
      kind: event.kind, // "synchronize_channel" | "synchronize_event"
      source,
      summary: syncSummary(event),
      text: event.body,
      data: syncData(event),
    });
  }
}

// ── summaries ─────────────────────────────────────────────────────────────

function toolSummary(kind: string, tool: string, input: unknown): string {
  if (isObject(input) && Object.keys(input).length > 0) {
    const keys = sortedKeys(input).slice(0, 6).join(", ");
    return `${kind} ${tool} args=${keys}`;
  }
  return `${kind} ${tool}`.trim();
}

function toolResultSummary(tool: string, isError: boolean, content: unknown): string {
  const status = isError ? "error" : "ok";
  const snip = summarize(typeof content === "string" ? content : String(content), 100) ?? "";
  return tool
    ? `${status} result from ${tool}: ${snip}`
    : `${status} tool result: ${snip}`;
}

function attachmentSummary(attachment: Record<string, unknown>): string {
  const kind = stringOrNull(attachment.type) ?? "unknown";
  if (kind === "queued_command") {
    const origin = isObject(attachment.origin) ? attachment.origin : {};
    const who = stringOrNull(origin.server) ?? stringOrNull(origin.kind) ?? "unknown";
    return `queued command from ${who}`;
  }
  if (kind === "hook_success") {
    const name = stringOrNull(attachment.hookName) ?? stringOrNull(attachment.hookEvent) ?? "";
    return `hook success ${name}`.trim();
  }
  if (kind === "deferred_tools_delta") {
    const added = Array.isArray(attachment.addedNames) ? attachment.addedNames : [];
    const removed = Array.isArray(attachment.removedNames) ? attachment.removedNames : [];
    return `deferred tools delta +${added.length} -${removed.length}`;
  }
  return `attachment ${kind}`;
}

function systemSummary(record: Record<string, unknown>): string {
  const subtype = stringOrNull(record.subtype) ?? "system";
  if (subtype === "stop_hook_summary") {
    return `stop hook summary: ${(record.hookCount as number | undefined) ?? 0} hooks`;
  }
  return subtype;
}

function messageSummary(message: Record<string, unknown>, contentCount: number): string {
  const role = stringOrNull(message.role) ?? "unknown";
  const stop = stringOrNull(message.stop_reason);
  const suffix = stop ? `, stop=${stop}` : "";
  return `${role} message with ${contentCount} content block(s)${suffix}`;
}

function messageMetadata(
  record: Record<string, unknown>,
  message: Record<string, unknown>,
): Record<string, unknown> {
  return {
    message_id: stringOrNull(message.id),
    model: stringOrNull(message.model),
    request_id: stringOrNull(record.requestId),
    advisor_model: stringOrNull(record.advisorModel),
    session_kind: stringOrNull(record.sessionKind),
    user_type: stringOrNull(record.userType),
    entrypoint: stringOrNull(record.entrypoint),
    cwd: stringOrNull(record.cwd),
    git_branch: stringOrNull(record.gitBranch),
    stop_reason: stringOrNull(message.stop_reason),
    usage: isObject(message.usage) ? message.usage : null,
    attribution_mcp_server: stringOrNull(record.attributionMcpServer),
    attribution_mcp_tool: stringOrNull(record.attributionMcpTool),
  };
}

// ── state / session records ───────────────────────────────────────────────

const STATE_KEYS: Record<string, [kind: string, valueKey: string]> = {
  "agent-setting": ["agent_setting", "agentSetting"],
  "agent-name": ["agent_name", "agentName"],
  "custom-title": ["custom_title", "customTitle"],
  "permission-mode": ["permission_mode", "permissionMode"],
  mode: ["mode", "mode"],
  "last-prompt": ["last_prompt", "leafUuid"],
  "worktree-state": ["worktree_state", "worktreeSession"],
};

function annotateStateRecord(record: Record<string, unknown>, builder: Builder): void {
  const recordType = stringOrNull(record.type) ?? "state";
  const entry = STATE_KEYS[recordType];
  if (!entry) return;
  const [kind, valueKey] = entry;
  const value = record[valueKey];
  builder.add({
    category: "session",
    kind,
    summary: `${kind}: ${summarize(JSON.stringify(value ?? null), 120) ?? ""}`,
    data: { [valueKey]: value ?? null },
  });
}

// ── attachment records ──────────────────────────────────────────────────────

function attachmentTexts(attachment: Record<string, unknown>): string[] {
  const texts: string[] = [];
  for (const key of ["content", "stdout", "stderr", "prompt"]) {
    const value = attachment[key];
    if (typeof value === "string") texts.push(value);
  }
  return texts;
}

function annotateAttachment(record: Record<string, unknown>, builder: Builder): void {
  const attachment = isObject(record.attachment) ? record.attachment : {};
  const attachmentType = stringOrNull(attachment.type) ?? "unknown";
  builder.add({
    category: "attachment",
    kind: `attachment_${attachmentType}`,
    summary: attachmentSummary(attachment),
    data: { attachment_type: attachmentType, keys: sortedKeys(attachment) },
  });

  if (attachmentType === "queued_command") {
    const prompt = stringOrNull(attachment.prompt) ?? "";
    // Python only pulls <channel …> envelopes here; mirror that by emitting only
    // the synchronize_channel events from the prompt.
    for (const event of gatedSynchronizeEvents(prompt)) {
      if (event.kind !== "synchronize_channel") continue;
      builder.add({
        category: "synchronize",
        kind: "synchronize_channel",
        source: "attachment.queued_command",
        summary: syncSummary(event),
        text: event.body,
        data: syncData(event),
      });
    }
  } else if (attachmentType === "hook_success") {
    for (const text of attachmentTexts(attachment)) {
      emitEmbeddedSynchronize(text, builder, "attachment.hook_success");
    }
  } else if (attachmentType === "deferred_tools_delta") {
    const added = Array.isArray(attachment.addedNames) ? attachment.addedNames : [];
    const removed = Array.isArray(attachment.removedNames) ? attachment.removedNames : [];
    for (const tool of added) {
      if (typeof tool !== "string") continue;
      const cls = classifyTool(tool);
      builder.add({
        category: cls.category,
        kind: "tool_available",
        tool,
        normalizedTool: cls.normalizedTool,
        toolServer: cls.toolServer,
        source: "attachment.deferred_tools_delta",
        summary: `tool available ${tool}`,
      });
    }
    if (removed.length > 0) {
      builder.add({
        category: "tool",
        kind: "tools_removed",
        source: "attachment.deferred_tools_delta",
        summary: `${removed.length} tools removed`,
        data: { removed },
      });
    }
  }
}

// ── system records ──────────────────────────────────────────────────────────

function annotateSystem(record: Record<string, unknown>, builder: Builder): void {
  const subtype = stringOrNull(record.subtype) ?? "system";
  builder.add({
    category: "system",
    kind: `system_${subtype}`,
    summary: systemSummary(record),
    data: {
      hook_count: record.hookCount ?? null,
      prevented_continuation: record.preventedContinuation ?? null,
      stop_reason: record.stopReason ?? null,
      level: record.level ?? null,
      tool_use_id: record.toolUseID ?? null,
    },
  });
}

// ── message records (assistant / user) ──────────────────────────────────────

function annotateText(
  text: string,
  index: number | null,
  role: string | null,
  builder: Builder,
): void {
  emitEmbeddedSynchronize(text, builder, "content.text");
  const category = role === "assistant" ? "assistant" : role === "user" ? "user" : "message";
  builder.add({
    category,
    kind: `${role ?? "message"}_text`,
    role,
    contentIndex: index,
    summary: summarize(text, 160),
    text,
  });
}

function annotateContentBlock(
  item: Record<string, unknown>,
  index: number,
  role: string | null,
  builder: Builder,
  toolMap: Record<string, string>,
): void {
  const blockType = stringOrNull(item.type);

  if (blockType === "text") {
    annotateText(stringOrNull(item.text) ?? "", index, role, builder);
    return;
  }

  if (blockType === "thinking") {
    const thinking = stringOrNull(item.thinking) ?? "";
    builder.add({
      category: "assistant",
      kind: "assistant_thinking",
      role,
      contentIndex: index,
      summary: summarize(thinking, 160) ?? "thinking block",
      text: thinking,
      data: { has_signature: Boolean(item.signature) },
    });
    return;
  }

  if (blockType === "tool_use") {
    const tool = stringOrNull(item.name) ?? "";
    const toolId = stringOrNull(item.id);
    if (toolId && tool) toolMap[toolId] = tool;
    const cls = classifyTool(tool);
    const kind = toolCallKind(cls);
    builder.add({
      category: cls.category,
      kind,
      role,
      contentIndex: index,
      tool,
      normalizedTool: cls.normalizedTool,
      toolCallId: toolId,
      toolServer: cls.toolServer,
      source: "content.tool_use",
      summary: toolSummary(kind, tool, item.input),
      data: { input: item.input ?? null, caller: item.caller ?? null },
    });
    return;
  }

  if (blockType === "tool_result") {
    const toolId = stringOrNull(item.tool_use_id);
    const tool = (toolId && toolMap[toolId]) || "";
    const cls = classifyTool(tool);
    const isMcp = cls.category === "mcp";
    const isError = Boolean(item.is_error);
    builder.add({
      category: isMcp ? "mcp" : "tool",
      kind: isMcp ? "mcp_tool_result" : "tool_result",
      role,
      contentIndex: index,
      tool: tool || null,
      // Python passes classify_tool("")→normalized_tool None for the empty case;
      // classifyTool("") returns normalizedTool "" — normalize empty to null.
      normalizedTool: cls.normalizedTool || null,
      toolCallId: toolId,
      toolServer: cls.toolServer,
      source: "content.tool_result",
      isError,
      summary: toolResultSummary(tool, isError, item.content),
      text: typeof item.content === "string" ? item.content : null,
      data: { content_type: pyTypeName(item.content) },
    });
    if (typeof item.content === "string") {
      emitEmbeddedSynchronize(item.content, builder, "content.tool_result");
    }
    return;
  }

  if (blockType === "server_tool_use") {
    const tool =
      stringOrNull(item.name) ?? stringOrNull(item.tool_name) ?? "server_tool";
    const cls = classifyTool(tool);
    builder.add({
      category: "tool",
      kind: "server_tool_use",
      role,
      contentIndex: index,
      tool,
      normalizedTool: cls.normalizedTool,
      toolCallId: stringOrNull(item.id),
      source: "content.server_tool_use",
      summary: toolSummary("server_tool_use", tool, item.input),
      data: { input: item.input ?? null },
    });
    return;
  }

  if (blockType === "advisor_tool_result") {
    const content = isObject(item.content) ? item.content : {};
    builder.add({
      category: "assistant",
      kind: "advisor_tool_result",
      role,
      contentIndex: index,
      toolCallId: stringOrNull(item.tool_use_id),
      source: "content.advisor_tool_result",
      summary: summarize(stringOrNull(content.text) ?? "advisor result", 160),
      text: stringOrNull(content.text),
      data: { content_type: content.type ?? null },
    });
    return;
  }

  if (blockType === "image") {
    builder.add({
      category: "message",
      kind: "image_block",
      role,
      contentIndex: index,
      summary: "image block",
      data: { keys: sortedKeys(item) },
    });
    return;
  }

  builder.add({
    category: "unknown",
    kind: "unknown_content_block",
    role,
    contentIndex: index,
    summary: `unclassified content block type ${blockType === null ? "None" : `'${blockType}'`}`,
    data: { keys: sortedKeys(item) },
  });
}

function recordLevelTexts(record: Record<string, unknown>): string[] {
  const texts: string[] = [];
  const value = record.toolUseResult;
  if (typeof value === "string") texts.push(value);
  return texts;
}

function annotateMessageRecord(
  record: Record<string, unknown>,
  builder: Builder,
  toolMap: Record<string, string>,
): void {
  const message = isObject(record.message) ? record.message : {};
  const role = stringOrNull(message.role) ?? stringOrNull(record.type);
  const content = message.content;
  const contentItems: unknown[] = Array.isArray(content)
    ? content
    : typeof content === "string"
      ? [content]
      : [];

  builder.add({
    category: "message",
    kind: `${role ?? "unknown"}_message`,
    role,
    summary: messageSummary(message, contentItems.length),
    data: messageMetadata(record, message),
  });

  contentItems.forEach((item, index) => {
    if (typeof item === "string") {
      annotateText(item, index, role, builder);
    } else if (isObject(item)) {
      annotateContentBlock(item, index, role, builder, toolMap);
    } else {
      builder.add({
        category: "unknown",
        kind: "unknown_content_block",
        role,
        contentIndex: index,
        summary: `unclassified content block ${pyTypeName(item)}`,
      });
    }
  });

  for (const text of recordLevelTexts(record)) {
    emitEmbeddedSynchronize(text, builder, "record");
  }
}

// ── decoder entrypoint ──────────────────────────────────────────────────────

const STATE_RECORD_TYPES = new Set([
  "agent-setting",
  "agent-name",
  "custom-title",
  "permission-mode",
  "mode",
  "last-prompt",
  "worktree-state",
]);

export const decode: Decoder = (record, _lineNumber, ctx) => {
  if (!isObject(record)) return [];

  const recordType = stringOrNull(record.type);
  const builder = new Builder({
    recordType,
    uuid: stringOrNull(record.uuid),
    parentUuid: stringOrNull(record.parentUuid),
    ts: stringOrNull(record.timestamp),
  });

  if (recordType !== null && STATE_RECORD_TYPES.has(recordType)) {
    annotateStateRecord(record, builder);
  } else if (recordType === "file-history-snapshot") {
    builder.add({
      category: "runtime",
      kind: "file_history_snapshot",
      summary: "file history snapshot",
      data: { is_snapshot_update: record.isSnapshotUpdate ?? null },
    });
  } else if (recordType === "queue-operation") {
    builder.add({
      category: "runtime",
      kind: "queue_operation",
      summary: `queue ${record.operation ?? "undefined"}`,
      data: { operation: record.operation ?? null },
    });
  } else if (recordType === "attachment") {
    annotateAttachment(record, builder);
  } else if (recordType === "system") {
    annotateSystem(record, builder);
  } else if (recordType === "assistant" || recordType === "user") {
    annotateMessageRecord(record, builder, toolNamesById(ctx));
  } else {
    builder.add({
      category: "unknown",
      kind: "unknown_record",
      summary: `unclassified record type ${recordType === null ? "None" : `'${recordType}'`}`,
      data: { keys: sortedKeys(record) },
    });
  }

  return builder.out;
};
