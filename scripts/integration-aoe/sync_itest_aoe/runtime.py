from __future__ import annotations

import json
import os
import re
import shlex
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


class HarnessError(RuntimeError):
    pass


def utc_run_id() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def safe_log_name(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]", "_", value)


def require_tools(tools: tuple[str, ...] | list[str]) -> None:
    missing = [tool for tool in tools if shutil.which(tool) is None]
    if missing:
        raise HarnessError(f"Missing required tool(s): {', '.join(missing)}")


class ArtifactWriter:
    def __init__(self, root: Path) -> None:
        self.root = root

    def write_text(self, relative: str, value: str) -> None:
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value, encoding="utf-8")

    def write_json(self, relative: str, value: Any) -> None:
        self.write_text(relative, json.dumps(value, indent=2, sort_keys=True) + "\n")

    def write_json_at(self, path: Path, value: Any) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


class CommandRunner:
    def __init__(self, repo: Path, env: dict[str, str], writer: ArtifactWriter) -> None:
        self.repo = repo
        self.env = env
        self.writer = writer

    def run(
        self,
        args: list[str],
        *,
        check: bool = True,
        log_name: str | None = None,
        input_text: str | None = None,
    ) -> subprocess.CompletedProcess[str]:
        try:
            result = subprocess.run(args, cwd=self.repo, env=self.env, text=True, input=input_text, capture_output=True)
        except FileNotFoundError as error:
            if check:
                raise HarnessError(f"Command not found: {args[0]}") from error
            return subprocess.CompletedProcess(args=args, returncode=127, stdout="", stderr=str(error))
        if log_name:
            safe = safe_log_name(log_name)
            self.writer.write_text(f"{safe}.stdout.txt", result.stdout)
            self.writer.write_text(f"{safe}.stderr.txt", result.stderr)
        if check and result.returncode != 0:
            raise HarnessError(
                f"Command failed ({result.returncode}): {shlex.join(args)}\n"
                f"stdout:\n{result.stdout}\n"
                f"stderr:\n{result.stderr}"
            )
        return result


def synchronize_env(sync_home: Path, extra: dict[str, str] | None = None) -> dict[str, str]:
    return {
        **os.environ,
        "SYNCHRONIZE_HOME": str(sync_home),
        "SYNCHRONIZE_PORT": "0",
        **(extra or {}),
    }


def slice_marker_output(output: str, token: str) -> str:
    end = output.rfind(f"{token}_END:")
    begin = output.rfind(f"{token}_BEGIN", 0, end)
    if begin == -1 or end == -1:
        return output
    newline = output.find("\n", end)
    return output[begin:end] + output[end : newline if newline != -1 else len(output)]


def extract_json_object(text: str) -> dict[str, Any]:
    decoder = json.JSONDecoder()
    for index, char in enumerate(text):
        if char != "{":
            continue
        try:
            value, _ = decoder.raw_decode(text[index:])
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            return value
    raise HarnessError(f"No JSON object found in command output:\n{text}")


def stop_daemon(sync_home: Path, writer: ArtifactWriter) -> None:
    discovery = sync_home / "daemon.json"
    if not discovery.exists():
        return
    try:
        pid = json.loads(discovery.read_text()).get("pid")
        if isinstance(pid, int):
            os.kill(pid, 15)
    except Exception as error:  # noqa: BLE001 - cleanup should remain best-effort
        writer.write_text("cleanup-daemon-error.txt", str(error))
