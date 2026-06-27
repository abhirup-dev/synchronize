from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from session_annotation.claude import ClaudeSessionAnnotator


def json_line(value: dict[str, object]) -> str:
    return json.dumps(value, separators=(",", ":")) + "\n"


class ClaudeSessionAnnotationTest(unittest.TestCase):
    def test_annotates_claude_session_shapes(self) -> None:
        with tempfile.TemporaryDirectory(prefix="claude-session-annotation-") as tmp:
            path = Path(tmp) / "session.jsonl"
            path.write_text(
                json_line({"type": "agent-setting", "agentSetting": "claude", "sessionId": "s1"})
                + json_line(
                    {
                        "type": "attachment",
                        "sessionId": "s1",
                        "uuid": "a1",
                        "timestamp": "2026-01-01T00:00:00.000Z",
                        "attachment": {
                            "type": "queued_command",
                            "prompt": '<channel source="synchronize" event_id="42" type="group_message" sender_peer_id="peer-a" group_id="g1" sent_at="now">hello bus</channel>',
                            "origin": {"kind": "channel", "server": "synchronize"},
                        },
                    }
                )
                + json_line(
                    {
                        "type": "assistant",
                        "sessionId": "s1",
                        "uuid": "m1",
                        "timestamp": "2026-01-01T00:00:01.000Z",
                        "message": {
                            "role": "assistant",
                            "model": "claude-opus",
                            "content": [
                                {"type": "thinking", "thinking": "Need to inspect.", "signature": "sig"},
                                {"type": "tool_use", "id": "toolu-1", "name": "mcp__synchronize__bridge_whoami", "input": {}},
                                {"type": "tool_use", "id": "toolu-2", "name": "Bash", "input": {"command": "pwd"}},
                            ],
                            "stop_reason": "tool_use",
                        },
                    }
                )
                + json_line(
                    {
                        "type": "user",
                        "sessionId": "s1",
                        "uuid": "m2",
                        "parentUuid": "m1",
                        "timestamp": "2026-01-01T00:00:02.000Z",
                        "message": {
                            "role": "user",
                            "content": [
                                {"type": "tool_result", "tool_use_id": "toolu-1", "content": '{"registered":true}', "is_error": False},
                                {"type": "tool_result", "tool_use_id": "toolu-2", "content": "/repo", "is_error": False},
                            ],
                        },
                    }
                )
                + json_line(
                    {
                        "type": "system",
                        "sessionId": "s1",
                        "subtype": "stop_hook_summary",
                        "hookCount": 2,
                        "hookErrors": [],
                    }
                ),
                encoding="utf-8",
            )

            report = ClaudeSessionAnnotator().annotate_file(path)
            annotations = report.annotations

            self.assertEqual(report.diagnostics, [])
            self.assertTrue(any(item.kind == "agent_setting" for item in annotations))
            self.assertTrue(any(item.kind == "synchronize_channel" and item.data["event_id"] == 42 for item in annotations))
            self.assertTrue(any(item.kind == "assistant_thinking" for item in annotations))
            self.assertTrue(any(item.kind == "synchronize_mcp_tool_call" and item.normalized_tool == "bridge_whoami" for item in annotations))
            self.assertTrue(any(item.kind == "mcp_tool_result" and item.normalized_tool == "bridge_whoami" for item in annotations))
            self.assertTrue(any(item.kind == "shell_tool_call" and item.tool == "Bash" for item in annotations))
            self.assertTrue(any(item.kind == "tool_result" and item.tool == "Bash" for item in annotations))
            self.assertTrue(any(item.kind == "system_stop_hook_summary" for item in annotations))


if __name__ == "__main__":
    unittest.main()
