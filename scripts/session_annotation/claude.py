from __future__ import annotations

import csv
import html
import json
import re
import shlex
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


CHANNEL_RE = re.compile(r"<channel\s+(?P<attrs>[^>]*)>(?P<body>.*?)</channel>", re.DOTALL)
SYNC_EVENT_RE = re.compile(r"<synchronize_event\s+(?P<attrs>[^>]*)>(?P<body>.*?)</synchronize_event>", re.DOTALL)

SHELL_TOOLS = {"Bash", "Shell", "Terminal"}
FILESYSTEM_TOOLS = {"Read", "Write", "Edit", "MultiEdit", "Glob", "Grep", "LS", "NotebookEdit"}
WEB_TOOLS = {"WebFetch", "WebSearch", "web_search", "web_fetch"}
TASK_TOOLS = {"Task", "TaskCreate", "TaskUpdate", "TaskList", "TaskGet", "TaskOutput", "TaskStop", "ToolSearch"}


@dataclass(frozen=True)
class Annotation:
    path: Path
    line_number: int
    sequence: int
    category: str
    kind: str
    record_type: str | None
    session_id: str | None = None
    uuid: str | None = None
    parent_uuid: str | None = None
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
            "session_id": self.session_id,
            "uuid": self.uuid,
            "parent_uuid": self.parent_uuid,
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


@dataclass(frozen=True)
class Diagnostic:
    path: Path
    line_number: int
    message: str
    raw: str


@dataclass
class AnnotationReport:
    path: Path
    annotations: list[Annotation] = field(default_factory=list)
    diagnostics: list[Diagnostic] = field(default_factory=list)
    parsed_lines: int = 0

    def summary(self) -> dict[str, Any]:
        by_category = Counter(annotation.category for annotation in self.annotations)
        by_kind = Counter(annotation.kind for annotation in self.annotations)
        by_record_type = Counter(annotation.record_type for annotation in self.annotations if annotation.record_type)
        by_tool = Counter(annotation.normalized_tool or annotation.tool for annotation in self.annotations if annotation.tool or annotation.normalized_tool)
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
class _Context:
    path: Path
    line_number: int
    sequence_start: int
    record_type: str | None
    session_id: str | None
    uuid: str | None
    parent_uuid: str | None
    timestamp: str | None


class ClaudeSessionAnnotator:
    def __init__(self, *, include_text: bool = False) -> None:
        self.include_text = include_text
        self.tool_names_by_id: dict[str, str] = {}

    def annotate_file(self, path: Path) -> AnnotationReport:
        report = AnnotationReport(path=path)
        sequence = 0
        with path.open(encoding="utf-8", errors="replace") as handle:
            for line_number, line in enumerate(handle, 1):
                if not line.strip():
                    continue
                report.parsed_lines += 1
                try:
                    record = json.loads(line)
                except json.JSONDecodeError as error:
                    report.diagnostics.append(Diagnostic(path=path, line_number=line_number, message=f"JSON parse error: {error.msg}", raw=line.rstrip("\n")))
                    continue
                if not isinstance(record, dict):
                    report.diagnostics.append(Diagnostic(path=path, line_number=line_number, message="JSONL entry is not an object", raw=line.rstrip("\n")))
                    continue
                annotations = self.annotate_record(record, path, line_number, sequence)
                report.annotations.extend(annotations)
                sequence += len(annotations)
        return report

    def annotate_record(self, record: dict[str, Any], path: Path, line_number: int, sequence_start: int = 0) -> list[Annotation]:
        context = _Context(
            path=path,
            line_number=line_number,
            sequence_start=sequence_start,
            record_type=string_or_none(record.get("type")),
            session_id=string_or_none(record.get("sessionId")),
            uuid=string_or_none(record.get("uuid")),
            parent_uuid=string_or_none(record.get("parentUuid")),
            timestamp=string_or_none(record.get("timestamp")),
        )
        builder = _Builder(context, include_text=self.include_text)
        record_type = context.record_type

        if record_type in {"agent-setting", "agent-name", "custom-title", "permission-mode", "mode", "last-prompt", "worktree-state"}:
            annotate_state_record(record, builder)
        elif record_type == "file-history-snapshot":
            builder.add(category="runtime", kind="file_history_snapshot", summary="file history snapshot", data={"is_snapshot_update": record.get("isSnapshotUpdate")})
        elif record_type == "queue-operation":
            builder.add(category="runtime", kind="queue_operation", summary=f"queue {record.get('operation')}", data={"operation": record.get("operation")})
        elif record_type == "attachment":
            annotate_attachment(record, builder)
        elif record_type == "system":
            annotate_system(record, builder)
        elif record_type in {"assistant", "user"}:
            annotate_message_record(record, builder, self.tool_names_by_id)
        else:
            builder.add(category="unknown", kind="unknown_record", summary=f"unclassified record type {record_type!r}", data={"keys": sorted(str(key) for key in record.keys())})

        return builder.annotations


def annotate_state_record(record: dict[str, Any], builder: "_Builder") -> None:
    record_type = string_or_none(record.get("type")) or "state"
    keys = {
        "agent-setting": ("agent_setting", "agentSetting"),
        "agent-name": ("agent_name", "agentName"),
        "custom-title": ("custom_title", "customTitle"),
        "permission-mode": ("permission_mode", "permissionMode"),
        "mode": ("mode", "mode"),
        "last-prompt": ("last_prompt", "leafUuid"),
        "worktree-state": ("worktree_state", "worktreeSession"),
    }
    kind, value_key = keys[record_type]
    value = record.get(value_key)
    builder.add(category="session", kind=kind, summary=f"{kind}: {snippet(json.dumps(value, default=str), 120)}", data={value_key: value})


def annotate_attachment(record: dict[str, Any], builder: "_Builder") -> None:
    attachment = record.get("attachment") if isinstance(record.get("attachment"), dict) else {}
    attachment_type = string_or_none(attachment.get("type")) or "unknown"
    builder.add(
        category="attachment",
        kind=f"attachment_{attachment_type}",
        summary=attachment_summary(attachment),
        data={"attachment_type": attachment_type, "keys": sorted(str(key) for key in attachment.keys())},
    )

    if attachment_type == "queued_command":
        prompt = string_or_none(attachment.get("prompt")) or ""
        for channel in parse_channel_envelopes(prompt):
            builder.add(
                category="synchronize",
                kind="synchronize_channel",
                source="attachment.queued_command",
                summary=channel_summary(channel),
                text=channel.get("body") if builder.include_text else None,
                data=without_body(channel),
            )
    elif attachment_type == "hook_success":
        for text in attachment_texts(attachment):
            annotate_embedded_synchronize(text, builder, source="attachment.hook_success")
    elif attachment_type == "deferred_tools_delta":
        added = attachment.get("addedNames") if isinstance(attachment.get("addedNames"), list) else []
        removed = attachment.get("removedNames") if isinstance(attachment.get("removedNames"), list) else []
        for tool in added:
            if isinstance(tool, str):
                classified = classify_tool(tool)
                builder.add(
                    category=classified["category"],
                    kind="tool_available",
                    tool=tool,
                    normalized_tool=classified["normalized_tool"],
                    tool_server=classified["server"],
                    source="attachment.deferred_tools_delta",
                    summary=f"tool available {tool}",
                )
        if removed:
            builder.add(category="tool", kind="tools_removed", source="attachment.deferred_tools_delta", summary=f"{len(removed)} tools removed", data={"removed": removed})


def annotate_system(record: dict[str, Any], builder: "_Builder") -> None:
    subtype = string_or_none(record.get("subtype")) or "system"
    builder.add(
        category="system",
        kind=f"system_{subtype}",
        summary=system_summary(record),
        data={
            "hook_count": record.get("hookCount"),
            "prevented_continuation": record.get("preventedContinuation"),
            "stop_reason": record.get("stopReason"),
            "level": record.get("level"),
            "tool_use_id": record.get("toolUseID"),
        },
    )


def annotate_message_record(record: dict[str, Any], builder: "_Builder", tool_names_by_id: dict[str, str]) -> None:
    message = record.get("message") if isinstance(record.get("message"), dict) else {}
    role = string_or_none(message.get("role")) or string_or_none(record.get("type"))
    content = message.get("content")
    content_items = content if isinstance(content, list) else [content] if isinstance(content, str) else []
    builder.add(
        category="message",
        kind=f"{role or 'unknown'}_message",
        role=role,
        summary=message_summary(message, content_items),
        data=message_metadata(record, message),
    )
    for index, item in enumerate(content_items):
        if isinstance(item, str):
            annotate_text(item, index, role, builder)
        elif isinstance(item, dict):
            annotate_content_block(item, index, role, builder, tool_names_by_id)
        else:
            builder.add(category="unknown", kind="unknown_content_block", role=role, content_index=index, summary=f"unclassified content block {type(item).__name__}")

    for text in record_level_texts(record):
        annotate_embedded_synchronize(text, builder, source="record")


def annotate_content_block(item: dict[str, Any], index: int, role: str | None, builder: "_Builder", tool_names_by_id: dict[str, str]) -> None:
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
            data={"has_signature": bool(item.get("signature"))},
        )
    elif block_type == "tool_use":
        tool = string_or_none(item.get("name")) or ""
        tool_id = string_or_none(item.get("id"))
        if tool_id and tool:
            tool_names_by_id[tool_id] = tool
        classified = classify_tool(tool)
        builder.add(
            category=classified["category"],
            kind=classified["kind"],
            role=role,
            content_index=index,
            tool=tool,
            normalized_tool=classified["normalized_tool"],
            tool_call_id=tool_id,
            tool_server=classified["server"],
            source="content.tool_use",
            summary=tool_summary(classified["kind"], tool, item.get("input")),
            data={"input": item.get("input"), "caller": item.get("caller")},
        )
    elif block_type == "tool_result":
        tool_id = string_or_none(item.get("tool_use_id"))
        tool = tool_names_by_id.get(tool_id or "", "")
        classified = classify_tool(tool)
        builder.add(
            category="mcp" if classified["category"] == "mcp" else "tool",
            kind="mcp_tool_result" if classified["category"] == "mcp" else "tool_result",
            role=role,
            content_index=index,
            tool=tool or None,
            normalized_tool=classified["normalized_tool"],
            tool_call_id=tool_id,
            tool_server=classified["server"],
            source="content.tool_result",
            is_error=bool(item.get("is_error")),
            summary=tool_result_summary(tool, bool(item.get("is_error")), item.get("content")),
            text=string_or_none(item.get("content")) if builder.include_text else None,
            data={"content_type": type(item.get("content")).__name__},
        )
        if isinstance(item.get("content"), str):
            annotate_embedded_synchronize(item["content"], builder, source="content.tool_result")
    elif block_type == "server_tool_use":
        tool = string_or_none(item.get("name")) or string_or_none(item.get("tool_name")) or "server_tool"
        classified = classify_tool(tool)
        builder.add(
            category="tool",
            kind="server_tool_use",
            role=role,
            content_index=index,
            tool=tool,
            normalized_tool=classified["normalized_tool"],
            tool_call_id=string_or_none(item.get("id")),
            source="content.server_tool_use",
            summary=tool_summary("server_tool_use", tool, item.get("input")),
            data={"input": item.get("input")},
        )
    elif block_type == "advisor_tool_result":
        content = item.get("content") if isinstance(item.get("content"), dict) else {}
        builder.add(
            category="assistant",
            kind="advisor_tool_result",
            role=role,
            content_index=index,
            tool_call_id=string_or_none(item.get("tool_use_id")),
            source="content.advisor_tool_result",
            summary=snippet(string_or_none(content.get("text")) or "advisor result", 160),
            text=string_or_none(content.get("text")) if builder.include_text else None,
            data={"content_type": content.get("type")},
        )
    elif block_type == "image":
        builder.add(category="message", kind="image_block", role=role, content_index=index, summary="image block", data={"keys": sorted(str(key) for key in item.keys())})
    else:
        builder.add(category="unknown", kind="unknown_content_block", role=role, content_index=index, summary=f"unclassified content block type {block_type!r}", data={"keys": sorted(str(key) for key in item.keys())})


def annotate_text(text: str, index: int | None, role: str | None, builder: "_Builder") -> None:
    annotate_embedded_synchronize(text, builder, source="content.text")
    category = "assistant" if role == "assistant" else "user" if role == "user" else "message"
    builder.add(
        category=category,
        kind=f"{role or 'message'}_text",
        role=role,
        content_index=index,
        summary=snippet(text, 160),
        text=text if builder.include_text else None,
    )


def annotate_embedded_synchronize(text: str, builder: "_Builder", *, source: str) -> None:
    for event in parse_channel_envelopes(text):
        builder.add(category="synchronize", kind="synchronize_channel", source=source, summary=channel_summary(event), text=event.get("body") if builder.include_text else None, data=without_body(event))
    for event in parse_synchronize_events(text):
        builder.add(category="synchronize", kind="synchronize_event", source=source, summary=sync_event_summary(event), text=event.get("body") if builder.include_text else None, data=without_body(event))


def classify_tool(tool: str) -> dict[str, str | None]:
    if not tool:
        return {"category": "tool", "kind": "tool_result", "normalized_tool": None, "server": None}
    if tool.startswith("mcp__"):
        parts = tool.split("__", 2)
        server = parts[1] if len(parts) > 1 else None
        normalized = parts[2] if len(parts) > 2 else tool
        kind = "synchronize_mcp_tool_call" if server == "synchronize" else "mcp_tool_call"
        return {"category": "mcp", "kind": kind, "normalized_tool": normalized, "server": server}
    if tool in SHELL_TOOLS:
        return {"category": "tool", "kind": "shell_tool_call", "normalized_tool": tool, "server": None}
    if tool in FILESYSTEM_TOOLS:
        return {"category": "tool", "kind": "filesystem_tool_call", "normalized_tool": tool, "server": None}
    if tool in WEB_TOOLS:
        return {"category": "tool", "kind": "web_tool_call", "normalized_tool": tool, "server": None}
    if tool in TASK_TOOLS:
        return {"category": "tool", "kind": "agent_tool_call", "normalized_tool": tool, "server": None}
    return {"category": "tool", "kind": "tool_call", "normalized_tool": tool, "server": None}


def parse_channel_envelopes(text: str) -> list[dict[str, Any]]:
    return [event for match in CHANNEL_RE.finditer(text) if (event := parse_envelope(match, "channel")) is not None]


def parse_synchronize_events(text: str) -> list[dict[str, Any]]:
    return [event for match in SYNC_EVENT_RE.finditer(text) if (event := parse_envelope(match, "synchronize_event")) is not None]


def parse_envelope(match: re.Match[str], envelope_kind: str) -> dict[str, Any] | None:
    attrs = parse_attrs(match.group("attrs"))
    if not is_event_like(attrs):
        return None
    body = html.unescape(match.group("body")).strip()
    return {
        "envelope_kind": envelope_kind,
        "source": attrs.get("source"),
        "event_type": attrs.get("type"),
        "event_id": parse_int(attrs.get("event_id")),
        "sender_peer_id": attrs.get("sender_peer_id") or attrs.get("from") or attrs.get("from_id"),
        "recipient_peer_id": attrs.get("recipient_peer_id") or attrs.get("to"),
        "group_id": attrs.get("group_id"),
        "media_id": attrs.get("media_id"),
        "sent_at": attrs.get("sent_at"),
        "body": body,
    }


def is_event_like(attrs: dict[str, str]) -> bool:
    event_keys = {
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
    }
    return any(key in attrs for key in event_keys)


def parse_attrs(text: str) -> dict[str, str]:
    attrs: dict[str, str] = {}
    try:
        tokens = shlex.split(text)
    except ValueError:
        tokens = text.split()
    for token in tokens:
        if "=" not in token:
            continue
        key, value = token.split("=", 1)
        attrs[key] = value.strip("\"'")
    return attrs


class _Builder:
    def __init__(self, context: _Context, *, include_text: bool) -> None:
        self.context = context
        self.include_text = include_text
        self.annotations: list[Annotation] = []

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
            Annotation(
                path=self.context.path,
                line_number=self.context.line_number,
                sequence=self.context.sequence_start + len(self.annotations),
                category=category,
                kind=kind,
                record_type=self.context.record_type,
                session_id=self.context.session_id,
                uuid=self.context.uuid,
                parent_uuid=self.context.parent_uuid,
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


def write_csv(report: AnnotationReport, path: Path) -> None:
    fields = [
        "sequence",
        "line_number",
        "timestamp",
        "session_id",
        "record_type",
        "category",
        "kind",
        "role",
        "uuid",
        "parent_uuid",
        "content_index",
        "tool_server",
        "tool",
        "normalized_tool",
        "tool_call_id",
        "source",
        "is_error",
        "summary",
        "data",
    ]
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for annotation in report.annotations:
            row = annotation.to_json()
            flat = {field: row.get(field, "") for field in fields}
            if isinstance(flat.get("data"), (dict, list)):
                flat["data"] = json.dumps(flat["data"], sort_keys=True)
            writer.writerow(flat)


def string_or_none(value: Any) -> str | None:
    return value if isinstance(value, str) else None


def parse_int(value: str | None) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except ValueError:
        return None


def snippet(value: str, limit: int) -> str:
    compact = " ".join(value.split())
    if len(compact) <= limit:
        return compact
    return compact[: limit - 3] + "..."


def without_body(event: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in event.items() if key != "body"}


def attachment_texts(attachment: dict[str, Any]) -> list[str]:
    texts: list[str] = []
    for key in ("content", "stdout", "stderr", "prompt"):
        value = attachment.get(key)
        if isinstance(value, str):
            texts.append(value)
    return texts


def record_level_texts(record: dict[str, Any]) -> list[str]:
    texts: list[str] = []
    for key in ("toolUseResult",):
        value = record.get(key)
        if isinstance(value, str):
            texts.append(value)
    return texts


def attachment_summary(attachment: dict[str, Any]) -> str:
    kind = string_or_none(attachment.get("type")) or "unknown"
    if kind == "queued_command":
        origin = attachment.get("origin") if isinstance(attachment.get("origin"), dict) else {}
        return f"queued command from {origin.get('server') or origin.get('kind') or 'unknown'}"
    if kind == "hook_success":
        return f"hook success {attachment.get('hookName') or attachment.get('hookEvent') or ''}".strip()
    if kind == "deferred_tools_delta":
        added = attachment.get("addedNames") if isinstance(attachment.get("addedNames"), list) else []
        removed = attachment.get("removedNames") if isinstance(attachment.get("removedNames"), list) else []
        return f"deferred tools delta +{len(added)} -{len(removed)}"
    return f"attachment {kind}"


def system_summary(record: dict[str, Any]) -> str:
    subtype = string_or_none(record.get("subtype")) or "system"
    if subtype == "stop_hook_summary":
        return f"stop hook summary: {record.get('hookCount') or 0} hooks"
    return subtype


def message_summary(message: dict[str, Any], content_items: list[Any]) -> str:
    role = string_or_none(message.get("role")) or "unknown"
    stop = string_or_none(message.get("stop_reason"))
    suffix = f", stop={stop}" if stop else ""
    return f"{role} message with {len(content_items)} content block(s){suffix}"


def message_metadata(record: dict[str, Any], message: dict[str, Any]) -> dict[str, Any]:
    return {
        "message_id": string_or_none(message.get("id")),
        "model": string_or_none(message.get("model")),
        "request_id": string_or_none(record.get("requestId")),
        "advisor_model": string_or_none(record.get("advisorModel")),
        "session_kind": string_or_none(record.get("sessionKind")),
        "user_type": string_or_none(record.get("userType")),
        "entrypoint": string_or_none(record.get("entrypoint")),
        "cwd": string_or_none(record.get("cwd")),
        "git_branch": string_or_none(record.get("gitBranch")),
        "stop_reason": string_or_none(message.get("stop_reason")),
        "usage": message.get("usage") if isinstance(message.get("usage"), dict) else None,
        "attribution_mcp_server": string_or_none(record.get("attributionMcpServer")),
        "attribution_mcp_tool": string_or_none(record.get("attributionMcpTool")),
    }


def tool_summary(kind: str, tool: str, inputs: Any) -> str:
    if isinstance(inputs, dict) and inputs:
        return f"{kind} {tool} args={', '.join(sorted(str(key) for key in inputs.keys())[:6])}"
    return f"{kind} {tool}".strip()


def tool_result_summary(tool: str, is_error: bool, content: Any) -> str:
    status = "error" if is_error else "ok"
    if tool:
        return f"{status} result from {tool}: {snippet(str(content), 100)}"
    return f"{status} tool result: {snippet(str(content), 100)}"


def channel_summary(event: dict[str, Any]) -> str:
    event_type = event.get("event_type") or "event"
    event_id = event.get("event_id")
    body = snippet(str(event.get("body") or ""), 80)
    return f"{event_type} #{event_id}: {body}" if event_id is not None else f"{event_type}: {body}"


def sync_event_summary(event: dict[str, Any]) -> str:
    return channel_summary(event)
