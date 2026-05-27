from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class SessionMetadataEvent:
    path: Path
    session_id: str
    version: int | None
    cwd: str | None
    timestamp: str | None


@dataclass(frozen=True)
class AssistantTextEvent:
    path: Path
    entry_id: str | None
    text: str


@dataclass(frozen=True)
class ToolCallEvent:
    path: Path
    entry_id: str | None
    tool: str
    arguments: Any = None
    source: str = "tool-call"


@dataclass(frozen=True)
class ToolResultEvent:
    path: Path
    entry_id: str | None
    tool: str
    is_error: bool
    details: Any = None


@dataclass(frozen=True)
class SynchronizePushEvent:
    path: Path
    entry_id: str | None
    event_type: str | None
    event_id: int | None
    sender_peer_id: str | None
    recipient_peer_id: str | None
    group_id: str | None
    media_id: str | None
    sent_at: str | None
    body: str


@dataclass(frozen=True)
class ParseDiagnostic:
    path: Path
    line_number: int
    message: str
    raw: str


@dataclass
class PiSessionState:
    path: Path
    metadata: SessionMetadataEvent | None = None
    assistant_texts: list[AssistantTextEvent] = field(default_factory=list)
    tool_calls: list[ToolCallEvent] = field(default_factory=list)
    tool_results: list[ToolResultEvent] = field(default_factory=list)
    synchronize_events: list[SynchronizePushEvent] = field(default_factory=list)
    diagnostics: list[ParseDiagnostic] = field(default_factory=list)
    parsed_lines: int = 0

    def append_event(self, event: object) -> None:
        if isinstance(event, SessionMetadataEvent):
            self.metadata = event
        elif isinstance(event, AssistantTextEvent):
            self.assistant_texts.append(event)
        elif isinstance(event, ToolCallEvent):
            self.tool_calls.append(event)
        elif isinstance(event, ToolResultEvent):
            self.tool_results.append(event)
        elif isinstance(event, SynchronizePushEvent):
            self.synchronize_events.append(event)
        elif isinstance(event, ParseDiagnostic):
            self.diagnostics.append(event)

    def as_summary(self) -> dict[str, Any]:
        return {
            "path": str(self.path),
            "metadata": None if self.metadata is None else self.metadata.__dict__ | {"path": str(self.metadata.path)},
            "assistant_text_count": len(self.assistant_texts),
            "tool_calls": [event.__dict__ | {"path": str(event.path)} for event in self.tool_calls],
            "tool_results": [
                {
                    "path": str(event.path),
                    "entry_id": event.entry_id,
                    "tool": event.tool,
                    "is_error": event.is_error,
                    "details": event.details,
                }
                for event in self.tool_results
            ],
            "synchronize_events": [
                {
                    "path": str(event.path),
                    "entry_id": event.entry_id,
                    "event_type": event.event_type,
                    "event_id": event.event_id,
                    "sender_peer_id": event.sender_peer_id,
                    "recipient_peer_id": event.recipient_peer_id,
                    "group_id": event.group_id,
                    "media_id": event.media_id,
                    "sent_at": event.sent_at,
                    "body": event.body,
                }
                for event in self.synchronize_events
            ],
            "diagnostics": [
                {
                    "path": str(diagnostic.path),
                    "line_number": diagnostic.line_number,
                    "message": diagnostic.message,
                    "raw": diagnostic.raw,
                }
                for diagnostic in self.diagnostics
            ],
            "parsed_lines": self.parsed_lines,
        }
