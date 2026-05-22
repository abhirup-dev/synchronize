from __future__ import annotations

import argparse
import json
import shlex
import shutil
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

from ..aoe import AoeController
from ..runtime import ArtifactWriter, CommandRunner, HarnessError, extract_json_object, require_tools, stop_daemon, synchronize_env, utc_run_id
from ..sync_rest import SyncRestClient
from ..tmux import AgentPane, TmuxController, require_libtmux

DEFAULT_AGENTS = 5
DEFAULT_SHELL = "zsh -l"


@dataclass(frozen=True)
class CliPeer:
    name: str
    peer_id: str


class CliDmScenario:
    def __init__(self, args: argparse.Namespace, repo: Path) -> None:
        self.args = args
        self.repo = repo
        self.run_id = args.run_id or utc_run_id()
        self.profile = args.profile or f"sync-itest-{self.run_id.lower()}"
        self.agent_names = [f"{args.agent_prefix}-{index}" for index in range(1, args.agents + 1)]
        self.log_dir = Path(args.log_dir).expanduser().resolve() if args.log_dir else Path(
            tempfile.mkdtemp(prefix=f"synchronize-itest-{self.run_id}-")
        )
        self.sync_home = Path(args.synchronize_home).expanduser().resolve() if args.synchronize_home else self.log_dir / "synchronize-home"
        self.env = synchronize_env(self.sync_home)
        self.writer = ArtifactWriter(self.log_dir)
        self.runner = CommandRunner(self.repo, self.env, self.writer)
        self.aoe = AoeController(self.profile, self.repo, self.runner, self.writer)
        self.tmux = TmuxController(self.runner, self.writer)
        self.rest = SyncRestClient(self.sync_home)
        self.agent_panes: dict[str, AgentPane] = {}
        self.cli_peers: dict[str, CliPeer] = {}
        self.aoe_session_ids: dict[str, str] = {}

    def run(self) -> None:
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self.sync_home.mkdir(parents=True, exist_ok=True)
        self.writer.write_json(
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
        require_tools(("aoe", "tmux", "bun", "uv"))
        require_libtmux("scripts/integration_tmux.py")
        versions: dict[str, str] = {}
        for tool, command in {
            "aoe": ["aoe", "--version"],
            "tmux": ["tmux", "-V"],
            "bun": ["bun", "--version"],
            "uv": ["uv", "--version"],
        }.items():
            result = self.runner.run(command, check=False)
            versions[tool] = (result.stdout or result.stderr).strip()
        self.writer.write_json("preflight.json", versions)

    def setup_aoe(self) -> None:
        shell_override = f"sh -c {shlex.quote('exec ' + self.args.shell)}"
        self.aoe.launch_sessions(
            self.agent_names,
            self.args.aoe_tool,
            {name: shell_override for name in self.agent_names},
        )
        self.aoe_session_ids = self.aoe.wait_for_sessions(self.agent_names, self.args.start_timeout, "test")
        self.aoe.collect_state("after-launch")

    def discover_tmux_panes(self) -> None:
        self.agent_panes = self.tmux.map_agent_panes(self.agent_names, self.aoe_session_ids)
        self.tmux.capture_all_panes("initial", self.agent_panes, lines=500)

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
        self.tmux.capture_all_panes("after-dm-smoke", self.agent_panes, lines=500)

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
        return self.tmux.send_shell_command(self.agent_panes[agent_name], command, self.args.command_timeout)

    def assert_rest_state(self, peer1: CliPeer, peer2: CliPeer, message: str) -> None:
        peers = self.rest.peers()
        peer_ids = {peer["peer_id"] for peer in peers.get("peers", [])}
        if peer1.peer_id not in peer_ids or peer2.peer_id not in peer_ids:
            raise HarnessError("REST /peers did not include both registered peers")

        events = self.rest.events(peer2.peer_id, cursor=0, limit=50)
        if not any(event.get("body") == message for event in events.get("events", [])):
            raise HarnessError("REST /events for recipient did not include the DM")

        inbox = self.rest.inbox(peer2.peer_id)
        if any(event.get("body") == message for event in inbox.get("events", [])):
            raise HarnessError("Recipient inbox still contains DM after inbox --ack")
        self.writer.write_json("rest-validation.json", {"peers": peers, "recipient_events": events, "recipient_inbox_after_ack": inbox})

    def collect_diagnostics(self, label: str) -> None:
        try:
            self.aoe.collect_state(label)
        except Exception as error:  # noqa: BLE001 - diagnostics must be best-effort
            self.writer.write_text(f"{label}-aoe-diagnostics-error.txt", str(error))
        try:
            if self.agent_panes:
                self.tmux.capture_all_panes(label, self.agent_panes, lines=500)
        except Exception as error:  # noqa: BLE001
            self.writer.write_text(f"{label}-pane-diagnostics-error.txt", str(error))
        try:
            if (self.sync_home / "daemon.json").exists():
                self.writer.write_json(f"{label}-sync-status.json", self.rest.status())
                self.writer.write_json(f"{label}-sync-peers.json", self.rest.peers())
        except Exception as error:  # noqa: BLE001
            self.writer.write_text(f"{label}-sync-diagnostics-error.txt", str(error))

    def cleanup(self) -> None:
        if shutil.which("aoe") is not None:
            self.aoe.cleanup(self.agent_names)
        stop_daemon(self.sync_home, self.writer)
        shutil.rmtree(self.sync_home, ignore_errors=True)


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


def main(argv: list[str], repo: Path) -> int:
    try:
        CliDmScenario(parse_args(argv), repo).run()
        return 0
    except HarnessError as error:
        print(f"FAIL {error}", file=sys.stderr)
        return 1
