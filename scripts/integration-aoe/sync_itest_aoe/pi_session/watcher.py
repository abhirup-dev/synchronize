from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Callable

from ..runtime import HarnessError
from ..utils.jsonl import JsonlTail, read_first_json_object
from .parser import extract_session_events
from .state import ParseDiagnostic, PiSessionState


class PiSessionWatcher:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.state = PiSessionState(path=path)
        self._tail = JsonlTail(path)

    def refresh(self) -> PiSessionState:
        for line in self._tail.read_complete_lines():
            self._parse_line(line)
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
    record = read_first_json_object(path)
    return record if record and record.get("type") == "session" else None


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
