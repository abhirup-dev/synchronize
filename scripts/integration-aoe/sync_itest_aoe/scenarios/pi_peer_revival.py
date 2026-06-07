from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

from ..runtime import HarnessError
from .pi_mcp_dm import DEFAULT_MODEL, DEFAULT_PROVIDER, DEFAULT_THINKING, PiMcpDmScenario

# Real-Pi end-to-end check for the peer-revival recovery path (sync-3nu).
#
# Launches one real Pi agent, lets the pi-synchronize extension auto-register,
# then soft-deletes that peer over REST (the deterministic equivalent of a
# retention sweep / operator evict). With a short Pi heartbeat, the extension's
# next heartbeat 404s and must recover: re-register the same peer_id AND rebuild
# the event subscription. We assert recovery via REST (peer reappears online),
# via the extension log ("recovered peer"), and — the part only a real Pi proves
# — that a DM sent AFTER recovery is pushed to the rebuilt subscription and
# injected into the agent (the subscription was actually re-established, not just
# the row resurrected).

DEFAULT_PI_HEARTBEAT_MS = 4000


class PiPeerRevivalScenario(PiMcpDmScenario):
    def run(self) -> None:
        # Must be set before command_for_session builds the Pi launch command.
        os.environ["SYNCHRONIZE_PI_HEARTBEAT_MS"] = str(self.args.pi_heartbeat_ms)
        self.cleanup_dirty_state_before_run()
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
                "sync_home": str(self.sync_home),
                "pi_heartbeat_ms": self.args.pi_heartbeat_ms,
                "scenario": "pi_peer_revival",
                "keep": self.args.keep,
            },
        )
        try:
            self.preflight()
            self.pi_env.provision()
            self.install_pi_packages()
            self.start_daemon()
            self.setup_aoe()
            self.discover_tmux_panes()
            self.wait_for_pi_registration()
            self.warm_up_pi_agents()
            self.run_revival_check()
            self.collect_diagnostics("success")
            print(f"PASS real Pi peer-revival smoke run_id={self.run_id} log_dir={self.run_dir}")
        except BaseException:
            self.collect_diagnostics("failure")
            raise
        finally:
            if self.args.keep:
                self.prepare_kept_sessions_for_inspection()
                print(f"KEEP enabled: AoE profile '{self.profile}' and run state remain at {self.run_dir}")
            else:
                self.cleanup()

    def extension_log_text(self) -> str:
        log_path = self.sync_home / "pi-extension.log"
        if not log_path.exists():
            return ""
        return log_path.read_text(encoding="utf-8", errors="replace")

    def peer_online(self, peer_id: str) -> bool:
        peers = self.rest.peers().get("peers", [])
        for peer in peers:
            if peer.get("peer_id") == peer_id:
                return bool(peer.get("online"))
        return False

    def peer_present(self, peer_id: str) -> bool:
        return any(p.get("peer_id") == peer_id for p in self.rest.peers().get("peers", []))

    def run_revival_check(self) -> None:
        agent_name = self.agent_names[0]
        peer = self.pi_peers[agent_name]
        peer_id = peer.peer_id

        if not self.peer_online(peer_id):
            raise HarnessError(f"Pi peer {peer_id} was not online before the revival check")

        # Soft-delete the peer (operator evict == sweep DB effect): hidden + subscriber dropped.
        self.rest.http_json(f"/peers/{peer_id}", method="DELETE")
        self.writer.write_json("after-delete-peers.json", self.rest.peers())
        if self.peer_present(peer_id):
            # Recovery may already have raced us; only fail if it never left at all
            # AND never logs recovery. We still require the recovery log below.
            self.writer.write_text("delete-note.txt", "peer still present immediately after delete (recovery may have raced)")

        # Recovery: the extension's next heartbeat 404s, re-registers the same
        # peer_id, and rebuilds the subscription.
        recovery_deadline = time.time() + self.args.recovery_timeout
        recovered = False
        while time.time() < recovery_deadline:
            if self.peer_online(peer_id) and "recovered peer" in self.extension_log_text():
                recovered = True
                break
            time.sleep(1)
        self.writer.write_text("extension-log-after-recovery.txt", self.extension_log_text()[-20000:])
        self.writer.write_json("after-recovery-peers.json", self.rest.peers())
        if not recovered:
            raise HarnessError(
                f"Pi peer {peer_id} did not recover (online + 'recovered peer' log) within {self.args.recovery_timeout}s"
            )

        # Re-subscribe proof: a DM sent AFTER recovery must push to the rebuilt
        # subscription and be received by the extension. Send from a synthetic
        # REST-registered sender and look for the marker in the extension log's
        # "event received" line (the extension only logs that on a pushed event).
        sender = self.rest.http_json(
            "/peers/register", method="POST", body={"session_name": "revival-sender", "tool": "cli"}
        )["peer"]["peer_id"]
        marker = f"PI_REVIVAL_DM_{self.run_id}"
        self.rest.http_json(
            "/dm", method="POST", body={"sender_peer_id": sender, "recipient_peer_id": peer_id, "message": marker}
        )
        push_deadline = time.time() + self.args.command_timeout
        delivered = False
        while time.time() < push_deadline:
            if marker in self.extension_log_text():
                delivered = True
                break
            time.sleep(1)
        self.writer.write_text("extension-log-after-dm.txt", self.extension_log_text()[-20000:])
        if not delivered:
            raise HarnessError(
                f"DM marker {marker} was not pushed to the recovered peer's subscription within {self.args.command_timeout}s"
                " — re-subscribe on recovery likely failed"
            )
        self.tmux.capture_all_panes("after-revival", self.agent_panes, lines=700)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Real Pi peer-revival (sweep -> recover) AoE smoke.")
    parser.add_argument("--profile")
    parser.add_argument("--run-id")
    parser.add_argument("--state-dir")
    parser.add_argument("--run-dir")
    parser.add_argument("--agents", type=int, default=1, help="Pi sessions to launch (revival needs only 1).")
    parser.add_argument("--agent-prefix", default="sync-pi-revival")
    parser.add_argument("--provider", default=DEFAULT_PROVIDER)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--thinking", default=DEFAULT_THINKING)
    parser.add_argument("--auth-source")
    parser.add_argument("--keep", action="store_true")
    parser.add_argument("--pi-heartbeat-ms", type=int, default=DEFAULT_PI_HEARTBEAT_MS)
    parser.add_argument("--start-timeout", type=int, default=90)
    parser.add_argument("--registration-timeout", type=int, default=90)
    parser.add_argument("--warmup-timeout", type=int, default=90)
    parser.add_argument("--recovery-timeout", type=int, default=45)
    parser.add_argument("--command-timeout", type=int, default=60)
    args = parser.parse_args(argv)
    if args.agents < 1:
        parser.error("--agents must be at least 1")
    return args


def main(argv: list[str], repo: Path) -> int:
    try:
        PiPeerRevivalScenario(parse_args(argv), repo).run()
        return 0
    except HarnessError as error:
        print(f"FAIL {error}", file=sys.stderr)
        return 1
