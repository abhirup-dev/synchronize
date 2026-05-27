from __future__ import annotations

import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

from ..utils.records import nested_string_values, parse_int, string_or_none
from .state import (
    AssistantTextEvent,
    SessionMetadataEvent,
    SynchronizePushEvent,
    ToolCallEvent,
    ToolResultEvent,
)


SYNC_EVENT_OPEN = "<synchronize_event"
SYNC_EVENT_CLOSE = "</synchronize_event>"


def extract_session_events(record: dict[str, Any], path: Path) -> list[object]:
    entry_id = string_or_none(record.get("id"))
    events: list[object] = []
    if record.get("type") == "session":
        events.append(session_metadata_event(record, path))

    message = record.get("message") if isinstance(record.get("message"), dict) else None
    if message is not None:
        events.extend(message_events(message, path, entry_id))

    for text in record_level_texts(record):
        events.extend(parse_synchronize_events(text, path, entry_id))
    return events


def session_metadata_event(record: dict[str, Any], path: Path) -> SessionMetadataEvent:
    version = record.get("version")
    return SessionMetadataEvent(
        path=path,
        session_id=str(record.get("id") or ""),
        version=version if isinstance(version, int) else None,
        cwd=string_or_none(record.get("cwd")),
        timestamp=string_or_none(record.get("timestamp")),
    )


def message_events(message: dict[str, Any], path: Path, entry_id: str | None) -> list[object]:
    role = string_or_none(message.get("role"))
    content = message.get("content")
    events: list[object] = []

    if role == "assistant":
        events.extend(AssistantTextEvent(path=path, entry_id=entry_id, text=text) for text in text_blocks(content))
        events.extend(
            ToolCallEvent(
                path=path,
                entry_id=entry_id,
                tool=call["tool"],
                arguments=call.get("arguments"),
                source="assistant-tool-call",
            )
            for call in tool_call_blocks(content)
        )
    elif role == "toolResult":
        events.append(
            ToolResultEvent(
                path=path,
                entry_id=entry_id,
                tool=string_or_none(message.get("toolName")) or "",
                is_error=bool(message.get("isError")),
                details=message.get("details"),
            )
        )

    details = message.get("details") if isinstance(message.get("details"), dict) else None
    tool = string_or_none(details.get("tool")) if details and details.get("mode") == "call" else None
    if tool:
        events.append(
            ToolCallEvent(
                path=path,
                entry_id=entry_id,
                tool=tool,
                arguments=details.get("arguments") or details.get("input"),
                source="observed-details",
            )
        )

    for text in text_blocks(content):
        events.extend(parse_synchronize_events(text, path, entry_id))
    return events


def text_blocks(content: Any) -> list[str]:
    if isinstance(content, str):
        return [content]
    if not isinstance(content, list):
        return []
    texts: list[str] = []
    for item in content:
        if isinstance(item, str):
            texts.append(item)
        elif isinstance(item, dict) and item.get("type") == "text" and isinstance(item.get("text"), str):
            texts.append(item["text"])
    return texts


def tool_call_blocks(content: Any) -> list[dict[str, Any]]:
    if not isinstance(content, list):
        return []
    calls: list[dict[str, Any]] = []
    for item in content:
        if not isinstance(item, dict) or item.get("type") != "toolCall":
            continue
        name = string_or_none(item.get("name"))
        if name:
            calls.append({"tool": name, "arguments": item.get("arguments")})
    return calls


def record_level_texts(record: dict[str, Any]) -> list[str]:
    texts: list[str] = []
    for key in ("content", "data"):
        value = record.get(key)
        if isinstance(value, str):
            texts.append(value)
        elif isinstance(value, dict):
            texts.extend(nested_string_values(value))
    return texts


def parse_synchronize_events(text: str, path: Path, entry_id: str | None) -> list[SynchronizePushEvent]:
    events: list[SynchronizePushEvent] = []
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
        except ET.ParseError:
            continue
        events.append(
            SynchronizePushEvent(
                path=path,
                entry_id=entry_id,
                event_type=root.attrib.get("type"),
                event_id=parse_int(root.attrib.get("event_id")),
                sender_peer_id=root.attrib.get("from"),
                recipient_peer_id=root.attrib.get("to"),
                group_id=root.attrib.get("group_id"),
                media_id=root.attrib.get("media_id"),
                sent_at=root.attrib.get("sent_at"),
                body=(root.text or "").strip(),
            )
        )
