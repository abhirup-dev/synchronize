from __future__ import annotations

import argparse
import shutil
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..aoe import AoeController
from ..pi_env import PiEnvironment, PiPaths
from ..runtime import ArtifactWriter, CommandRunner, HarnessError, require_tools, stop_daemon, synchronize_env, utc_run_id
from ..sync_rest import SyncRestClient
from ..tmux import AgentPane, TmuxController, require_libtmux

DEFAULT_PROVIDER = "openai-codex"
DEFAULT_MODEL = "gpt-5.4-mini"
DEFAULT_AGENTS = 2


@dataclass(frozen=True)
class PiPeer:
    name: str
    peer_id: str
    host_session_id: str


class PiMcpDmScenario:
    def __init__(self, args: argparse.Namespace, repo: Path) -> None:
        self.args = args
        self.repo = repo
        self.run_id = args.run_id or utc_run_id()
        self.state_root = Path(args.state_dir).expanduser().resolve() if args.state_dir else self.repo / ".synchronize-itest"
        self.run_dir = Path(args.run_dir).expanduser().resolve() if args.run_dir else self.state_root / "runs" / self.run_id
        self.pi_home = self.run_dir / "pi-agent"
        self.pi_sessions = self.run_dir / "pi-sessions"
        self.sync_home = self.run_dir / "synchronize-home"
        self.profile = args.profile or f"sync-pi-itest-{self.repo.name}-{self.run_id.lower()}"
        self.agent_names = [f"{args.agent_prefix}-{index}" for index in range(1, args.agents + 1)]
        self.env = synchronize_env(self.sync_home)
        self.writer = ArtifactWriter(self.run_dir)
        self.runner = CommandRunner(self.repo, self.env, self.writer)
        self.aoe = AoeController(self.profile, self.repo, self.runner, self.writer)
        self.tmux = TmuxController(self.runner, self.writer)
        self.rest = SyncRestClient(self.sync_home)
        self.pi_env = PiEnvironment(
            repo=self.repo,
            paths=PiPaths(pi_home=self.pi_home, pi_sessions=self.pi_sessions, sync_home=self.sync_home),
            provider=self.args.provider,
            model=self.args.model,
            auth_source=self.args.auth_source,
            writer=self.writer,
        )
        self.agent_panes: dict[str, AgentPane] = {}
        self.pi_peers: dict[str, PiPeer] = {}
        self.aoe_session_ids: dict[str, str] = {}

    def run(self) -> None:
        self.run_dir.mkdir(parents=True, exist_ok=True)
        self.pi_home.mkdir(parents=True, exist_ok=True)
        self.pi_sessions.mkdir(parents=True, exist_ok=True)
        self.sync_home.mkdir(parents=True, exist_ok=True)
        self.writer.write_json(
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
            self.pi_env.provision()
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
        require_tools(("aoe", "tmux", "bun", "uv", "pi"))
        require_libtmux("scripts/integration_pi.py")
        self.pi_env.validate()
        versions: dict[str, str] = {}
        for tool, command in {
            "aoe": ["aoe", "--version"],
            "tmux": ["tmux", "-V"],
            "bun": ["bun", "--version"],
            "uv": ["uv", "--version"],
            "pi": ["pi", "--version"],
        }.items():
            result = self.runner.run(command, check=False)
            versions[tool] = (result.stdout or result.stderr).strip()
        self.writer.write_json("preflight.json", versions)

    def start_daemon(self) -> None:
        result = self.runner.run(["bun", "run", "src/cli.ts", "status"], log_name="synchronize-status-start")
        self.writer.write_text("synchronize-status-start.txt", result.stdout)

    def setup_aoe(self) -> None:
        self.aoe.launch_sessions(
            self.agent_names,
            "pi",
            {name: self.pi_env.command_for_session(name) for name in self.agent_names},
        )
        self.aoe_session_ids = self.aoe.wait_for_sessions(self.agent_names, self.args.start_timeout, "Pi")
        self.aoe.collect_state("after-launch")

    def discover_tmux_panes(self) -> None:
        self.agent_panes = self.tmux.map_agent_panes(self.agent_names, self.aoe_session_ids)
        self.tmux.capture_all_panes("initial", self.agent_panes, lines=700)

    def wait_for_pi_registration(self) -> None:
        deadline = time.time() + self.args.registration_timeout
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
            mapped = self.map_bindings_to_agents(matched_bindings)
            if len(mapped) == len(self.agent_names):
                self.pi_peers = mapped
                self.writer.write_json("pi-peers.json", {name: peer.__dict__ for name, peer in self.pi_peers.items()})
                self.writer.write_json("pi-agent-session-bindings.json", matched_bindings)
                return
            time.sleep(1)
        self.tmux.capture_all_panes("registration-timeout", self.agent_panes, lines=700)
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
            output = self.tmux.capture_pane(pane.pane_id, lines=500)
            for host_session_id, binding in by_host_session_id.items():
                if host_session_id not in output:
                    continue
                mapped[name] = PiPeer(name=name, peer_id=str(binding["peer_id"]), host_session_id=host_session_id)
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
        self.tmux.send_pi_prompt(self.agent_panes[sender_name], prompt)
        event = self.wait_for_dm_event(sender.peer_id, other_peer_ids, body)
        self.writer.write_json("dm-event.json", event)
        if not self.wait_for_transcript_evidence(sender_name, ["bridge_whoami", "bridge_list_peers", "bridge_dm"], self.args.command_timeout):
            raise HarnessError("Pi transcript did not show bridge_whoami, bridge_list_peers, and bridge_dm MCP calls")
        self.tmux.capture_all_panes("after-pi-mcp-dm", self.agent_panes, lines=700)

    def wait_for_mcp_ready_agent(self) -> str:
        deadline = time.time() + self.args.mcp_timeout
        while time.time() < deadline:
            for name in self.agent_names:
                pane = self.agent_panes[name]
                output = self.tmux.capture_pane(pane.pane_id, lines=250)
                if "MCP: 1/1" in output or "MCP: 1 servers connected" in output:
                    self.writer.write_text("mcp-ready-agent.txt", name)
                    return name
            time.sleep(1)
        self.tmux.capture_all_panes("mcp-timeout", self.agent_panes, lines=700)
        raise HarnessError(f"No Pi pane reported MCP ready within {self.args.mcp_timeout}s")

    def wait_for_dm_event(self, sender_peer_id: str, recipient_peer_ids: list[str], body: str) -> dict[str, Any]:
        deadline = time.time() + self.args.command_timeout
        while time.time() < deadline:
            for recipient_peer_id in recipient_peer_ids:
                events = self.rest.events(recipient_peer_id, cursor=0, limit=100).get("events", [])
                for event in events:
                    if (
                        event.get("sender_peer_id") == sender_peer_id
                        and event.get("recipient_peer_id") == recipient_peer_id
                        and event.get("body") == body
                    ):
                        return event
            time.sleep(2)
        self.tmux.capture_all_panes("dm-timeout", self.agent_panes, lines=700)
        raise HarnessError("Timed out waiting for Pi MCP DM event in synchronize REST state")

    def wait_for_transcript_evidence(self, agent_name: str, needles: list[str], timeout: int) -> bool:
        deadline = time.time() + timeout
        while time.time() < deadline:
            text = self.pi_env.read_transcripts()
            if all(needle in text for needle in needles) and agent_name in text:
                self.writer.write_text("pi-transcript-evidence.txt", text[-20000:])
                return True
            time.sleep(2)
        self.writer.write_text("pi-transcript-evidence-missing.txt", self.pi_env.read_transcripts()[-20000:])
        return False

    def collect_diagnostics(self, label: str) -> None:
        try:
            self.aoe.collect_state(label)
        except Exception as error:  # noqa: BLE001
            self.writer.write_text(f"{label}-aoe-diagnostics-error.txt", str(error))
        try:
            if self.agent_panes:
                self.tmux.capture_all_panes(label, self.agent_panes, lines=700)
        except Exception as error:  # noqa: BLE001
            self.writer.write_text(f"{label}-pane-diagnostics-error.txt", str(error))
        try:
            if (self.sync_home / "daemon.json").exists():
                self.writer.write_json(f"{label}-sync-status.json", self.rest.status())
                self.writer.write_json(f"{label}-sync-peers.json", self.rest.peers())
                self.writer.write_json(f"{label}-sync-agent-sessions.json", self.rest.agent_sessions("pi"))
        except Exception as error:  # noqa: BLE001
            self.writer.write_text(f"{label}-sync-diagnostics-error.txt", str(error))
        try:
            self.writer.write_text(f"{label}-pi-transcripts.txt", self.pi_env.read_transcripts()[-50000:])
        except Exception as error:  # noqa: BLE001
            self.writer.write_text(f"{label}-pi-transcripts-error.txt", str(error))

    def cleanup(self) -> None:
        if shutil.which("aoe") is not None:
            self.aoe.cleanup(self.agent_names)
        stop_daemon(self.sync_home, self.writer)
        shutil.rmtree(self.pi_home, ignore_errors=True)
        shutil.rmtree(self.pi_sessions, ignore_errors=True)
        shutil.rmtree(self.sync_home, ignore_errors=True)


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


def main(argv: list[str], repo: Path) -> int:
    try:
        PiMcpDmScenario(parse_args(argv), repo).run()
        return 0
    except HarnessError as error:
        print(f"FAIL {error}", file=sys.stderr)
        return 1
