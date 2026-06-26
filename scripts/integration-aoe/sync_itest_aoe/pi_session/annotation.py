from __future__ import annotations

import json
import xml.etree.ElementTree as ET
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ..utils.records import parse_int, string_or_none
from .parser import SYNC_EVENT_CLOSE, SYNC_EVENT_OPEN, text_blocks
from .state import ParseDiagnostic


MCP_PREFIXES = ("synchronize_bridge_",)
MCP_PREFIX_SERVERS = {"synchronize_bridge_": "synchronize"}
SHELL_TOOLS = {"bash", "shell", "terminal"}
FILESYSTEM_TOOLS = {"read", "write", "edit", "glob", "grep", "ls", "list", "search", "apply_patch"}
WEB_TOOLS = {"web_search", "web_fetch", "web", "browser", "fetch", "search_web"}
USER_INTERACTION_TOOLS = {"ask_user", "askUser", "request_user_input"}


@dataclass(frozen=True)
class PiSessionAnnotation:
    path: Path
    line_number: int
    sequence: int
    category: str
    kind: str
    record_type: str | None
    entry_id: str | None = None
    parent_id: str | None = None
    timestamp: str | None = None
    role: str | None = None
    content_index: int | None = None
    tool: str | None = None
    normalized_tool: str | None = None
    tool_call_id: str | None = None
    tool_server: str | None = None
    source: str | None = None
    is_error: bool | None = None
    summary: str | None = None
    text: str | None = None
    data: dict[str, Any] = field(default_factory=dict)

    def to_json(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "path": str(self.path),
            "line_number": self.line_number,
            "sequence": self.sequence,
            "category": self.category,
            "kind": self.kind,
            "record_type": self.record_type,
        }
        optional = {
            "entry_id": self.entry_id,
            "parent_id": self.parent_id,
            "timestamp": self.timestamp,
            "role": self.role,
            "content_index": self.content_index,
            "tool": self.tool,
            "normalized_tool": self.normalized_tool,
            "tool_call_id": self.tool_call_id,
            "tool_server": self.tool_server,
            "source": self.source,
            "is_error": self.is_error,
            "summary": self.summary,
            "text": self.text,
            "data": self.data or None,
        }
        for key, value in optional.items():
            if value is not None:
                result[key] = value
        return result


@dataclass
class PiSessionAnnotationReport:
    path: Path
    annotations: list[PiSessionAnnotation] = field(default_factory=list)
    diagnostics: list[ParseDiagnostic] = field(default_factory=list)
    parsed_lines: int = 0

    def append(self, annotation: PiSessionAnnotation) -> None:
        self.annotations.append(annotation)

    def append_diagnostic(self, diagnostic: ParseDiagnostic) -> None:
        self.diagnostics.append(diagnostic)

    def summary(self) -> dict[str, Any]:
        by_category = Counter(annotation.category for annotation in self.annotations)
        by_kind = Counter(annotation.kind for annotation in self.annotations)
        by_tool = Counter(annotation.normalized_tool or annotation.tool for annotation in self.annotations if annotation.tool or annotation.normalized_tool)
        by_record_type = Counter(annotation.record_type for annotation in self.annotations if annotation.record_type)
        return {
            "path": str(self.path),
            "parsed_lines": self.parsed_lines,
            "annotation_count": len(self.annotations),
            "diagnostic_count": len(self.diagnostics),
            "by_category": dict(sorted(by_category.items())),
            "by_kind": dict(sorted(by_kind.items())),
            "by_record_type": dict(sorted(by_record_type.items())),
            "by_tool": dict(sorted(by_tool.items())),
        }

    def to_json(self) -> dict[str, Any]:
        return {
            "summary": self.summary(),
            "annotations": [annotation.to_json() for annotation in self.annotations],
            "diagnostics": [
                {
                    "path": str(diagnostic.path),
                    "line_number": diagnostic.line_number,
                    "message": diagnostic.message,
                    "raw": diagnostic.raw,
                }
                for diagnostic in self.diagnostics
            ],
        }


@dataclass(frozen=True)
class _RecordContext:
    path: Path
    line_number: int
    sequence_start: int
    record_type: str | None
    entry_id: str | None
    parent_id: str | None
    timestamp: str | None


def annotate_session_file(path: Path, *, include_text: bool = False) -> PiSessionAnnotationReport:
    report = PiSessionAnnotationReport(path=path)
    sequence = 0
    with path.open(encoding="utf-8", errors="replace") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            report.parsed_lines += 1
            try:
                record = json.loads(line)
            except json.JSONDecodeError as error:
                report.append_diagnostic(
                    ParseDiagnostic(
                        path=path,
                        line_number=line_number,
                        message=f"JSON parse error: {error.msg}",
                        raw=line.rstrip("\n"),
                    )
                )
                continue
            if not isinstance(record, dict):
                report.append_diagnostic(
                    ParseDiagnostic(
                        path=path,
                        line_number=line_number,
                        message="JSONL entry is not an object",
                        raw=line.rstrip("\n"),
                    )
                )
                continue
            annotations = annotate_record(record, path, line_number, sequence_start=sequence, include_text=include_text)
            for annotation in annotations:
                report.append(annotation)
            sequence += len(annotations)
    return report


def annotate_record(
    record: dict[str, Any],
    path: Path,
    line_number: int,
    *,
    sequence_start: int = 0,
    include_text: bool = False,
) -> list[PiSessionAnnotation]:
    context = _RecordContext(
        path=path,
        line_number=line_number,
        sequence_start=sequence_start,
        record_type=string_or_none(record.get("type")),
        entry_id=string_or_none(record.get("id")),
        parent_id=string_or_none(record.get("parentId")),
        timestamp=string_or_none(record.get("timestamp")),
    )
    builder = _AnnotationBuilder(context, include_text=include_text)

    record_type = context.record_type
    if record_type == "session":
        builder.add(
            category="session",
            kind="session_metadata",
            summary=f"Pi session {record.get('id') or ''}".strip(),
            data={
                "session_id": string_or_none(record.get("id")),
                "version": record.get("version") if isinstance(record.get("version"), int) else None,
                "cwd": string_or_none(record.get("cwd")),
            },
        )
    elif record_type == "model_change":
        builder.add(
            category="runtime",
            kind="model_change",
            summary=f"{record.get('provider') or 'provider'} -> {record.get('modelId') or 'model'}",
            data={"provider": string_or_none(record.get("provider")), "model_id": string_or_none(record.get("modelId"))},
        )
    elif record_type == "thinking_level_change":
        builder.add(
            category="runtime",
            kind="thinking_level_change",
            summary=f"thinking level {record.get('thinkingLevel') or ''}".strip(),
            data={"thinking_level": string_or_none(record.get("thinkingLevel"))},
        )
    elif record_type == "compaction":
        summary = string_or_none(record.get("summary")) or ""
        builder.add(
            category="runtime",
            kind="compaction",
            summary=snippet(summary, 160),
            text=summary if include_text else None,
            data={"first_kept_entry_id": string_or_none(record.get("firstKeptEntryId"))},
        )
    elif record_type == "message":
        message = record.get("message") if isinstance(record.get("message"), dict) else None
        if message is None:
            builder.add(category="unknown", kind="message_without_object", summary="message record has no message object")
        else:
            annotate_message(message, builder)
    else:
        builder.add(
            category="unknown",
            kind="unknown_record",
            summary=f"unclassified record type {record_type!r}",
            data={"keys": sorted(str(key) for key in record.keys())},
        )

    return builder.annotations


def annotate_message(message: dict[str, Any], builder: "_AnnotationBuilder") -> None:
    role = string_or_none(message.get("role"))
    content = message.get("content")
    content_items = content if isinstance(content, list) else [content] if isinstance(content, str) else []
    builder.add(
        category="message",
        kind=f"{role or 'unknown'}_message",
        role=role,
        summary=message_summary(role, content_items, message),
        data=message_metadata(message),
    )

    for index, item in enumerate(content_items):
        if isinstance(item, str):
            annotate_text(item, index, role, builder)
        elif isinstance(item, dict):
            annotate_content_block(item, index, role, builder)
        else:
            builder.add(
                category="unknown",
                kind="unknown_content_block",
                role=role,
                content_index=index,
                summary=f"unclassified content block {type(item).__name__}",
            )

    if role == "toolResult":
        annotate_tool_result_message(message, builder)

    details = message.get("details") if isinstance(message.get("details"), dict) else None
    if details and details.get("mode") == "call" and string_or_none(details.get("tool")):
        annotate_tool_call(
            tool=string_or_none(details.get("tool")) or "",
            arguments=details.get("arguments") or details.get("input"),
            tool_call_id=string_or_none(details.get("toolCallId")),
            role=role,
            content_index=None,
            source="message.details",
            builder=builder,
        )


def annotate_content_block(item: dict[str, Any], index: int, role: str | None, builder: "_AnnotationBuilder") -> None:
    block_type = string_or_none(item.get("type"))
    if block_type == "text":
        annotate_text(string_or_none(item.get("text")) or "", index, role, builder)
    elif block_type == "thinking":
        thinking = string_or_none(item.get("thinking")) or ""
        builder.add(
            category="assistant",
            kind="assistant_thinking",
            role=role,
            content_index=index,
            summary=snippet(thinking, 160) or "thinking block",
            text=thinking if builder.include_text else None,
            data={"has_signature": bool(item.get("thinkingSignature"))},
        )
    elif block_type == "toolCall":
        annotate_tool_call(
            tool=string_or_none(item.get("name")) or "",
            arguments=item.get("arguments"),
            tool_call_id=string_or_none(item.get("id")),
            role=role,
            content_index=index,
            source="content.toolCall",
            builder=builder,
        )
    else:
        builder.add(
            category="unknown",
            kind="unknown_content_block",
            role=role,
            content_index=index,
            summary=f"unclassified content block type {block_type!r}",
            data={"keys": sorted(str(key) for key in item.keys())},
        )


def annotate_text(text: str, index: int | None, role: str | None, builder: "_AnnotationBuilder") -> None:
    for sync_event in parse_synchronize_event_annotations(text):
        builder.add(
            category="synchronize",
            kind="synchronize_event",
            role=role,
            content_index=index,
            summary=synchronize_summary(sync_event),
            text=sync_event.pop("body", None) if builder.include_text else None,
            data=sync_event,
        )

    if role == "assistant":
        category = "assistant"
        kind = "assistant_text"
    elif role == "user":
        category = "user"
        kind = "synchronize_injection" if text.strip().startswith(SYNC_EVENT_OPEN) else "user_text"
    elif role == "toolResult":
        category = "tool"
        kind = "tool_result_text"
    else:
        category = "message"
        kind = "message_text"

    builder.add(
        category=category,
        kind=kind,
        role=role,
        content_index=index,
        summary=snippet(text, 160),
        text=text if builder.include_text else None,
    )


def annotate_tool_call(
    *,
    tool: str,
    arguments: Any,
    tool_call_id: str | None,
    role: str | None,
    content_index: int | None,
    source: str,
    builder: "_AnnotationBuilder",
) -> None:
    classified = classify_tool(tool)
    builder.add(
        category=classified["category"],
        kind=classified["kind"],
        role=role,
        content_index=content_index,
        tool=tool,
        normalized_tool=classified["normalized_tool"],
        tool_call_id=tool_call_id,
        tool_server=classified["server"],
        source=source,
        summary=tool_summary(classified["kind"], tool, arguments),
        data={"arguments": arguments},
    )


def annotate_tool_result_message(message: dict[str, Any], builder: "_AnnotationBuilder") -> None:
    details = message.get("details") if isinstance(message.get("details"), dict) else {}
    raw_tool = string_or_none(message.get("toolName")) or string_or_none(details.get("tool")) or ""
    server = string_or_none(details.get("server"))
    detail_tool = string_or_none(details.get("tool"))
    classified = classify_tool(raw_tool, server=server, detail_tool=detail_tool)
    is_mcp_result = bool(server) or classified["category"] == "mcp"
    builder.add(
        category="mcp" if is_mcp_result else classified["category"],
        kind="mcp_tool_result" if is_mcp_result else "tool_result",
        role="toolResult",
        tool=raw_tool,
        normalized_tool=classified["normalized_tool"],
        tool_call_id=string_or_none(message.get("toolCallId")),
        tool_server=server or classified["server"],
        source="message.toolResult",
        is_error=bool(message.get("isError")),
        summary=tool_result_summary(raw_tool, server, detail_tool, bool(message.get("isError"))),
        data={
            "details": details,
            "content_text_count": len(text_blocks(message.get("content"))),
        },
    )


def classify_tool(tool: str, *, server: str | None = None, detail_tool: str | None = None) -> dict[str, str | None]:
    normalized = detail_tool or tool
    inferred_server = server
    category = "tool"
    kind = "tool_call"

    for prefix in MCP_PREFIXES:
        if tool.startswith(prefix):
            inferred_server = inferred_server or MCP_PREFIX_SERVERS.get(prefix)
            normalized = "bridge_" + tool.removeprefix(prefix)
            category = "mcp"
            kind = "mcp_tool_call"
            break

    if server:
        category = "mcp"
        kind = "mcp_tool_call"
    elif tool == "mcp":
        category = "mcp"
        kind = "mcp_generic_call"
    elif tool in SHELL_TOOLS:
        kind = "shell_tool_call"
    elif tool in FILESYSTEM_TOOLS:
        kind = "filesystem_tool_call"
    elif tool in WEB_TOOLS:
        kind = "web_tool_call"
    elif tool in USER_INTERACTION_TOOLS:
        kind = "user_interaction_tool_call"

    return {"category": category, "kind": kind, "normalized_tool": normalized or None, "server": inferred_server}


def parse_synchronize_event_annotations(text: str) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    start = 0
    while True:
        open_index = text.find(SYNC_EVENT_OPEN, start)
        if open_index == -1:
            return events
        close_index = text.find(SYNC_EVENT_CLOSE, open_index)
        if close_index == -1:
            return events
        end_index = close_index + len(SYNC_EVENT_CLOSE)
        raw = text[open_index:end_index]
        start = end_index
        try:
            root = ET.fromstring(raw)
        except ET.ParseError as error:
            events.append({"parse_error": str(error), "raw": raw})
            continue
        events.append(
            {
                "event_type": root.attrib.get("type"),
                "event_id": parse_int(root.attrib.get("event_id")),
                "sender_peer_id": root.attrib.get("from"),
                "recipient_peer_id": root.attrib.get("to"),
                "group_id": root.attrib.get("group_id"),
                "group_name": root.attrib.get("group_name"),
                "media_id": root.attrib.get("media_id"),
                "sent_at": root.attrib.get("sent_at"),
                "body": (root.text or "").strip(),
            }
        )


class _AnnotationBuilder:
    def __init__(self, context: _RecordContext, *, include_text: bool) -> None:
        self.context = context
        self.include_text = include_text
        self.annotations: list[PiSessionAnnotation] = []

    def add(
        self,
        *,
        category: str,
        kind: str,
        role: str | None = None,
        content_index: int | None = None,
        tool: str | None = None,
        normalized_tool: str | None = None,
        tool_call_id: str | None = None,
        tool_server: str | None = None,
        source: str | None = None,
        is_error: bool | None = None,
        summary: str | None = None,
        text: str | None = None,
        data: dict[str, Any] | None = None,
    ) -> None:
        self.annotations.append(
            PiSessionAnnotation(
                path=self.context.path,
                line_number=self.context.line_number,
                sequence=self.context.sequence_start + len(self.annotations),
                category=category,
                kind=kind,
                record_type=self.context.record_type,
                entry_id=self.context.entry_id,
                parent_id=self.context.parent_id,
                timestamp=self.context.timestamp,
                role=role,
                content_index=content_index,
                tool=tool,
                normalized_tool=normalized_tool,
                tool_call_id=tool_call_id,
                tool_server=tool_server,
                source=source,
                is_error=is_error,
                summary=summary,
                text=text,
                data=data or {},
            )
        )


def message_summary(role: str | None, content_items: list[Any], message: dict[str, Any]) -> str:
    stop_reason = string_or_none(message.get("stopReason"))
    suffix = f", stop={stop_reason}" if stop_reason else ""
    return f"{role or 'unknown'} message with {len(content_items)} content block(s){suffix}"


def message_metadata(message: dict[str, Any]) -> dict[str, Any]:
    return {
        "api": string_or_none(message.get("api")),
        "provider": string_or_none(message.get("provider")),
        "model": string_or_none(message.get("model")),
        "stop_reason": string_or_none(message.get("stopReason")),
        "error_message": string_or_none(message.get("errorMessage")),
        "response_id": string_or_none(message.get("responseId")),
        "message_timestamp": message.get("timestamp"),
        "usage": message.get("usage") if isinstance(message.get("usage"), dict) else None,
    }


def snippet(text: str, limit: int) -> str:
    compact = " ".join(text.split())
    if len(compact) <= limit:
        return compact
    return compact[: limit - 3] + "..."


def tool_summary(kind: str, tool: str, arguments: Any) -> str:
    if isinstance(arguments, dict) and arguments:
        args = ", ".join(sorted(str(key) for key in arguments.keys())[:6])
        return f"{kind} {tool} args={args}"
    if arguments not in (None, {}, []):
        return f"{kind} {tool} args={type(arguments).__name__}"
    return f"{kind} {tool}"


def tool_result_summary(tool: str, server: str | None, detail_tool: str | None, is_error: bool) -> str:
    status = "error" if is_error else "ok"
    if server and detail_tool:
        return f"{status} result from {server}.{detail_tool}"
    return f"{status} result from {tool}"


def synchronize_summary(event: dict[str, Any]) -> str:
    if event.get("parse_error"):
        return f"malformed synchronize event: {event['parse_error']}"
    event_type = event.get("event_type") or "event"
    event_id = event.get("event_id")
    body = snippet(str(event.get("body") or ""), 80)
    return f"{event_type} #{event_id}: {body}" if event_id is not None else f"{event_type}: {body}"
