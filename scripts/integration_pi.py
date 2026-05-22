#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "libtmux>=0.46",
# ]
# ///
"""Real Pi/AoE/tmux integration smoke for synchronize.

This is a manual local harness. It provisions an isolated Pi config for the
current worktree, launches real interactive Pi sessions through AoE, then asks
one Pi agent to send a synchronize MCP DM to another Pi agent.
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
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import libtmux
except ModuleNotFoundError:  # pragma: no cover
    libtmux = None  # type: ignore[assignment]


DEFAULT_PROVIDER = "openai-codex"
DEFAULT_MODEL = "gpt-5.4-mini"
DEFAULT_AGENTS = 2


@dataclass(frozen=True)
class AgentPane:
    name: str
    pane_id: str
    tmux_session: str
    tmux_window: str


@dataclass(frozen=True)
class PiPeer:
    name: str
    peer_id: str
    host_session_id: str


class HarnessError(RuntimeError):
    pass


class PiHarness:
    def __init__(self, args: argparse.Namespace) -> None:
        self.args = args
        self.repo = Path(__file__).resolve().parents[1]
        self.run_id = args.run_id or datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        self.state_root = Path(args.state_dir).expanduser().resolve() if args.state_dir else self.repo / ".synchronize-itest"
        self.run_dir = Path(args.run_dir).expanduser().resolve() if args.run_dir else self.state_root / "runs" / self.run_id
        self.pi_home = self.run_dir / "pi-agent"
        self.pi_sessions = self.run_dir / "pi-sessions"
        self.sync_home = self.run_dir / "synchronize-home"
        self.profile = args.profile or f"sync-pi-itest-{self.repo.name}-{self.run_id.lower()}"
        self.agent_names = [f"{args.agent_prefix}-{index}" for index in range(1, args.agents + 1)]
        self.env = {
            **os.environ,
            "SYNCHRONIZE_HOME": str(self.sync_home),
            "SYNCHRONIZE_PORT": "0",
        }
        self.agent_panes: dict[str, AgentPane] = {}
        self.pi_peers: dict[str, PiPeer] = {}
        self.aoe_session_ids: dict[str, str] = {}

    def run(self) -> None:
        self.run_dir.mkdir(parents=True, exist_ok=True)
        self.pi_home.mkdir(parents=True, exist_ok=True)
        self.pi_sessions.mkdir(parents=True, exist_ok=True)
        self.sync_home.mkdir(parents=True, exist_ok=True)
        self.write_json(
            "run-summary.json",
            {
                "run_id": self.run_id,
                "profile": self.profile,
                "agents": self.agent_names,
                "repo": str(self.repo),
                "run_dir": str(self.run_dir),
                "pi_home": str(self.pi_home),
                "pi_sessions": str(self.pi_sessions),
                "sync_home": str(self.sync_home),
                "provider": self.args.provider,
                "model": self.args.model,
                "keep": self.args.keep,
            },
        )

        try:
            self.preflight()
            self.provision_pi_environment()
            self.start_daemon()
            self.setup_aoe()
            self.discover_tmux_panes()
            self.wait_for_pi_registration()
            self.run_mcp_dm_smoke()
            self.collect_diagnostics("success")
            print(f"PASS real Pi AoE/tmux smoke run_id={self.run_id} log_dir={self.run_dir}")
        except BaseException:
            self.collect_diagnostics("failure")
            raise
        finally:
            if self.args.keep:
                print(f"KEEP enabled: AoE profile '{self.profile}' and run state remain at {self.run_dir}")
            else:
                self.cleanup()

    def preflight(self) -> None:
        missing = [tool for tool in ("aoe", "tmux", "bun", "uv", "pi") if shutil.which(tool) is None]
        if missing:
            raise HarnessError(f"Missing required tool(s): {', '.join(missing)}")
        if libtmux is None:
            raise HarnessError("Python dependency 'libtmux' is missing. Run through `uv run scripts/integration_pi.py`.")
        required_paths = {
            "synchronize_mcp": self.repo / "bin" / "synchronize-mcp",
            "pi_extension": self.repo / "extensions" / "pi-synchronize" / "src" / "index.ts",
            "pi_skill": self.repo / "skills" / "synchronize-pi",
        }
        missing_paths = [f"{name}={path}" for name, path in required_paths.items() if not path.exists()]
        if missing_paths:
            raise HarnessError("Missing worktree integration path(s): " + ", ".join(missing_paths))
        auth_source = self.auth_source_path()
        if not auth_source.exists():
            raise HarnessError(f"Pi auth source is missing: {auth_source}")
        versions: dict[str, str] = {}
        for tool, command in {
            "aoe": ["aoe", "--version"],
            "tmux": ["tmux", "-V"],
            "bun": ["bun", "--version"],
            "uv": ["uv", "--version"],
            "pi": ["pi", "--version"],
        }.items():
            result = self.command(command, check=False)
            versions[tool] = (result.stdout or result.stderr).strip()
        self.write_json("preflight.json", versions)

    def auth_source_path(self) -> Path:
        if self.args.auth_source:
            return Path(self.args.auth_source).expanduser().resolve()
        return Path.home() / ".pi" / "agent" / "auth.json"

    def provision_pi_environment(self) -> None:
        shutil.copy2(self.auth_source_path(), self.pi_home / "auth.json")
        settings = {
            "defaultProvider": self.args.provider,
            "defaultModel": self.args.model,
            "packages": ["npm:pi-mcp-adapter"],
        }
        self.write_json_at(self.pi_home / "settings.json", settings)
        mcp_config = {
            "mcpServers": {
                "synchronize": {
                    "command": str(self.repo / "bin" / "synchronize-mcp"),
                    "env": {
                        "SYNCHRONIZE_HOME": str(self.sync_home),
                        "SYNCHRONIZE_MCP_MODE": "codex",
                        "PATH": os.environ.get("PATH", ""),
                    },
                }
            }
        }
        self.write_json_at(self.pi_home / "mcp.json", mcp_config)
        self.write_json(
            "pi-environment.json",
            {
                "pi_home": str(self.pi_home),
                "pi_sessions": str(self.pi_sessions),
                "auth_source": str(self.auth_source_path()),
                "settings": settings,
                "mcp_config": mcp_config,
                "extension": str(self.repo / "extensions" / "pi-synchronize" / "src" / "index.ts"),
                "skill": str(self.repo / "skills" / "synchronize-pi"),
            },
        )

    def start_daemon(self) -> None:
        result = self.command(
            ["bun", "run", "src/cli.ts", "status"],
            log_name="synchronize-status-start",
        )
        self.write_text("synchronize-status-start.txt", result.stdout)

    def setup_aoe(self) -> None:
        self.command(["aoe", "profile", "create", self.profile], check=False, log_name="aoe-profile-create")
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
                    "pi",
                    "--cmd-override",
                    self.pi_command(name),
                    str(self.repo),
                ],
                log_name=f"aoe-add-{name}",
            )
            self.command(["aoe", "-p", self.profile, "session", "start", name], log_name=f"aoe-start-{name}")
        self.wait_for_aoe_sessions()
        self.collect_aoe_state("after-launch")

    def pi_command(self, name: str) -> str:
        extension = self.repo / "extensions" / "pi-synchronize" / "src" / "index.ts"
        skill = self.repo / "skills" / "synchronize-pi"
        mcp_config = self.pi_home / "mcp.json"
        env_parts = {
            "PI_CODING_AGENT_DIR": str(self.pi_home),
            "PI_CODING_AGENT_SESSION_DIR": str(self.pi_sessions),
            "SYNCHRONIZE_HOME": str(self.sync_home),
            "SYNCHRONIZE_PORT": "0",
            "SYNCHRONIZE_SESSION_NAME": name,
            "SYNCHRONIZE_PI_DEBUG": "1",
        }
        command = ["env"]
        for key, value in env_parts.items():
            command.append(f"{key}={value}")
        command.extend(
            [
                "pi",
                "--provider",
                self.args.provider,
                "--model",
                self.args.model,
                "--mcp-config",
                str(mcp_config),
                "--extension",
                str(extension),
                "--skill",
                str(skill),
                "--no-context-files",
                "--no-prompt-templates",
                "--no-themes",
            ]
        )
        return shlex.join(command)

    def wait_for_aoe_sessions(self) -> None:
        deadline = time.time() + self.args.start_timeout
        while time.time() < deadline:
            sessions = self.aoe_list()
            by_title = {str(session.get("title") or session.get("name") or ""): session for session in sessions}
            if all(name in by_title for name in self.agent_names):
                self.aoe_session_ids = {
                    name: str(by_title[name].get("id") or "")
                    for name in self.agent_names
                    if str(by_title[name].get("id") or "")
                }
                self.write_json("aoe-session-ids.json", self.aoe_session_ids)
                return
            time.sleep(1)
        raise HarnessError(f"AoE did not report all Pi sessions within {self.args.start_timeout}s")

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
                raise HarnessError(f"Could not map AoE Pi session '{name}' to tmux pane")
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
        aoe_id = self.aoe_session_ids.get(name, "")
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

    def wait_for_pi_registration(self) -> None:
        deadline = time.time() + self.args.registration_timeout
        while time.time() < deadline:
            try:
                bindings = self.http_json(self.base_url(), "/agent-sessions?tool=pi").get("bindings", [])
            except HarnessError:
                bindings = []
            matched_bindings = []
            for binding in bindings:
                if not isinstance(binding, dict):
                    continue
                if str(binding.get("cwd") or "") != str(self.repo):
                    continue
                if str(binding.get("host_tool") or "") != "pi":
                    continue
                matched_bindings.append(binding)
            mapped = self.map_bindings_to_agents(matched_bindings)
            if len(mapped) == len(self.agent_names):
                self.pi_peers = mapped
                self.write_json("pi-peers.json", {name: peer.__dict__ for name, peer in self.pi_peers.items()})
                self.write_json("pi-agent-session-bindings.json", matched_bindings)
                return
            time.sleep(1)
        self.capture_all_panes("registration-timeout")
        raise HarnessError(f"Pi sessions did not auto-register within {self.args.registration_timeout}s")

    def map_bindings_to_agents(self, bindings: list[dict[str, Any]]) -> dict[str, PiPeer]:
        by_host_session_id = {
            str(binding.get("host_session_id") or ""): binding
            for binding in bindings
            if str(binding.get("host_session_id") or "")
        }
        mapped: dict[str, PiPeer] = {}
        for name in self.agent_names:
            pane = self.agent_panes.get(name)
            if not pane:
                continue
            output = self.capture_pane(pane.pane_id, lines=500)
            for host_session_id, binding in by_host_session_id.items():
                if host_session_id not in output:
                    continue
                mapped[name] = PiPeer(
                    name=name,
                    peer_id=str(binding["peer_id"]),
                    host_session_id=host_session_id,
                )
                break
        return mapped

    def run_mcp_dm_smoke(self) -> None:
        sender_name = self.wait_for_mcp_ready_agent()
        sender = self.pi_peers[sender_name]
        other_peer_ids = [peer.peer_id for name, peer in self.pi_peers.items() if name != sender_name]
        if not other_peer_ids:
            raise HarnessError("No recipient Pi peer is available for the DM smoke")
        if sender.peer_id in other_peer_ids:
            raise HarnessError("Sender peer_id appeared in recipient candidate set; pane-to-peer mapping is invalid")
        body = f"PI_MCP_DM_SMOKE {self.run_id} from {sender_name}"
        prompt = (
            "Use the synchronize MCP tools only. Do not use shell commands or the synchronize CLI. "
            "First call bridge_whoami to inspect your own synchronize identity. "
            "Then call bridge_list_peers and identify the other live Pi peer, excluding your own peer_id. "
            f"Call bridge_dm exactly once to that other Pi peer with message={body!r}. "
            "After the tool call succeeds, reply with exactly: PI_MCP_DM_SENT"
        )
        self.send_prompt(sender_name, prompt)
        event = self.wait_for_dm_event(sender.peer_id, other_peer_ids, body)
        self.write_json("dm-event.json", event)
        if not self.wait_for_transcript_evidence(sender_name, ["bridge_whoami", "bridge_list_peers", "bridge_dm"], self.args.command_timeout):
            raise HarnessError("Pi transcript did not show bridge_whoami, bridge_list_peers, and bridge_dm MCP calls")
        self.capture_all_panes("after-pi-mcp-dm")

    def wait_for_mcp_ready_agent(self) -> str:
        deadline = time.time() + self.args.mcp_timeout
        while time.time() < deadline:
            for name in self.agent_names:
                pane = self.agent_panes[name]
                output = self.capture_pane(pane.pane_id, lines=250)
                if "MCP: 1/1" in output or "MCP: 1 servers connected" in output:
                    self.write_text("mcp-ready-agent.txt", name)
                    return name
            time.sleep(1)
        self.capture_all_panes("mcp-timeout")
        raise HarnessError(f"No Pi pane reported MCP ready within {self.args.mcp_timeout}s")

    def send_prompt(self, agent_name: str, prompt: str) -> None:
        pane = self.agent_panes[agent_name]
        self.command(["tmux", "send-keys", "-t", pane.pane_id, "C-u"], check=False, log_name=f"tmux-clear-{agent_name}")
        self.command(["tmux", "send-keys", "-t", pane.pane_id, "-l", prompt], log_name=f"tmux-send-prompt-{agent_name}")
        # Pi's TUI does not reliably submit with C-m under tmux; named Enter is required.
        self.command(["tmux", "send-keys", "-t", pane.pane_id, "Enter"], log_name=f"tmux-enter-prompt-{agent_name}")
        self.write_text(f"prompt-{agent_name}.txt", prompt)

    def wait_for_dm_event(self, sender_peer_id: str, recipient_peer_ids: list[str], body: str) -> dict[str, Any]:
        deadline = time.time() + self.args.command_timeout
        while time.time() < deadline:
            for recipient_peer_id in recipient_peer_ids:
                events = self.http_json(self.base_url(), f"/events/{recipient_peer_id}?cursor=0&limit=100").get("events", [])
                for event in events:
                    if (
                        event.get("sender_peer_id") == sender_peer_id
                        and event.get("recipient_peer_id") == recipient_peer_id
                        and event.get("body") == body
                    ):
                        return event
            time.sleep(2)
        self.capture_all_panes("dm-timeout")
        raise HarnessError("Timed out waiting for Pi MCP DM event in synchronize REST state")

    def wait_for_transcript_evidence(self, agent_name: str, needles: list[str], timeout: int) -> bool:
        deadline = time.time() + timeout
        while time.time() < deadline:
            text = self.read_all_pi_transcripts()
            if all(needle in text for needle in needles) and agent_name in text:
                self.write_text("pi-transcript-evidence.txt", text[-20000:])
                return True
            time.sleep(2)
        self.write_text("pi-transcript-evidence-missing.txt", self.read_all_pi_transcripts()[-20000:])
        return False

    def read_all_pi_transcripts(self) -> str:
        if not self.pi_sessions.exists():
            return ""
        parts: list[str] = []
        for path in sorted(self.pi_sessions.rglob("*.jsonl")):
            try:
                parts.append(f"\n--- {path} ---\n{path.read_text(encoding='utf-8', errors='replace')}")
            except OSError:
                continue
        return "\n".join(parts)

    def base_url(self) -> str:
        return str(self.read_discovery()["baseUrl"])

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
        except urllib.error.URLError as error:
            raise HarnessError(f"HTTP request failed for {path}: {error}") from error

    def collect_diagnostics(self, label: str) -> None:
        try:
            self.collect_aoe_state(label)
        except Exception as error:  # noqa: BLE001
            self.write_text(f"{label}-aoe-diagnostics-error.txt", str(error))
        try:
            if self.agent_panes:
                self.capture_all_panes(label)
        except Exception as error:  # noqa: BLE001
            self.write_text(f"{label}-pane-diagnostics-error.txt", str(error))
        try:
            if (self.sync_home / "daemon.json").exists():
                base_url = self.base_url()
                self.write_json(f"{label}-sync-status.json", self.http_json(base_url, "/status"))
                self.write_json(f"{label}-sync-peers.json", self.http_json(base_url, "/peers"))
                self.write_json(f"{label}-sync-agent-sessions.json", self.http_json(base_url, "/agent-sessions?tool=pi"))
        except Exception as error:  # noqa: BLE001
            self.write_text(f"{label}-sync-diagnostics-error.txt", str(error))
        try:
            self.write_text(f"{label}-pi-transcripts.txt", self.read_all_pi_transcripts()[-50000:])
        except Exception as error:  # noqa: BLE001
            self.write_text(f"{label}-pi-transcripts-error.txt", str(error))

    def collect_aoe_state(self, label: str) -> None:
        self.command(["aoe", "-p", self.profile, "list", "--json"], check=False, log_name=f"{label}-aoe-list")
        self.command(["aoe", "-p", self.profile, "status", "--json"], check=False, log_name=f"{label}-aoe-status")

    def capture_all_panes(self, label: str) -> None:
        for name, pane in self.agent_panes.items():
            self.write_text(f"{label}-pane-{name}.txt", self.capture_pane(pane.pane_id, lines=700))

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
        shutil.rmtree(self.pi_home, ignore_errors=True)
        shutil.rmtree(self.pi_sessions, ignore_errors=True)
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
        path = self.run_dir / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value, encoding="utf-8")

    def write_json(self, relative: str, value: Any) -> None:
        self.write_text(relative, json.dumps(value, indent=2, sort_keys=True) + "\n")

    def write_json_at(self, path: Path, value: Any) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the real Pi AoE/tmux synchronize integration smoke.")
    parser.add_argument("--profile", help="AoE profile to create/use. Defaults to sync-pi-itest-<worktree>-<timestamp>.")
    parser.add_argument("--run-id", help="Stable run id for reproducible names/logs.")
    parser.add_argument("--state-dir", help="Worktree-local state root. Defaults to .synchronize-itest.")
    parser.add_argument("--run-dir", help="Exact run directory. Defaults under --state-dir/runs/<run-id>.")
    parser.add_argument("--agents", type=int, default=DEFAULT_AGENTS, help="Number of real Pi sessions to launch.")
    parser.add_argument("--agent-prefix", default="sync-pi-agent", help="Prefix for Pi session titles.")
    parser.add_argument("--provider", default=DEFAULT_PROVIDER, help="Pi provider to use for the smoke.")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="Pi model to use for the smoke.")
    parser.add_argument("--auth-source", help="Path to auth.json to copy into the isolated Pi home. Defaults to ~/.pi/agent/auth.json.")
    parser.add_argument("--keep", action="store_true", help="Preserve AoE sessions/profile and all run state for debugging.")
    parser.add_argument("--start-timeout", type=int, default=90, help="Seconds to wait for AoE sessions to appear.")
    parser.add_argument("--registration-timeout", type=int, default=90, help="Seconds to wait for Pi extension auto-registration.")
    parser.add_argument("--mcp-timeout", type=int, default=90, help="Seconds to wait for at least one Pi pane to report MCP ready.")
    parser.add_argument("--command-timeout", type=int, default=180, help="Seconds to wait for real Pi MCP behavior.")
    args = parser.parse_args(argv)
    if args.agents < 2:
        parser.error("--agents must be at least 2 for the Pi MCP DM smoke")
    return args


def main(argv: list[str]) -> int:
    try:
        PiHarness(parse_args(argv)).run()
        return 0
    except HarnessError as error:
        print(f"FAIL {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
