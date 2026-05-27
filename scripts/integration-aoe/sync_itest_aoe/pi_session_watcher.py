from __future__ import annotations

import json
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from .pi_session_events import (
    AssistantTextEvent,
    ParseDiagnostic,
    PiSessionState,
    SessionMetadataEvent,
    SynchronizePushEvent,
    ToolCallEvent,
    ToolResultEvent,
)
from .runtime import HarnessError


SYNC_EVENT_OPEN = "<synchronize_event"
SYNC_EVENT_CLOSE = "</synchronize_event>"


class PiSessionWatcher:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.state = PiSessionState(path=path)
        self._offset = 0
        self._pending = ""

    def refresh(self) -> PiSessionState:
        if not self.path.exists():
            return self.state
        with self.path.open("r", encoding="utf-8", errors="replace") as handle:
            handle.seek(self._offset)
            chunk = handle.read()
            self._offset = handle.tell()
        if not chunk:
            return self.state
        text = self._pending + chunk
        lines = text.splitlines(keepends=True)
        self._pending = ""
        if lines and not lines[-1].endswith(("\n", "\r")):
            self._pending = lines.pop()
        for line in lines:
            self._parse_line(line.rstrip("\r\n"))
        return self.state

    def _parse_line(self, line: str) -> None:
        if not line.strip():
            return
        self.state.parsed_lines += 1
        try:
            record = json.loads(line)
        except json.JSONDecodeError as error:
            self.state.append_event(
                ParseDiagnostic(
                    path=self.path,
                    line_number=self.state.parsed_lines,
                    message=f"JSON parse error: {error.msg}",
                    raw=line,
                )
            )
            return
        if not isinstance(record, dict):
            self.state.append_event(
                ParseDiagnostic(
                    path=self.path,
                    line_number=self.state.parsed_lines,
                    message="JSONL entry is not an object",
                    raw=line,
                )
            )
            return
        for event in extract_session_events(record, self.path):
            self.state.append_event(event)


class PiSessionWatcherRegistry:
    def __init__(self, session_dir: Path, bindings: list[dict[str, Any]]) -> None:
        self.session_dir = session_dir
        self.bindings = bindings
        self.watchers_by_agent: dict[str, PiSessionWatcher] = {}

    def refresh_bindings(self, bindings: list[dict[str, Any]]) -> None:
        self.bindings = bindings

    def refresh(self) -> None:
        self.rebind_missing_files()
        for watcher in self.watchers_by_agent.values():
            watcher.refresh()

    def bind_available_watchers(self, agent_names: list[str]) -> None:
        candidates = discover_session_files(self.session_dir)
        headers = {path: read_session_header(path) for path in candidates}
        for agent_name in agent_names:
            if agent_name in self.watchers_by_agent:
                continue
            binding = next((item for item in self.bindings if binding_session_name(item) == agent_name), None)
            if not binding:
                continue
            host_session_id = str(binding.get("host_session_id") or "")
            if not host_session_id:
                continue
            path = match_session_file(host_session_id, candidates, headers) or expected_session_file(self.session_dir, host_session_id)
            watcher = PiSessionWatcher(path)
            watcher.refresh()
            self.watchers_by_agent[agent_name] = watcher

    def watcher_for(self, agent_name: str) -> PiSessionWatcher:
        try:
            return self.watchers_by_agent[agent_name]
        except KeyError as error:
            raise HarnessError(f"No Pi session watcher is registered for agent {agent_name}") from error

    def rebind_missing_files(self) -> None:
        missing = [agent_name for agent_name, watcher in self.watchers_by_agent.items() if not watcher.path.exists()]
        if not missing:
            return
        candidates = discover_session_files(self.session_dir)
        headers = {path: read_session_header(path) for path in candidates}
        for agent_name in missing:
            binding = next((item for item in self.bindings if binding_session_name(item) == agent_name), None)
            if binding is None:
                continue
            host_session_id = str(binding.get("host_session_id") or "")
            path = match_session_file(host_session_id, candidates, headers)
            if path is None:
                continue
            watcher = PiSessionWatcher(path)
            watcher.refresh()
            self.watchers_by_agent[agent_name] = watcher

    def wait_for_agents(self, agent_names: list[str], timeout: int) -> None:
        deadline = time.time() + timeout
        while time.time() < deadline:
            self.bind_available_watchers(agent_names)
            if all(agent_name in self.watchers_by_agent for agent_name in agent_names):
                return
            time.sleep(1)
        missing = [agent_name for agent_name in agent_names if agent_name not in self.watchers_by_agent]
        raise HarnessError(f"Timed out waiting for Pi session log watcher(s): {', '.join(missing)}")

    def wait_until(self, agent_name: str, predicate: Callable[[PiSessionState], bool], timeout: int, label: str) -> PiSessionState:
        deadline = time.time() + timeout
        while time.time() < deadline:
            self.refresh()
            state = self.watcher_for(agent_name).state
            if predicate(state):
                return state
            time.sleep(1)
        self.refresh()
        state = self.watcher_for(agent_name).state
        raise HarnessError(f"Timed out waiting for Pi session state condition {label} on {agent_name}: {state.as_summary()}")

    def summaries(self) -> dict[str, dict[str, Any]]:
        self.refresh()
        return {agent_name: watcher.state.as_summary() for agent_name, watcher in self.watchers_by_agent.items()}


def discover_session_files(session_dir: Path) -> list[Path]:
    if not session_dir.exists():
        return []
    return sorted(session_dir.rglob("*.jsonl"))


def read_session_header(path: Path) -> dict[str, Any] | None:
    try:
        with path.open("r", encoding="utf-8", errors="replace") as handle:
            for line in handle:
                if not line.strip():
                    continue
                record = json.loads(line)
                return record if isinstance(record, dict) and record.get("type") == "session" else None
    except (OSError, json.JSONDecodeError):
        return None
    return None


def match_session_file(host_session_id: str, candidates: list[Path], headers: dict[Path, dict[str, Any] | None]) -> Path | None:
    for path, header in headers.items():
        if header and str(header.get("id") or "") == host_session_id:
            return path
    for path in candidates:
        if host_session_id in path.name:
            return path
    return None


def expected_session_file(session_dir: Path, host_session_id: str) -> Path:
    return session_dir / f"{host_session_id}.jsonl"


def binding_session_name(binding: dict[str, Any]) -> str:
    peer = binding.get("peer") if isinstance(binding.get("peer"), dict) else {}
    return str(binding.get("session_name") or peer.get("session_name") or "")


def extract_session_events(record: dict[str, Any], path: Path) -> list[object]:
    entry_id = string_or_none(record.get("id"))
    record_type = string_or_none(record.get("type"))
    events: list[object] = []
    if record_type == "session":
        version = record.get("version")
        events.append(
            SessionMetadataEvent(
                path=path,
                session_id=str(record.get("id") or ""),
                version=version if isinstance(version, int) else None,
                cwd=string_or_none(record.get("cwd")),
                timestamp=string_or_none(record.get("timestamp")),
            )
        )

    message = record.get("message") if isinstance(record.get("message"), dict) else None
    if message is not None:
        role = string_or_none(message.get("role"))
        content = message.get("content")
        if role == "assistant":
            for text in extract_text_blocks(content):
                events.append(AssistantTextEvent(path=path, entry_id=entry_id, text=text))
            for call in extract_tool_call_blocks(content):
                events.append(
                    ToolCallEvent(
                        path=path,
                        entry_id=entry_id,
                        tool=call["tool"],
                        arguments=call.get("arguments"),
                        source="assistant-tool-call",
                    )
                )
        if role == "toolResult":
            tool_name = string_or_none(message.get("toolName")) or ""
            events.append(
                ToolResultEvent(
                    path=path,
                    entry_id=entry_id,
                    tool=tool_name,
                    is_error=bool(message.get("isError")),
                    details=message.get("details"),
                )
            )
        details = message.get("details") if isinstance(message.get("details"), dict) else None
        if details and details.get("mode") == "call":
            tool = string_or_none(details.get("tool")) or ""
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
        for text in extract_text_blocks(content):
            events.extend(parse_synchronize_events(text, path, entry_id))

    for text in record_level_texts(record):
        events.extend(parse_synchronize_events(text, path, entry_id))
    return events


def extract_text_blocks(content: Any) -> list[str]:
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


def extract_tool_call_blocks(content: Any) -> list[dict[str, Any]]:
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
            texts.extend(string_values(value))
    return texts


def string_values(value: dict[str, Any]) -> list[str]:
    result: list[str] = []
    for item in value.values():
        if isinstance(item, str):
            result.append(item)
        elif isinstance(item, dict):
            result.extend(string_values(item))
        elif isinstance(item, list):
            for child in item:
                if isinstance(child, str):
                    result.append(child)
                elif isinstance(child, dict):
                    result.extend(string_values(child))
    return result


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
        try:
            root = ET.fromstring(raw)
        except ET.ParseError:
            start = end_index
            continue
        event_id = parse_int(root.attrib.get("event_id"))
        events.append(
            SynchronizePushEvent(
                path=path,
                entry_id=entry_id,
                event_type=root.attrib.get("type"),
                event_id=event_id,
                sender_peer_id=root.attrib.get("from"),
                recipient_peer_id=root.attrib.get("to"),
                group_id=root.attrib.get("group_id"),
                media_id=root.attrib.get("media_id"),
                sent_at=root.attrib.get("sent_at"),
                body=(root.text or "").strip(),
            )
        )
        start = end_index


def parse_int(value: str | None) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except ValueError:
        return None


def string_or_none(value: Any) -> str | None:
    return value if isinstance(value, str) else None
