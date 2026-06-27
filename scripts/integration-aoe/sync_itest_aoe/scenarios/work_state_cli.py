from __future__ import annotations

import argparse
import sqlite3
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .cli_dm import CliDmScenario, CliPeer, DEFAULT_AGENTS, DEFAULT_SHELL
from ..runtime import HarnessError


class CliWorkStateScenario(CliDmScenario):
    def __init__(self, args: argparse.Namespace, repo: Path) -> None:
        super().__init__(args, repo)
        if args.profile is None:
            self.profile = f"sync-work-state-itest-{self.run_id.lower()}"
            self.aoe.profile = self.profile

    def run_dm_smoke(self) -> None:
        planner_name, tester_name = self.agent_names[:2]
        planner = self.register_peer(planner_name)
        tester = self.register_peer(tester_name)
        self.cli_peers = {planner_name: planner, tester_name: tester}

        group_name = f"work-state-{self.run_id.lower()}"
        self.rest.create_group(group_name, creator_peer_id=planner.peer_id, description="work-state integration proof")
        self.rest.join_group(group_name, peer_id=planner.peer_id, alias="planner")
        self.rest.join_group(group_name, peer_id=tester.peer_id, alias="tester")

        planning_event = self.rest.send_group_message(
            group_name,
            sender_peer_id=planner.peer_id,
            message=f"planning handoff {self.run_id}",
        )["event"]

        planning = self.rest.set_work_state(
            peer_id=planner.peer_id,
            phase="planning",
            summary="Plan work-state relay scenario",
            scope={"kind": "group", "value": group_name},
            task="sync-08gl.5.1",
            trigger_event_id=int(planning_event["event_id"]),
            ttl_minutes=15,
        )
        self.assert_current_state(planning, planner.peer_id, "planning", "sync-08gl.5.1")
        self.assert_web_agent(planner.peer_id, "planning", "sync-08gl.5.1")

        peer_list_output = self.run_cli(tester_name, "peers", as_peer=tester)
        if "planning" not in peer_list_output or "sync-08gl.5.1" not in peer_list_output:
            raise HarnessError("Tester pane did not observe planner work state through CLI peer list")

        implementation = self.rest.set_work_state(
            peer_id=planner.peer_id,
            phase="implementation",
            summary="Implement work-state relay scenario",
            scope={"kind": "issue", "value": "sync-08gl.5.1"},
            task="sync-08gl.5.1",
            ttl_minutes=15,
        )
        self.assert_current_state(implementation, planner.peer_id, "implementation", "sync-08gl.5.1")
        self.assert_web_agent(planner.peer_id, "implementation", "sync-08gl.5.1")

        testing = self.rest.set_work_state(
            peer_id=tester.peer_id,
            phase="testing",
            summary="Verify work-state relay scenario",
            scope={"kind": "group", "value": group_name},
            task="sync-08gl.5.1",
            ttl_minutes=15,
        )
        self.assert_current_state(testing, tester.peer_id, "testing", "sync-08gl.5.1")
        self.assert_web_agent(tester.peer_id, "testing", "sync-08gl.5.1")

        self.assert_relay_state(planner, tester, planning_event)
        self.run_ttl_and_clear_checks(planner, tester)
        self.tmux.capture_all_panes("after-work-state-relay", self.agent_panes, lines=700)

    def assert_current_state(self, response: dict[str, object], peer_id: str, phase: str, task: str) -> None:
        peer = response.get("peer")
        state = response.get("work_state")
        if not isinstance(peer, dict) or peer.get("peer_id") != peer_id:
            raise HarnessError(f"Work-state response did not echo expected peer_id={peer_id}: {response}")
        if not isinstance(state, dict) or state.get("phase") != phase or state.get("task") != task:
            raise HarnessError(f"Work-state response did not show phase={phase} task={task}: {response}")
        if peer.get("activity_state") != "working":
            raise HarnessError(f"Work-state set did not mark peer working: {response}")

    def assert_web_agent(self, peer_id: str, phase: str, task: str) -> None:
        detail = self.rest.web_agents(peer_id)
        agents = detail.get("agents")
        if not isinstance(agents, list) or len(agents) != 1:
            raise HarnessError(f"/web/agents/{peer_id} did not return one agent: {detail}")
        state = agents[0].get("work_state")
        status = agents[0].get("work_state_status")
        if not isinstance(state, dict) or state.get("phase") != phase or state.get("task") != task:
            raise HarnessError(f"Web agent projection did not show phase={phase} task={task}: {detail}")
        if not isinstance(status, dict) or status.get("state") not in {"active", "near_expiry"}:
            raise HarnessError(f"Web agent projection did not show active-ish status: {detail}")

    def run_ttl_and_clear_checks(self, planner: CliPeer, tester: CliPeer) -> None:
        long_ttl = self.rest.web_agents(planner.peer_id)["agents"][0]
        if long_ttl.get("work_state", {}).get("phase") != "implementation":
            raise HarnessError(f"Planner long-TTL work state was not current before TTL checks: {long_ttl}")
        if long_ttl.get("work_state_status", {}).get("state") not in {"active", "near_expiry"}:
            raise HarnessError(f"Planner long-TTL work state was not active before TTL checks: {long_ttl}")

        generic = self.rest.set_work_state(
            peer_id=tester.peer_id,
            phase="analysis",
            summary="Analyze a generic, non-issue work item",
            scope={"kind": "custom", "value": "generic-followup"},
            task="generic follow-up",
            ttl_minutes=1,
        )
        self.assert_current_state(generic, tester.peer_id, "analysis", "generic follow-up")
        self.expire_current_work_state(tester.peer_id)
        expired = self.rest.web_agents(tester.peer_id)["agents"][0]
        if expired.get("work_state") is not None:
            raise HarnessError(f"Expired short-TTL work state was still current: {expired}")
        if expired.get("work_state_status", {}).get("state") != "stale":
            raise HarnessError(f"Expired short-TTL work state was not marked stale: {expired}")

        cleared = self.rest.set_work_state(peer_id=tester.peer_id, clear=True)
        if cleared.get("work_state") is not None:
            raise HarnessError(f"Clear did not return null current work state: {cleared}")
        tester_history = self.rest.work_state_history(tester.peer_id, limit=10)
        clear_rows = [entry for entry in tester_history.get("history", []) if entry.get("cleared_at")]
        generic_rows = [entry for entry in tester_history.get("history", []) if entry.get("task") == "generic follow-up"]
        if not clear_rows:
            raise HarnessError(f"Clear did not append a cleared history row: {tester_history}")
        if not generic_rows:
            raise HarnessError(f"Generic task history row was missing: {tester_history}")
        self.writer.write_json(
            "work-state-ttl-clear-validation.json",
            {
                "planner_long_ttl": long_ttl,
                "tester_expired": expired,
                "tester_clear_response": cleared,
                "tester_history": tester_history,
            },
        )

    def expire_current_work_state(self, peer_id: str) -> None:
        expires_at = (datetime.now(timezone.utc) - timedelta(seconds=5)).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        db_path = self.sync_home / "synchronize.db"
        if not db_path.exists():
            raise HarnessError(f"Cannot force work-state expiry; database is missing at {db_path}")
        with sqlite3.connect(db_path) as db:
            db.execute("UPDATE peers SET work_expires_at = ?, updated_at = ? WHERE peer_id = ?", (expires_at, expires_at, peer_id))
            db.commit()

    def assert_relay_state(self, planner: CliPeer, tester: CliPeer, planning_event: dict[str, object]) -> None:
        peers = self.rest.peers().get("peers", [])
        states = {
            peer.get("peer_id"): peer.get("work_state")
            for peer in peers
            if peer.get("peer_id") in {planner.peer_id, tester.peer_id}
        }
        if states.get(planner.peer_id, {}).get("phase") != "implementation":
            raise HarnessError(f"Planner did not remain in implementation state in /peers: {states}")
        if states.get(tester.peer_id, {}).get("phase") != "testing":
            raise HarnessError(f"Tester did not show testing state in /peers: {states}")

        history = self.rest.work_state_history(planner.peer_id, limit=10)
        phases = [entry.get("phase") for entry in history.get("history", [])]
        if phases[:2] != ["implementation", "planning"]:
            raise HarnessError(f"Planner work-state history was not newest-first implementation/planning: {history}")

        explicit = self.rest.work_state_history(
            planner.peer_id,
            event_id=int(planning_event["event_id"]),
            correlation="explicit",
        )
        explicit_history = explicit.get("history", [])
        if len(explicit_history) != 1 or explicit_history[0].get("trigger_event_id") != planning_event["event_id"]:
            raise HarnessError(f"Explicit trigger_event_id history query failed: {explicit}")

        inferred = self.rest.work_state_history(planner.peer_id, correlation="timestamp_inferred")
        inferred_history = inferred.get("history", [])
        if not inferred_history:
            raise HarnessError(f"Timestamp-inferred history query returned no rows: {inferred}")
        if inferred_history[0].get("inferred_event_id") != planning_event["event_id"]:
            raise HarnessError(f"Timestamp-inferred history did not label the inferred event: {inferred}")
        if inferred_history[0].get("trigger_event_id") is not None:
            raise HarnessError(f"Timestamp-inferred history mutated the stored trigger_event_id: {inferred}")

        self.writer.write_json(
            "work-state-relay-validation.json",
            {
                "planner": planner.__dict__,
                "tester": tester.__dict__,
                "peers": peers,
                "planner_history": history,
                "explicit_event_history": explicit,
                "timestamp_inferred_history": inferred,
                "web_agents": self.rest.web_agents(),
            },
        )


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run deterministic AoE/tmux work-state relay workflow tests.")
    parser.add_argument("--profile", help="AoE profile to create/use. Defaults to sync-work-state-itest-<timestamp>.")
    parser.add_argument("--run-id", help="Stable run id for reproducible names/logs.")
    parser.add_argument("--agents", type=int, default=DEFAULT_AGENTS, help="Number of AoE shell sessions to launch.")
    parser.add_argument("--agent-prefix", default="sync-work-agent", help="Prefix for test agent session titles.")
    parser.add_argument("--shell", default=DEFAULT_SHELL, help="Shell command AoE should run in each session.")
    parser.add_argument("--aoe-tool", default="claude", help="Supported AoE tool name to satisfy AoE validation before command override.")
    parser.add_argument("--synchronize-home", help="SYNCHRONIZE_HOME for the workflow. Defaults under the log directory.")
    parser.add_argument("--log-dir", help="Directory for run logs and diagnostics. Defaults to a temporary directory.")
    parser.add_argument("--keep", action="store_true", help="Preserve AoE sessions/profile and synchronize state for debugging.")
    parser.add_argument("--verbose", action="store_true", help="Currently reserved; logs are always written to --log-dir.")
    parser.add_argument("--start-timeout", type=int, default=60, help="Seconds to wait for AoE sessions to appear.")
    parser.add_argument("--command-timeout", type=int, default=30, help="Seconds to wait for each pane command to finish.")
    args = parser.parse_args(argv)
    if args.agents < 2:
        parser.error("--agents must be at least 2 for the work-state workflow")
    return args


def main(argv: list[str], repo: Path) -> int:
    try:
        CliWorkStateScenario(parse_args(argv), repo).run()
        return 0
    except HarnessError as error:
        print(f"FAIL {error}", file=sys.stderr)
        return 1
