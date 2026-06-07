from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import shutil
import subprocess
from dataclasses import dataclass
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


@dataclass(frozen=True)
class RemoteDaemonConfig:
    url: str | None = None
    token: str | None = None

    @property
    def enabled(self) -> bool:
        return self.url is not None and self.url != ""

    def as_summary(self) -> dict[str, Any]:
        return {
            "remote_mode": self.enabled,
            "remote_url": self.url,
            "remote_token": "<set>" if self.token else None,
        }


def add_remote_daemon_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--remote-url",
        default=os.environ.get("SYNCHRONIZE_REMOTE_URL"),
        help="Use an already-running synchronize daemon at this base URL instead of starting a local test daemon.",
    )
    parser.add_argument(
        "--remote-token",
        default=os.environ.get("SYNCHRONIZE_TOKEN"),
        help="Bearer token for --remote-url. Defaults to SYNCHRONIZE_TOKEN.",
    )


def remote_daemon_from_args(args: argparse.Namespace) -> RemoteDaemonConfig:
    raw_url = str(getattr(args, "remote_url", "") or "").strip().rstrip("/")
    raw_token = str(getattr(args, "remote_token", "") or "").strip()
    return RemoteDaemonConfig(url=raw_url or None, token=raw_token or None)


_REMOTE_ONLY = ("SYNCHRONIZE_REMOTE_URL", "SYNCHRONIZE_TOKEN", "SYNCHRONIZE_HEALTH_TIMEOUT_MS")
_LOCAL_ONLY = ("SYNCHRONIZE_PORT",)


def daemon_connection_env(remote: RemoteDaemonConfig, sync_home: Path) -> dict[str, str]:
    env = {"SYNCHRONIZE_HOME": str(sync_home)}
    if remote.enabled and remote.url:
        env["SYNCHRONIZE_REMOTE_URL"] = remote.url
        env["SYNCHRONIZE_HEALTH_TIMEOUT_MS"] = "5000"
        if remote.token:
            env["SYNCHRONIZE_TOKEN"] = remote.token
    else:
        env["SYNCHRONIZE_PORT"] = "0"
    return env


def remote_env(remote: RemoteDaemonConfig) -> dict[str, str]:
    # Compatibility helper for Pi/Claude MCP env snippets that already include
    # their own SYNCHRONIZE_HOME. Keep the remote-mode half delegated to the
    # canonical resolver so URL/token/timeout cannot drift.
    return {key: value for key, value in daemon_connection_env(remote, Path(".")).items() if key != "SYNCHRONIZE_HOME" and key not in _LOCAL_ONLY}


def synchronize_shell_env(remote: RemoteDaemonConfig, sync_home: Path, extra: dict[str, str] | None = None) -> str:
    env = {**daemon_connection_env(remote, sync_home), **(extra or {})}
    return " ".join(f"{key}={shlex.quote(value)}" for key, value in env.items())


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


def synchronize_env(
    sync_home: Path,
    extra: dict[str, str] | None = None,
    *,
    remote: RemoteDaemonConfig | None = None,
) -> dict[str, str]:
    remote = remote or RemoteDaemonConfig()
    env = {**os.environ}
    for key in (*_REMOTE_ONLY, *_LOCAL_ONLY):
        env.pop(key, None)
    env.update(daemon_connection_env(remote, sync_home))
    env.update(extra or {})
    return env


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
