from __future__ import annotations

import unittest
from datetime import datetime, timezone
from pathlib import Path

from sync_itest_aoe.scenarios.pi_mcp_dm import PiMcpDmScenario, select_current_pi_bindings


class PiMappingTest(unittest.TestCase):
    def test_maps_agent_session_bindings_by_session_name_without_pane_text(self) -> None:
        scenario = PiMcpDmScenario.__new__(PiMcpDmScenario)
        scenario.agent_names = ["sync-pi-agent-1", "sync-pi-agent-2"]
        scenario.agent_panes = {}

        mapped = scenario.map_bindings_to_agents(
            [
                {
                    "peer": {"session_name": "sync-pi-agent-1"},
                    "peer_id": "new-peer-1",
                    "host_session_id": "new-host-1",
                },
                {
                    "peer": {"session_name": "sync-pi-agent-1"},
                    "peer_id": "old-peer-1",
                    "host_session_id": "old-host-1",
                },
                {
                    "peer": {"session_name": "sync-pi-agent-2"},
                    "peer_id": "peer-2",
                    "host_session_id": "host-2",
                },
            ]
        )

        self.assertEqual(set(mapped), {"sync-pi-agent-1", "sync-pi-agent-2"})
        self.assertEqual(mapped["sync-pi-agent-1"].peer_id, "new-peer-1")
        self.assertEqual(mapped["sync-pi-agent-1"].host_session_id, "new-host-1")
        self.assertEqual(mapped["sync-pi-agent-2"].host_session_id, "host-2")

    def test_filters_agent_session_bindings_to_current_run(self) -> None:
        selected = select_current_pi_bindings(
            [
                {
                    "cwd": "/tmp/repo",
                    "host_tool": "pi",
                    "created_at": "2026-06-05T21:00:00.000Z",
                    "peer": {"session_name": "sync-pi-agent-1"},
                },
                {
                    "cwd": "/tmp/repo",
                    "host_tool": "pi",
                    "created_at": "2026-06-05T21:05:00.000Z",
                    "peer": {"session_name": "sync-pi-agent-1"},
                },
                {
                    "cwd": "/tmp/other",
                    "host_tool": "pi",
                    "created_at": "2026-06-05T21:06:00.000Z",
                },
            ],
            Path("/tmp/repo"),
            datetime(2026, 6, 5, 21, 2, tzinfo=timezone.utc),
        )

        self.assertEqual(len(selected), 1)
        self.assertEqual(selected[0]["created_at"], "2026-06-05T21:05:00.000Z")


if __name__ == "__main__":
    unittest.main()
