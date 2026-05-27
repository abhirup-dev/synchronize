from __future__ import annotations

import argparse
import re
import sys
import time
from pathlib import Path
from typing import Any

from .pi_mcp_dm import PiPeer
from .pi_mcp_thread_baton import PiMcpThreadBatonScenario, parse_args
from ..pi_session.watcher import PiSessionWatcherRegistry
from ..queries.pi_session import forbidden_tool_calls, has_assistant_marker, has_pushed_event, has_tool_call
from ..runtime import HarnessError


EVENT_ID_RE = re.compile(r'event_id="(\d+)"')


class PiMcpThreadBatonLogScenario(PiMcpThreadBatonScenario):
    def __init__(self, args: argparse.Namespace, repo: Path) -> None:
        super().__init__(args, repo)
        if args.profile is None:
            self.profile = f"sync-pi-thread-baton-logs-itest-{self.repo.name}-{self.run_id.lower()}"
            self.profile_cleanup_prefix = f"sync-pi-thread-baton-logs-itest-{self.repo.name}-"
            self.aoe.profile = self.profile
        self.session_watchers: PiSessionWatcherRegistry | None = None

    def wait_for_pi_registration(self) -> None:
        deadline = time.time() + self.args.registration_timeout
        last_bindings: list[dict[str, Any]] = []
        while time.time() < deadline:
            try:
                bindings = self.rest.agent_sessions("pi").get("bindings", [])
            except HarnessError:
                bindings = []
            matched_bindings = [
                binding
                for binding in bindings
                if isinstance(binding, dict)
                and str(binding.get("cwd") or "") == str(self.repo)
                and str(binding.get("host_tool") or "") == "pi"
            ]
            last_bindings = matched_bindings
            mapped = self.map_bindings_to_agents(matched_bindings)
            if len(mapped) == len(self.agent_names):
                self.pi_peers = mapped
                self.writer.write_json("pi-peers.json", {name: peer.__dict__ for name, peer in self.pi_peers.items()})
                self.writer.write_json("pi-agent-session-bindings.json", matched_bindings)
                self.session_watchers = PiSessionWatcherRegistry(self.pi_sessions, matched_bindings)
                self.session_watchers.wait_for_agents(self.agent_names, self.args.registration_timeout)
                self.writer.write_json("pi-session-watcher-registration.json", self.session_watchers.summaries())
                return
            time.sleep(1)
        self.tmux.capture_all_panes("registration-timeout", self.agent_panes, lines=700)
        self.writer.write_json("registration-timeout-agent-session-bindings.json", last_bindings)
        raise HarnessError(f"Pi sessions did not auto-register within {self.args.registration_timeout}s")

    def map_bindings_to_agents(self, bindings: list[dict[str, Any]]) -> dict[str, PiPeer]:
        mapped: dict[str, PiPeer] = {}
        for binding in bindings:
            peer = binding.get("peer") if isinstance(binding.get("peer"), dict) else {}
            session_name = str(binding.get("session_name") or peer.get("session_name") or "")
            if session_name not in self.agent_names:
                continue
            host_session_id = str(binding.get("host_session_id") or "")
            peer_id = str(binding.get("peer_id") or "")
            if host_session_id and peer_id:
                mapped[session_name] = PiPeer(name=session_name, peer_id=peer_id, host_session_id=host_session_id)
        return mapped

    def warm_up_pi_agents(self) -> None:
        warmed: list[str] = []
        for name in self.agent_names:
            marker = f"PI_WARM_READY {self.run_id} {name}"
            prompt = (
                "This is a harness liveness check before the real workflow. "
                "Do not use tools. Do not inspect files. Do not send messages. "
                f"Reply exactly: {marker}"
            )
            self.tmux.send_pi_prompt(self.agent_panes[name], prompt)
            self.wait_for_warmup_pane_marker(name, marker, self.args.warmup_timeout, f"warmup-{name}")
            warmed.append(name)
        self.writer.write_json("pi-warmup-agents.json", warmed)
        self.write_watcher_summaries("after-pi-warmup")

    def wait_for_warmup_pane_marker(self, agent_name: str, marker: str, timeout: int, label: str) -> None:
        deadline = time.time() + timeout
        pane = self.agent_panes[agent_name]
        while time.time() < deadline:
            output = self.tmux.capture_pane(pane.pane_id, lines=700)
            if marker in output:
                self.writer.write_text(f"{label}.txt", output)
                return
            time.sleep(1)
        self.tmux.capture_all_panes(f"{label}-timeout", self.agent_panes, lines=700)
        raise HarnessError(f"Pi pane {agent_name} did not produce warmup marker within {timeout}s")

    def wait_for_pane_text(self, agent_name: str, text: str, timeout: int, label: str) -> None:
        event_match = EVENT_ID_RE.search(text)
        if event_match:
            self.wait_for_session_pushed_event(agent_name, int(event_match.group(1)), timeout, label)
            return
        self.wait_for_session_marker(agent_name, text, timeout, label)

    def wait_for_session_marker(self, agent_name: str, marker: str, timeout: int, label: str) -> None:
        registry = self.require_session_watchers()
        state = registry.wait_until(agent_name, lambda current: has_assistant_marker(current, marker), timeout, label)
        self.writer.write_json(f"{label}-session-state.json", state.as_summary())

    def wait_for_session_pushed_event(self, agent_name: str, event_id: int, timeout: int, label: str) -> None:
        registry = self.require_session_watchers()
        state = registry.wait_until(agent_name, lambda current: has_pushed_event(current, event_id=event_id), timeout, label)
        self.writer.write_json(f"{label}-session-state.json", state.as_summary())

    def wait_for_transcript_evidence(self, agent_name: str, needles: list[str], timeout: int) -> bool:
        registry = self.require_session_watchers()
        try:
            state = registry.wait_until(agent_name, lambda current: all(has_tool_call(current, needle) for needle in needles), timeout, "tool-evidence")
        except HarnessError:
            self.write_watcher_summaries("pi-transcript-evidence-missing")
            return False
        self.writer.write_json(f"pi-transcript-evidence-{agent_name}.json", state.as_summary())
        return True

    def assert_no_forbidden_history_calls(self) -> None:
        forbidden = ["bridge_group_history", "bridge_list_groups"]
        registry = self.require_session_watchers()
        registry.refresh()
        seen: dict[str, list[str]] = {}
        for agent_name in self.agent_names:
            calls = forbidden_tool_calls(registry.watcher_for(agent_name).state, forbidden)
            if calls:
                seen[agent_name] = [call.tool for call in calls]
        if seen:
            self.write_watcher_summaries("pi-thread-baton-forbidden-tool-session-state")
            raise HarnessError(f"Thread baton agents used forbidden discovery/history tools: {seen}")

    def collect_diagnostics(self, label: str) -> None:
        super().collect_diagnostics(label)
        self.write_watcher_summaries(label)

    def write_watcher_summaries(self, label: str) -> None:
        if self.session_watchers is None:
            return
        try:
            self.writer.write_json(f"{label}-pi-session-watchers.json", self.session_watchers.summaries())
        except Exception as error:  # noqa: BLE001
            self.writer.write_text(f"{label}-pi-session-watchers-error.txt", str(error))

    def require_session_watchers(self) -> PiSessionWatcherRegistry:
        if self.session_watchers is None:
            raise HarnessError("Pi session watcher registry is not initialized")
        return self.session_watchers


def main(argv: list[str], repo: Path) -> int:
    try:
        PiMcpThreadBatonLogScenario(parse_args(argv), repo).run()
        return 0
    except HarnessError as error:
        print(f"FAIL {error}", file=sys.stderr)
        return 1
