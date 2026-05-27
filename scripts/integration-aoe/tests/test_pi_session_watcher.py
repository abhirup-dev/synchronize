from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from sync_itest_aoe.pi_session.watcher import PiSessionWatcher, PiSessionWatcherRegistry
from sync_itest_aoe.queries.pi_session import (
    forbidden_tool_calls,
    has_assistant_marker,
    has_pushed_event,
    has_tool_call,
)


def json_line(value: dict[str, object]) -> str:
    return json.dumps(value, separators=(",", ":")) + "\n"


class PiSessionWatcherTest(unittest.TestCase):
    def test_watcher_extracts_general_events(self) -> None:
        with tempfile.TemporaryDirectory(prefix="pi-session-watcher-") as tmp:
            path = Path(tmp) / "session-abc.jsonl"
            path.write_text(
                json_line({"type": "session", "version": 3, "id": "abc", "timestamp": "2026-01-01T00:00:00.000Z", "cwd": "/repo"})
                + json_line(
                    {
                        "type": "message",
                        "id": "m1",
                        "parentId": None,
                        "message": {
                            "role": "assistant",
                            "content": [
                                {"type": "text", "text": "BATON_ALPHA_SENT"},
                                {"type": "toolCall", "id": "call-1", "name": "bridge_send_group", "arguments": {"name": "g"}},
                            ],
                        },
                    }
                )
                + json_line(
                    {
                        "type": "message",
                        "id": "m2",
                        "parentId": "m1",
                        "message": {
                            "role": "toolResult",
                            "toolName": "bridge_send_group",
                            "isError": False,
                            "content": [{"type": "text", "text": "ok"}],
                            "details": {"event_id": 123},
                        },
                    }
                )
                + json_line(
                    {
                        "type": "message",
                        "id": "m3",
                        "parentId": "m2",
                        "message": {
                            "role": "user",
                            "content": '<synchronize_event type="group_message" event_id="123" group_id="g1" sent_at="now">\nBATON BODY\n</synchronize_event>',
                        },
                    }
                ),
                encoding="utf-8",
            )

            state = PiSessionWatcher(path).refresh()

            self.assertEqual(state.metadata.session_id if state.metadata else None, "abc")
            self.assertTrue(has_assistant_marker(state, "BATON_ALPHA_SENT"))
            self.assertTrue(has_tool_call(state, "bridge_send_group"))
            self.assertEqual(len(state.tool_results), 1)
            self.assertTrue(has_pushed_event(state, event_id=123, event_type="group_message", body="BATON BODY"))

    def test_watcher_updates_incrementally_and_tolerates_partial_trailing_line(self) -> None:
        with tempfile.TemporaryDirectory(prefix="pi-session-watcher-") as tmp:
            path = Path(tmp) / "session-abc.jsonl"
            path.write_text(json_line({"type": "session", "version": 3, "id": "abc"}), encoding="utf-8")
            watcher = PiSessionWatcher(path)

            state = watcher.refresh()
            self.assertEqual(state.metadata.session_id if state.metadata else None, "abc")

            with path.open("a", encoding="utf-8") as handle:
                handle.write('{"type":"message","id":"m1","message":{"role":"assistant","content":"')
            state = watcher.refresh()
            self.assertFalse(has_assistant_marker(state, "READY"))
            self.assertEqual(state.diagnostics, [])

            with path.open("a", encoding="utf-8") as handle:
                handle.write('READY"}}\n')
            state = watcher.refresh()
            self.assertTrue(has_assistant_marker(state, "READY"))

    def test_watcher_records_malformed_complete_lines(self) -> None:
        with tempfile.TemporaryDirectory(prefix="pi-session-watcher-") as tmp:
            path = Path(tmp) / "session-abc.jsonl"
            path.write_text('{"type":"session","id":"abc"}\n{"broken":\n', encoding="utf-8")

            state = PiSessionWatcher(path).refresh()

            self.assertEqual(len(state.diagnostics), 1)
            self.assertIn("JSON parse error", state.diagnostics[0].message)

    def test_details_mode_call_and_forbidden_queries(self) -> None:
        with tempfile.TemporaryDirectory(prefix="pi-session-watcher-") as tmp:
            path = Path(tmp) / "session-abc.jsonl"
            path.write_text(
                json_line({"type": "session", "version": 3, "id": "abc"})
                + json_line(
                    {
                        "type": "message",
                        "id": "m1",
                        "message": {
                            "role": "custom",
                            "details": {"mode": "call", "tool": "bridge_group_history", "arguments": {"name": "g"}},
                            "content": "tool call",
                        },
                    }
                ),
                encoding="utf-8",
            )

            state = PiSessionWatcher(path).refresh()

            self.assertTrue(has_tool_call(state, "bridge_group_history"))
            self.assertEqual([event.tool for event in forbidden_tool_calls(state, ["bridge_group_history"])], ["bridge_group_history"])

    def test_registry_maps_agent_names_to_watchers(self) -> None:
        with tempfile.TemporaryDirectory(prefix="pi-session-watcher-") as tmp:
            root = Path(tmp)
            nested = root / "repo"
            nested.mkdir()
            (nested / "20260101_host-alpha.jsonl").write_text(
                json_line({"type": "session", "version": 3, "id": "host-alpha"})
                + json_line({"type": "message", "id": "m1", "message": {"role": "assistant", "content": "ALPHA_READY"}}),
                encoding="utf-8",
            )
            registry = PiSessionWatcherRegistry(
                root,
                [{"session_name": "alpha", "host_session_id": "host-alpha", "peer_id": "peer-alpha"}],
            )

            registry.wait_for_agents(["alpha"], timeout=1)

            self.assertTrue(has_assistant_marker(registry.watcher_for("alpha").state, "ALPHA_READY"))
            self.assertEqual(list(registry.summaries()), ["alpha"])

    def test_registry_creates_expected_watcher_before_file_exists(self) -> None:
        with tempfile.TemporaryDirectory(prefix="pi-session-watcher-") as tmp:
            root = Path(tmp)
            registry = PiSessionWatcherRegistry(
                root,
                [{"host_session_id": "host-alpha", "peer_id": "peer-alpha", "peer": {"session_name": "alpha"}}],
            )

            registry.wait_for_agents(["alpha"], timeout=1)
            self.assertEqual(registry.watcher_for("alpha").path, root / "host-alpha.jsonl")

            (root / "host-alpha.jsonl").write_text(
                json_line({"type": "session", "version": 3, "id": "host-alpha"})
                + json_line({"type": "message", "id": "m1", "message": {"role": "assistant", "content": "ALPHA_READY"}}),
                encoding="utf-8",
            )

            registry.refresh()
            self.assertTrue(has_assistant_marker(registry.watcher_for("alpha").state, "ALPHA_READY"))

    def test_registry_rebinds_expected_path_to_timestamp_prefixed_session_file(self) -> None:
        with tempfile.TemporaryDirectory(prefix="pi-session-watcher-") as tmp:
            root = Path(tmp)
            registry = PiSessionWatcherRegistry(
                root,
                [{"host_session_id": "host-alpha", "peer_id": "peer-alpha", "peer": {"session_name": "alpha"}}],
            )
            registry.wait_for_agents(["alpha"], timeout=1)

            actual = root / "2026-01-01T00-00-00-000Z_host-alpha.jsonl"
            actual.write_text(
                json_line({"type": "session", "version": 3, "id": "host-alpha"})
                + json_line({"type": "message", "id": "m1", "message": {"role": "assistant", "content": "ALPHA_READY"}}),
                encoding="utf-8",
            )

            registry.refresh()
            self.assertEqual(registry.watcher_for("alpha").path, actual)
            self.assertTrue(has_assistant_marker(registry.watcher_for("alpha").state, "ALPHA_READY"))

    def test_wait_until_observes_rebound_watcher(self) -> None:
        with tempfile.TemporaryDirectory(prefix="pi-session-watcher-") as tmp:
            root = Path(tmp)
            registry = PiSessionWatcherRegistry(
                root,
                [{"host_session_id": "host-alpha", "peer_id": "peer-alpha", "peer": {"session_name": "alpha"}}],
            )
            registry.wait_for_agents(["alpha"], timeout=1)
            actual = root / "2026-01-01T00-00-00-000Z_host-alpha.jsonl"
            actual.write_text(
                json_line({"type": "session", "version": 3, "id": "host-alpha"})
                + json_line({"type": "message", "id": "m1", "message": {"role": "assistant", "content": "ALPHA_READY"}}),
                encoding="utf-8",
            )

            state = registry.wait_until("alpha", lambda current: has_assistant_marker(current, "ALPHA_READY"), timeout=1, label="ready")

            self.assertEqual(state.path, actual)


if __name__ == "__main__":
    unittest.main()
