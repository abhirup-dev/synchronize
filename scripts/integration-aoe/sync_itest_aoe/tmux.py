from __future__ import annotations

import re
import time
from dataclasses import dataclass
from typing import Any

try:
    import libtmux
except ModuleNotFoundError:  # pragma: no cover - normal path is uv-installed dependency
    libtmux = None  # type: ignore[assignment]

from .runtime import ArtifactWriter, CommandRunner, HarnessError, slice_marker_output

MARKER_PREFIX = "__SYNC_ITEST"


@dataclass(frozen=True)
class AgentPane:
    name: str
    pane_id: str
    tmux_session: str
    tmux_window: str


def require_libtmux(script_name: str) -> None:
    if libtmux is None:
        raise HarnessError(f"Python dependency 'libtmux' is missing. Run through `uv run {script_name}`.")


class TmuxController:
    def __init__(self, runner: CommandRunner, writer: ArtifactWriter) -> None:
        self.runner = runner
        self.writer = writer

    def list_panes(self) -> list[dict[str, Any]]:
        if libtmux is None:
            raise HarnessError("Python dependency 'libtmux' is missing")
        server = libtmux.Server()
        panes: list[dict[str, Any]] = []
        for session in server.sessions:
            for window in session.windows:
                for pane in window.panes:
                    panes.append(
                        {
                            "session": session.session_name,
                            "window": window.window_id,
                            "pane": pane.pane_id,
                            "command": pane.pane_current_command,
                            "path": pane.pane_current_path,
                        }
                    )
        self.writer.write_json("tmux-panes.json", panes)
        return panes

    def map_agent_panes(self, agent_names: list[str], aoe_session_ids: dict[str, str] | None = None) -> dict[str, AgentPane]:
        raw_panes = self.list_panes()
        mapped: dict[str, AgentPane] = {}
        for name in agent_names:
            match = find_pane_for_agent(name, raw_panes, aoe_session_ids or {})
            if not match:
                raise HarnessError(f"Could not map AoE session '{name}' to a tmux pane; see tmux-panes.json")
            mapped[name] = AgentPane(
                name=name,
                pane_id=str(match["pane"]),
                tmux_session=str(match["session"]),
                tmux_window=str(match["window"]),
            )
        self.writer.write_json("agent-panes.json", {name: pane.__dict__ for name, pane in mapped.items()})
        return mapped

    def capture_pane(self, pane_id: str, lines: int) -> str:
        result = self.runner.run(["tmux", "capture-pane", "-p", "-S", f"-{lines}", "-t", pane_id], check=False)
        return result.stdout

    def capture_all_panes(self, label: str, panes: dict[str, AgentPane], lines: int) -> None:
        for name, pane in panes.items():
            self.writer.write_text(f"{label}-pane-{name}.txt", self.capture_pane(pane.pane_id, lines=lines))

    def send_shell_command(self, pane: AgentPane, command: str, timeout: int) -> str:
        token = f"{MARKER_PREFIX}_{pane.name}_{int(time.time() * 1000)}".replace("-", "_")
        wrapped = (
            f"printf '\\n{token}_BEGIN\\n'; "
            f"{command}; __sync_status=$?; "
            f"printf '\\n{token}_END:%s\\n' \"$__sync_status\""
        )
        self.runner.run(["tmux", "send-keys", "-t", pane.pane_id, "C-u"], log_name=f"tmux-clear-{pane.name}")
        self.runner.run(["tmux", "send-keys", "-t", pane.pane_id, "-l", wrapped], log_name=f"tmux-send-{pane.name}")
        self.runner.run(["tmux", "send-keys", "-t", pane.pane_id, "C-m"], log_name=f"tmux-enter-{pane.name}")
        output = self.wait_for_marker(pane.pane_id, token, timeout)
        self.writer.write_text(f"command-{pane.name}-{token}.txt", output)
        status_match = re.search(rf"{re.escape(token)}_END:(\d+)", output)
        if not status_match:
            raise HarnessError(f"Command marker for {pane.name} did not include exit status")
        if status_match.group(1) != "0":
            raise HarnessError(f"Pane command for {pane.name} failed with status {status_match.group(1)}; see command log")
        return output

    def wait_for_marker(self, pane_id: str, token: str, timeout: int) -> str:
        deadline = time.time() + timeout
        end_pattern = re.compile(rf"(^|\n){re.escape(token)}_END:(\d+)(\n|$)")
        while time.time() < deadline:
            output = self.capture_pane(pane_id, lines=3000)
            if end_pattern.search(output):
                return slice_marker_output(output, token)
            time.sleep(0.25)
        raise HarnessError(f"Timed out waiting for pane command marker {token}")

    def send_pi_prompt(self, pane: AgentPane, prompt: str) -> None:
        self.runner.run(["tmux", "send-keys", "-t", pane.pane_id, "C-u"], check=False, log_name=f"tmux-clear-{pane.name}")
        self.runner.run(["tmux", "send-keys", "-t", pane.pane_id, "-l", prompt], log_name=f"tmux-send-prompt-{pane.name}")
        # Pi's TUI does not reliably submit with C-m under tmux; named Enter is required.
        self.runner.run(["tmux", "send-keys", "-t", pane.pane_id, "Enter"], log_name=f"tmux-enter-prompt-{pane.name}")
        self.writer.write_text(f"prompt-{pane.name}.txt", prompt)


def find_pane_for_agent(name: str, panes: list[dict[str, Any]], aoe_session_ids: dict[str, str]) -> dict[str, Any] | None:
    compact = re.sub(r"[^A-Za-z0-9_-]", "", name)
    aoe_id = aoe_session_ids.get(name, "")
    id_prefix = aoe_id[:8] if aoe_id else ""
    if id_prefix:
        id_candidates = [pane for pane in panes if id_prefix in str(pane["session"])]
        if len(id_candidates) == 1:
            return id_candidates[0]
    candidates = [
        pane
        for pane in panes
        if name in str(pane["session"]) or compact in str(pane["session"]) or name in str(pane["path"])
    ]
    if len(candidates) == 1:
        return candidates[0]
    if candidates:
        return sorted(candidates, key=lambda item: str(item["session"]))[0]
    return None

