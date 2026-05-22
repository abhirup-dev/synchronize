from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

from .runtime import ArtifactWriter, CommandRunner, HarnessError


class AoeController:
    def __init__(self, profile: str, repo: Path, runner: CommandRunner, writer: ArtifactWriter) -> None:
        self.profile = profile
        self.repo = repo
        self.runner = runner
        self.writer = writer

    def create_profile(self) -> None:
        self.runner.run(["aoe", "profile", "create", self.profile], check=False, log_name="aoe-profile-create")

    def add_session(self, title: str, tool: str, command_override: str) -> None:
        self.runner.run(
            [
                "aoe",
                "-p",
                self.profile,
                "add",
                "--title",
                title,
                "--cmd",
                tool,
                "--cmd-override",
                command_override,
                str(self.repo),
            ],
            log_name=f"aoe-add-{title}",
        )

    def start_session(self, title: str) -> None:
        self.runner.run(["aoe", "-p", self.profile, "session", "start", title], log_name=f"aoe-start-{title}")

    def launch_sessions(self, titles: list[str], tool: str, command_override_by_title: dict[str, str]) -> None:
        self.create_profile()
        for title in titles:
            self.add_session(title, tool, command_override_by_title[title])
            self.start_session(title)

    def wait_for_sessions(self, titles: list[str], timeout: int, label: str) -> dict[str, str]:
        deadline = time.time() + timeout
        while time.time() < deadline:
            sessions = self.list_sessions()
            by_title = {str(session.get("title") or session.get("name") or ""): session for session in sessions}
            if all(title in by_title for title in titles):
                session_ids = {
                    title: str(by_title[title].get("id") or "")
                    for title in titles
                    if str(by_title[title].get("id") or "")
                }
                if session_ids:
                    self.writer.write_json("aoe-session-ids.json", session_ids)
                return session_ids
            time.sleep(1)
        raise HarnessError(f"AoE did not report all {label} sessions within {timeout}s")

    def list_sessions(self) -> list[dict[str, Any]]:
        result = self.runner.run(["aoe", "-p", self.profile, "list", "--json"], check=False, log_name="aoe-list-latest")
        if result.returncode != 0 or not result.stdout.strip():
            return []
        data = json.loads(result.stdout)
        if isinstance(data, list):
            return [item for item in data if isinstance(item, dict)]
        if isinstance(data, dict):
            for key in ("sessions", "items", "data"):
                value = data.get(key)
                if isinstance(value, list):
                    return [item for item in value if isinstance(item, dict)]
        return []

    def collect_state(self, label: str) -> None:
        self.runner.run(["aoe", "-p", self.profile, "list", "--json"], check=False, log_name=f"{label}-aoe-list")
        self.runner.run(["aoe", "-p", self.profile, "status", "--json"], check=False, log_name=f"{label}-aoe-status")

    def cleanup(self, titles: list[str]) -> None:
        for title in titles:
            self.runner.run(["aoe", "-p", self.profile, "remove", "--force", title], check=False, log_name=f"cleanup-aoe-remove-{title}")
        self.runner.run(["aoe", "profile", "delete", self.profile], check=False, log_name="cleanup-aoe-profile-delete", input_text="y\n")

