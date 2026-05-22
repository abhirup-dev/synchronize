#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "libtmux>=0.46",
# ]
# ///
"""AoE/tmux integration smoke for synchronize.

This harness intentionally uses AoE as the session cockpit and tmux as the
automation substrate. The panes run normal shell commands; Python only
orchestrates setup, command injection, capture, and assertions.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import libtmux
except ModuleNotFoundError:  # pragma: no cover - exercised by preflight in normal use
    libtmux = None  # type: ignore[assignment]


DEFAULT_AGENTS = 5
DEFAULT_SHELL = "zsh -l"
MARKER_PREFIX = "__SYNC_ITEST"


@dataclass(frozen=True)
class AgentPane:
    name: str
    pane_id: str
    tmux_session: str
    tmux_window: str


@dataclass(frozen=True)
class CliPeer:
    name: str
    peer_id: str


class HarnessError(RuntimeError):
    pass


class Harness:
    def __init__(self, args: argparse.Namespace) -> None:
        self.args = args
        self.repo = Path(__file__).resolve().parents[1]
        self.run_id = args.run_id or datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        self.profile = args.profile or f"sync-itest-{self.run_id.lower()}"
        self.agent_names = [f"{args.agent_prefix}-{index}" for index in range(1, args.agents + 1)]
        self.log_dir = Path(args.log_dir).expanduser().resolve() if args.log_dir else Path(
            tempfile.mkdtemp(prefix=f"synchronize-itest-{self.run_id}-")
        )
        self.sync_home = Path(args.synchronize_home).expanduser().resolve() if args.synchronize_home else self.log_dir / "synchronize-home"
        self.env = {
            **os.environ,
            "SYNCHRONIZE_HOME": str(self.sync_home),
            "SYNCHRONIZE_PORT": "0",
        }
        self.agent_panes: dict[str, AgentPane] = {}
        self.cli_peers: dict[str, CliPeer] = {}

    def run(self) -> None:
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self.sync_home.mkdir(parents=True, exist_ok=True)
        self.write_json(
            "run-summary.json",
            {
                "run_id": self.run_id,
                "profile": self.profile,
                "agents": self.agent_names,
                "repo": str(self.repo),
                "sync_home": str(self.sync_home),
                "log_dir": str(self.log_dir),
                "keep": self.args.keep,
            },
        )

        try:
            self.preflight()
            self.setup_aoe()
            self.discover_tmux_panes()
            self.run_dm_smoke()
            print(f"PASS AoE/tmux synchronize smoke run_id={self.run_id} log_dir={self.log_dir}")
        except BaseException:
            self.collect_diagnostics("failure")
            raise
        finally:
            if self.args.keep:
                print(f"KEEP enabled: AoE profile '{self.profile}' and logs remain at {self.log_dir}")
            else:
                self.cleanup()

    def preflight(self) -> None:
        missing = [tool for tool in ("aoe", "tmux", "bun", "uv") if shutil.which(tool) is None]
        if missing:
            raise HarnessError(
                "Missing required tool(s): "
                + ", ".join(missing)
                + ". Install them first; this harness does not auto-install dependencies."
            )
        if libtmux is None:
            raise HarnessError("Python dependency 'libtmux' is missing. Run this script through `uv run scripts/integration_tmux.py`.")
        versions: dict[str, str] = {}
        for tool, command in {
            "aoe": ["aoe", "--version"],
            "tmux": ["tmux", "-V"],
            "bun": ["bun", "--version"],
            "uv": ["uv", "--version"],
        }.items():
            result = self.command(command, check=False)
            versions[tool] = (result.stdout or result.stderr).strip()
        self.write_json("preflight.json", versions)

    def setup_aoe(self) -> None:
        self.command(["aoe", "profile", "create", self.profile], check=False, log_name="aoe-profile-create")
        shell_override = f"sh -c {shlex.quote('exec ' + self.args.shell)}"
        for name in self.agent_names:
            self.command(
                [
                    "aoe",
                    "-p",
                    self.profile,
                    "add",
                    "--title",
                    name,
                    "--cmd",
                    self.args.aoe_tool,
                    "--cmd-override",
                    shell_override,
                    str(self.repo),
                ],
                log_name=f"aoe-add-{name}",
            )
            self.command(["aoe", "-p", self.profile, "session", "start", name], log_name=f"aoe-start-{name}")
        self.wait_for_aoe_sessions()
        self.collect_aoe_state("after-launch")

    def wait_for_aoe_sessions(self) -> None:
        deadline = time.time() + self.args.start_timeout
        while time.time() < deadline:
            sessions = self.aoe_list()
            titles = {str(session.get("title") or session.get("name") or "") for session in sessions}
            if all(name in titles for name in self.agent_names):
                return
            time.sleep(1)
        raise HarnessError(f"AoE did not report all test sessions within {self.args.start_timeout}s")

    def discover_tmux_panes(self) -> None:
        server = libtmux.Server()
        panes = []
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
        self.write_json("tmux-panes.json", panes)

        for name in self.agent_names:
            match = self.find_pane_for_agent(name, panes)
            if not match:
                raise HarnessError(f"Could not map AoE session '{name}' to a tmux pane; see tmux-panes.json")
            self.agent_panes[name] = AgentPane(
                name=name,
                pane_id=str(match["pane"]),
                tmux_session=str(match["session"]),
                tmux_window=str(match["window"]),
            )
        self.write_json("agent-panes.json", {name: pane.__dict__ for name, pane in self.agent_panes.items()})
        self.capture_all_panes("initial")

    def find_pane_for_agent(self, name: str, panes: list[dict[str, Any]]) -> dict[str, Any] | None:
        compact = re.sub(r"[^A-Za-z0-9_-]", "", name)
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

    def run_dm_smoke(self) -> None:
        agent1, agent2 = self.agent_names[0], self.agent_names[1]
        peer1 = self.register_peer(agent1)
        peer2 = self.register_peer(agent2)
        self.cli_peers = {agent1: peer1, agent2: peer2}

        message = f"hello from {agent1} run {self.run_id}"
        self.run_cli(agent1, f"dm {shlex.quote(peer2.peer_id)} {shlex.quote(message)}", as_peer=peer1)
        inbox_output = self.run_cli(agent2, "inbox --ack", as_peer=peer2)
        inbox_json = extract_json_object(inbox_output)
        events = inbox_json.get("events", [])
        if not any(event.get("body") == message for event in events):
            raise HarnessError(f"Recipient inbox did not contain expected DM body: {message!r}")

        self.assert_rest_state(peer1, peer2, message)
        self.capture_all_panes("after-dm-smoke")

    def register_peer(self, agent_name: str) -> CliPeer:
        output = self.run_cli(agent_name, f"register --name {shlex.quote(agent_name)} --purpose itest")
        body = extract_json_object(output)
        peer_id = body.get("peer_id")
        if not isinstance(peer_id, str) or not peer_id:
            raise HarnessError(f"register output for {agent_name} did not include peer_id")
        return CliPeer(name=agent_name, peer_id=peer_id)

    def run_cli(self, agent_name: str, args: str, as_peer: CliPeer | None = None) -> str:
        prefix = f"cd {shlex.quote(str(self.repo))} && "
        if as_peer:
            identity = json.dumps({"peer_id": as_peer.peer_id, "session_name": as_peer.name})
            prefix += f"mkdir -p {shlex.quote(str(self.sync_home))} && printf %s {shlex.quote(identity)} > {shlex.quote(str(self.sync_home / 'cli-peer.json'))} && "
        command = (
            prefix
            + f"SYNCHRONIZE_HOME={shlex.quote(str(self.sync_home))} "
            + f"SYNCHRONIZE_PORT=0 bun run src/cli.ts {args}"
        )
        return self.run_in_pane(agent_name, command)

    def run_in_pane(self, agent_name: str, command: str) -> str:
        pane = self.agent_panes[agent_name]
        token = f"{MARKER_PREFIX}_{agent_name}_{int(time.time() * 1000)}".replace("-", "_")
        wrapped = (
            f"printf '\\n{token}_BEGIN\\n'; "
            f"{command}; __sync_status=$?; "
            f"printf '\\n{token}_END:%s\\n' \"$__sync_status\""
        )
        self.command(["tmux", "send-keys", "-t", pane.pane_id, "C-u"], log_name=f"tmux-clear-{agent_name}")
        self.command(["tmux", "send-keys", "-t", pane.pane_id, "-l", wrapped], log_name=f"tmux-send-{agent_name}")
        self.command(["tmux", "send-keys", "-t", pane.pane_id, "C-m"], log_name=f"tmux-enter-{agent_name}")
        output = self.wait_for_marker(pane.pane_id, token)
        self.write_text(f"command-{agent_name}-{token}.txt", output)
        status_match = re.search(rf"{re.escape(token)}_END:(\d+)", output)
        if not status_match:
            raise HarnessError(f"Command marker for {agent_name} did not include exit status")
        if status_match.group(1) != "0":
            raise HarnessError(f"Pane command for {agent_name} failed with status {status_match.group(1)}; see command log")
        return output

    def wait_for_marker(self, pane_id: str, token: str) -> str:
        deadline = time.time() + self.args.command_timeout
        end_pattern = re.compile(rf"(^|\n){re.escape(token)}_END:(\d+)(\n|$)")
        while time.time() < deadline:
            output = self.capture_pane(pane_id, lines=3000)
            if end_pattern.search(output):
                return slice_marker_output(output, token)
            time.sleep(0.25)
        raise HarnessError(f"Timed out waiting for pane command marker {token}")

    def assert_rest_state(self, peer1: CliPeer, peer2: CliPeer, message: str) -> None:
        discovery = self.read_discovery()
        base_url = discovery["baseUrl"]
        peers = self.http_json(base_url, "/peers")
        peer_ids = {peer["peer_id"] for peer in peers.get("peers", [])}
        if peer1.peer_id not in peer_ids or peer2.peer_id not in peer_ids:
            raise HarnessError("REST /peers did not include both registered peers")

        events = self.http_json(base_url, f"/events/{peer2.peer_id}?cursor=0&limit=50")
        if not any(event.get("body") == message for event in events.get("events", [])):
            raise HarnessError("REST /events for recipient did not include the DM")

        inbox = self.http_json(base_url, f"/peers/{peer2.peer_id}/inbox")
        if any(event.get("body") == message for event in inbox.get("events", [])):
            raise HarnessError("Recipient inbox still contains DM after inbox --ack")
        self.write_json("rest-validation.json", {"peers": peers, "recipient_events": events, "recipient_inbox_after_ack": inbox})

    def read_discovery(self) -> dict[str, Any]:
        path = self.sync_home / "daemon.json"
        if not path.exists():
            raise HarnessError(f"synchronize discovery file missing: {path}")
        return json.loads(path.read_text())

    def http_json(self, base_url: str, path: str) -> dict[str, Any]:
        try:
            with urllib.request.urlopen(f"{base_url}{path}", timeout=5) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8", errors="replace")
            raise HarnessError(f"HTTP {error.code} for {path}: {body}") from error

    def collect_diagnostics(self, label: str) -> None:
        try:
            self.collect_aoe_state(label)
        except Exception as error:  # noqa: BLE001 - diagnostics must be best-effort
            self.write_text(f"{label}-aoe-diagnostics-error.txt", str(error))
        try:
            if self.agent_panes:
                self.capture_all_panes(label)
        except Exception as error:  # noqa: BLE001
            self.write_text(f"{label}-pane-diagnostics-error.txt", str(error))
        try:
            if (self.sync_home / "daemon.json").exists():
                discovery = self.read_discovery()
                base_url = discovery["baseUrl"]
                self.write_json(f"{label}-sync-status.json", self.http_json(base_url, "/status"))
                self.write_json(f"{label}-sync-peers.json", self.http_json(base_url, "/peers"))
        except Exception as error:  # noqa: BLE001
            self.write_text(f"{label}-sync-diagnostics-error.txt", str(error))

    def collect_aoe_state(self, label: str) -> None:
        self.command(["aoe", "-p", self.profile, "list", "--json"], check=False, log_name=f"{label}-aoe-list")
        self.command(["aoe", "-p", self.profile, "status", "--json"], check=False, log_name=f"{label}-aoe-status")

    def capture_all_panes(self, label: str) -> None:
        for name, pane in self.agent_panes.items():
            self.write_text(f"{label}-pane-{name}.txt", self.capture_pane(pane.pane_id, lines=500))

    def capture_pane(self, pane_id: str, lines: int) -> str:
        result = self.command(["tmux", "capture-pane", "-p", "-S", f"-{lines}", "-t", pane_id], check=False)
        return result.stdout

    def aoe_list(self) -> list[dict[str, Any]]:
        result = self.command(["aoe", "-p", self.profile, "list", "--json"], check=False, log_name="aoe-list-latest")
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

    def cleanup(self) -> None:
        if shutil.which("aoe") is not None:
            for name in self.agent_names:
                self.command(["aoe", "-p", self.profile, "remove", "--force", name], check=False, log_name=f"cleanup-aoe-remove-{name}")
            self.command(["aoe", "profile", "delete", self.profile], check=False, log_name="cleanup-aoe-profile-delete", input_text="y\n")
        discovery = self.sync_home / "daemon.json"
        if discovery.exists():
            try:
                pid = json.loads(discovery.read_text()).get("pid")
                if isinstance(pid, int):
                    os.kill(pid, 15)
            except Exception as error:  # noqa: BLE001
                self.write_text("cleanup-daemon-error.txt", str(error))
        shutil.rmtree(self.sync_home, ignore_errors=True)

    def command(
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
            safe = re.sub(r"[^A-Za-z0-9_.-]", "_", log_name)
            self.write_text(f"{safe}.stdout.txt", result.stdout)
            self.write_text(f"{safe}.stderr.txt", result.stderr)
        if check and result.returncode != 0:
            raise HarnessError(
                f"Command failed ({result.returncode}): {shlex.join(args)}\n"
                f"stdout:\n{result.stdout}\n"
                f"stderr:\n{result.stderr}"
            )
        return result

    def write_text(self, relative: str, value: str) -> None:
        path = self.log_dir / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value, encoding="utf-8")

    def write_json(self, relative: str, value: Any) -> None:
        self.write_text(relative, json.dumps(value, indent=2, sort_keys=True) + "\n")


def slice_marker_output(output: str, token: str) -> str:
    end = output.rfind(f"{token}_END:")
    begin = output.rfind(f"{token}_BEGIN", 0, end)
    if begin == -1 or end == -1:
        return output
    return output[begin:end] + output[end : output.find("\n", end) if output.find("\n", end) != -1 else len(output)]


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


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the AoE/tmux synchronize integration smoke.")
    parser.add_argument("--profile", help="AoE profile to create/use. Defaults to sync-itest-<timestamp>.")
    parser.add_argument("--run-id", help="Stable run id for reproducible names/logs.")
    parser.add_argument("--agents", type=int, default=DEFAULT_AGENTS, help="Number of AoE shell sessions to launch.")
    parser.add_argument("--agent-prefix", default="sync-agent", help="Prefix for test agent session titles.")
    parser.add_argument("--shell", default=DEFAULT_SHELL, help="Shell command AoE should run in each session.")
    parser.add_argument("--aoe-tool", default="claude", help="Supported AoE tool name to satisfy AoE validation before command override.")
    parser.add_argument("--synchronize-home", help="SYNCHRONIZE_HOME for the smoke. Defaults under the log directory.")
    parser.add_argument("--log-dir", help="Directory for run logs and diagnostics. Defaults to a temporary directory.")
    parser.add_argument("--keep", action="store_true", help="Preserve AoE sessions/profile and synchronize state for debugging.")
    parser.add_argument("--verbose", action="store_true", help="Currently reserved; logs are always written to --log-dir.")
    parser.add_argument("--start-timeout", type=int, default=60, help="Seconds to wait for AoE sessions to appear.")
    parser.add_argument("--command-timeout", type=int, default=30, help="Seconds to wait for each pane command to finish.")
    args = parser.parse_args(argv)
    if args.agents < 2:
        parser.error("--agents must be at least 2 for the DM smoke")
    return args


def main(argv: list[str]) -> int:
    try:
        Harness(parse_args(argv)).run()
        return 0
    except HarnessError as error:
        print(f"FAIL {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
