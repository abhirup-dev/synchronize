from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .cli_dm import CliPeer
from .cli_dm import CliDmScenario, DEFAULT_AGENTS, DEFAULT_SHELL
from ..runtime import HarnessError


class CliGroupPolicyScenario(CliDmScenario):
    def __init__(self, args: argparse.Namespace, repo: Path) -> None:
        super().__init__(args, repo)
        if args.profile is None:
            self.profile = f"sync-groups-itest-{self.run_id.lower()}"
            self.aoe.profile = self.profile

    def run_dm_smoke(self) -> None:
        peers = self.register_group_policy_peers()
        self.run_identity_alias_description_workflow(peers)
        self.run_threads_mentions_inbox_workflow(peers)
        self.tmux.capture_all_panes("after-group-policy-cli", self.agent_panes, lines=700)

    def register_group_policy_peers(self) -> dict[str, CliPeer]:
        selected = self.agent_names[:3]
        peers = {name: self.register_peer(name) for name in selected}
        self.cli_peers = peers
        return peers

    def run_identity_alias_description_workflow(self, peers: dict[str, CliPeer]) -> None:
        agent1, agent2 = self.agent_names[0], self.agent_names[1]
        alice = peers[agent1]
        bob = peers[agent2]
        group_name = f"policy-{self.run_id.lower()}"

        self.run_cli(
            agent1,
            f"group create {group_name} --as {json_quote(alice.name)} --description {json_quote('initial topic')}",
            as_peer=alice,
        )
        self.assert_group_description(group_name, "initial topic")

        self.run_cli(agent1, f"group join {group_name} --as {json_quote(alice.name)} --alias alice", as_peer=alice)
        self.run_cli(agent2, f"group join {group_name} --as {json_quote(bob.name)} --alias bob", as_peer=bob)

        self.run_cli(agent1, f"group rename {group_name} lead --as {json_quote(alice.name)}", as_peer=alice)
        self.assert_active_alias(group_name, alice.peer_id, "lead")

        self.run_cli(agent1, f"group describe {group_name} {json_quote('updated topic')}", as_peer=alice)
        self.assert_group_description(group_name, "updated topic")
        self.run_cli(agent1, f"group describe {group_name} --clear", as_peer=alice)
        self.assert_group_description(group_name, None)

        self.run_cli(agent1, f"group leave {group_name} --as {json_quote(alice.name)}", as_peer=alice)
        self.run_cli(agent2, f"group join {group_name} --as {json_quote(bob.name)} --alias lead", as_peer=bob)
        self.assert_active_alias(group_name, bob.peer_id, "lead")

        self.assert_identity_alias_description_state(group_name, alice, bob)

    def get_group(self, group_name: str) -> dict[str, object]:
        groups = self.rest.list_groups()
        group = next((item for item in groups.get("groups", []) if item.get("name") == group_name), None)
        if not group:
            raise HarnessError(f"REST /groups did not include {group_name}")
        return group

    def assert_group_description(self, group_name: str, expected: str | None) -> None:
        actual = self.get_group(group_name).get("description")
        if actual != expected:
            raise HarnessError(f"REST /groups description mismatch: expected {expected!r}, got {actual!r}")

    def assert_active_alias(self, group_name: str, peer_id: str, expected_alias: str) -> None:
        peers = self.rest.group_peers(group_name)
        active_aliases = {item.get("peer_id"): item.get("alias") for item in peers.get("peers", [])}
        if active_aliases.get(peer_id) != expected_alias:
            raise HarnessError(f"REST group roster did not show {peer_id} holding alias {expected_alias!r}")

    def assert_identity_alias_description_state(self, group_name: str, alice: CliPeer, bob: CliPeer) -> None:
        group = self.get_group(group_name)
        if group.get("description") is not None:
            raise HarnessError("REST /groups did not show cleared group description")

        peers = self.rest.group_peers(group_name)
        active_aliases = {item.get("peer_id"): item.get("alias") for item in peers.get("peers", [])}
        if active_aliases.get(bob.peer_id) != "lead":
            raise HarnessError("REST group roster did not show Bob holding reclaimed alias 'lead'")
        if alice.peer_id in active_aliases:
            raise HarnessError("REST group roster still showed Alice as active after leave")

        history = self.rest.group_history(group_name, peer_id=bob.peer_id)
        events = history.get("events", [])
        rename_events = [event for event in events if event.get("type") == "group_member_renamed"]
        reclaim_events = [event for event in events if event.get("type") == "group_member_alias_reclaimed"]
        if len(rename_events) != 1:
            raise HarnessError(f"Expected exactly one group_member_renamed event, saw {len(rename_events)}")
        if len(reclaim_events) != 1:
            raise HarnessError(f"Expected exactly one group_member_alias_reclaimed event, saw {len(reclaim_events)}")
        reclaim_body = json.loads(str(reclaim_events[0].get("body") or "{}"))
        if reclaim_body.get("alias") != "lead" or reclaim_body.get("previous_peer_id") != alice.peer_id:
            raise HarnessError(f"Alias reclaim event body was not the expected audit payload: {reclaim_body}")

        self.writer.write_json(
            "group-policy-cli-identity-validation.json",
            {
                "group": group,
                "peers": peers,
                "history": history,
                "alice": alice.__dict__,
                "bob": bob.__dict__,
            },
        )

    def run_threads_mentions_inbox_workflow(self, peers: dict[str, CliPeer]) -> None:
        agent1, agent2, agent3 = self.agent_names[:3]
        alice = peers[agent1]
        bob = peers[agent2]
        carol = peers[agent3]
        group_name = f"threads-{self.run_id.lower()}"

        self.run_cli(agent1, f"group create {group_name} --as {json_quote(alice.name)}", as_peer=alice)
        self.run_cli(agent1, f"group join {group_name} --as {json_quote(alice.name)} --alias alice", as_peer=alice)
        self.run_cli(agent2, f"group join {group_name} --as {json_quote(bob.name)} --alias bob", as_peer=bob)
        self.run_cli(agent3, f"group join {group_name} --as {json_quote(carol.name)} --alias carol", as_peer=carol)

        root_body = f"root {self.run_id}"
        reply1_body = f"reply one {self.run_id}"
        reply2_body = f"reply two {self.run_id}"
        mention_body = f"mention {self.run_id} @bob and @ghost"

        self.run_cli(agent1, f"group send {group_name} {json_quote(root_body)} --as {json_quote(alice.name)}", as_peer=alice)
        root_event = self.find_group_message(group_name, alice.peer_id, root_body)

        self.run_cli(
            agent2,
            f"group send {group_name} {json_quote(reply1_body)} --as {json_quote(bob.name)} --in-reply-to {root_event['event_id']}",
            as_peer=bob,
        )
        reply1_event = self.find_group_message(group_name, alice.peer_id, reply1_body)

        self.run_cli(
            agent3,
            f"group send {group_name} {json_quote(reply2_body)} --as {json_quote(carol.name)} --in-reply-to {reply1_event['event_id']}",
            as_peer=carol,
        )
        reply2_event = self.find_group_message(group_name, alice.peer_id, reply2_body)

        self.run_cli(agent1, f"group send {group_name} {json_quote(mention_body)} --as {json_quote(alice.name)}", as_peer=alice)
        mention_event = self.find_group_message(group_name, bob.peer_id, mention_body)

        warning_probe = self.rest.send_group_message(
            group_name,
            sender_peer_id=alice.peer_id,
            message=f"warning probe {self.run_id} @bob @ghost",
        )
        if warning_probe.get("warnings") != [{"token": "@ghost", "reason": "alias_not_in_group"}]:
            raise HarnessError(f"REST warning probe did not expose expected unresolved mention warning: {warning_probe}")

        self.assert_thread_state(group_name, alice, bob, carol, root_event, reply1_event, reply2_event)
        self.assert_mention_and_inbox_state(group_name, alice, bob, carol, mention_event)

    def find_group_message(self, group_name: str, observer_peer_id: str, body: str) -> dict[str, object]:
        events = self.rest.group_history(group_name, peer_id=observer_peer_id, limit=200).get("events", [])
        matches = [event for event in events if event.get("type") == "group_message" and event.get("body") == body]
        if not matches:
            for event in self.rest.events(observer_peer_id, cursor=0, limit=200).get("events", []):
                if event.get("type") == "group_message" and event.get("body") == body:
                    return event
            raise HarnessError(f"Could not find group_message body={body!r} for observer={observer_peer_id}")
        return matches[-1]

    def assert_thread_state(
        self,
        group_name: str,
        alice: CliPeer,
        bob: CliPeer,
        carol: CliPeer,
        root_event: dict[str, object],
        reply1_event: dict[str, object],
        reply2_event: dict[str, object],
    ) -> None:
        root_id = int(root_event["event_id"])
        if root_event.get("parent_event_id") is not None:
            raise HarnessError("Root group message unexpectedly had parent_event_id")
        if reply1_event.get("parent_event_id") != root_id:
            raise HarnessError("First thread reply did not point at the root event")
        if reply2_event.get("parent_event_id") != root_id:
            raise HarnessError("Reply-to-reply did not collapse to the root event")

        main_history = self.rest.group_history(group_name, peer_id=alice.peer_id, limit=200)
        main_messages = [event for event in main_history.get("events", []) if event.get("type") == "group_message"]
        if any(event.get("event_id") in {reply1_event.get("event_id"), reply2_event.get("event_id")} for event in main_messages):
            raise HarnessError("Default group history included thread replies")

        thread_history = self.rest.group_history(group_name, peer_id=bob.peer_id, thread_of=root_id, limit=200)
        thread_message_ids = [
            event.get("event_id")
            for event in thread_history.get("events", [])
            if event.get("type") == "group_message"
        ]
        expected = [root_event.get("event_id"), reply1_event.get("event_id"), reply2_event.get("event_id")]
        if thread_message_ids != expected:
            raise HarnessError(f"Thread history mismatch: expected {expected}, got {thread_message_ids}")

        self.writer.write_json(
            "group-policy-cli-thread-validation.json",
            {
                "alice": alice.__dict__,
                "bob": bob.__dict__,
                "carol": carol.__dict__,
                "root_event": root_event,
                "reply1_event": reply1_event,
                "reply2_event": reply2_event,
                "main_history": main_history,
                "thread_history": thread_history,
            },
        )

    def assert_mention_and_inbox_state(
        self,
        group_name: str,
        alice: CliPeer,
        bob: CliPeer,
        carol: CliPeer,
        mention_event: dict[str, object],
    ) -> None:
        if mention_event.get("mentions_json") != json.dumps([bob.peer_id]):
            raise HarnessError(f"Mention event did not resolve only Bob's peer_id: {mention_event}")

        bob_messages = self.group_message_bodies_from_inbox(bob.peer_id)
        carol_messages = self.group_message_bodies_from_inbox(carol.peer_id)
        alice_messages = self.group_message_bodies_from_inbox(alice.peer_id)
        mention_body = str(mention_event.get("body"))
        if mention_body not in bob_messages or mention_body not in carol_messages:
            raise HarnessError("Mention message was not durable-delivered to all non-sender active members")
        if mention_body in alice_messages:
            raise HarnessError("Sender inbox unexpectedly contained its own group message")

        roster_types = [event.get("type") for event in self.rest.inbox(bob.peer_id).get("events", [])]
        if "group_joined" not in roster_types:
            raise HarnessError("Bob's inbox did not include roster events for durable visibility")

        self.writer.write_json(
            "group-policy-cli-mention-inbox-validation.json",
            {
                "group": group_name,
                "mention_event": mention_event,
                "bob_inbox": self.rest.inbox(bob.peer_id),
                "carol_inbox": self.rest.inbox(carol.peer_id),
                "alice_inbox": self.rest.inbox(alice.peer_id),
            },
        )

    def group_message_bodies_from_inbox(self, peer_id: str) -> list[str]:
        return [
            str(event.get("body"))
            for event in self.rest.inbox(peer_id).get("events", [])
            if event.get("type") == "group_message"
        ]


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run deterministic AoE/tmux group-policy workflow tests.")
    parser.add_argument("--profile", help="AoE profile to create/use. Defaults to sync-groups-itest-<timestamp>.")
    parser.add_argument("--run-id", help="Stable run id for reproducible names/logs.")
    parser.add_argument("--agents", type=int, default=DEFAULT_AGENTS, help="Number of AoE shell sessions to launch.")
    parser.add_argument("--agent-prefix", default="sync-group-agent", help="Prefix for test agent session titles.")
    parser.add_argument("--shell", default=DEFAULT_SHELL, help="Shell command AoE should run in each session.")
    parser.add_argument("--aoe-tool", default="claude", help="Supported AoE tool name to satisfy AoE validation before command override.")
    parser.add_argument("--synchronize-home", help="SYNCHRONIZE_HOME for the workflow. Defaults under the log directory.")
    parser.add_argument("--log-dir", help="Directory for run logs and diagnostics. Defaults to a temporary directory.")
    parser.add_argument("--keep", action="store_true", help="Preserve AoE sessions/profile and synchronize state for debugging.")
    parser.add_argument("--verbose", action="store_true", help="Currently reserved; logs are always written to --log-dir.")
    parser.add_argument("--start-timeout", type=int, default=60, help="Seconds to wait for AoE sessions to appear.")
    parser.add_argument("--command-timeout", type=int, default=30, help="Seconds to wait for each pane command to finish.")
    args = parser.parse_args(argv)
    if args.agents < 3:
        parser.error("--agents must be at least 3 for the group-policy workflow")
    return args


def json_quote(value: str) -> str:
    import shlex

    return shlex.quote(value)


def main(argv: list[str], repo: Path) -> int:
    try:
        CliGroupPolicyScenario(parse_args(argv), repo).run()
        return 0
    except HarnessError as error:
        print(f"FAIL {error}", file=sys.stderr)
        return 1
