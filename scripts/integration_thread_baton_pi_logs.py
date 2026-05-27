# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "libtmux>=0.46",
# ]
# ///
"""Stable entrypoint for real Pi/AoE/tmux thread-baton tests with PI JSONL assertions."""

from __future__ import annotations

import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
REPO = SCRIPT_DIR.parent
sys.path.insert(0, str(SCRIPT_DIR / "integration-aoe"))

from sync_itest_aoe.scenarios.pi_mcp_thread_baton_logs import main  # noqa: E402


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:], REPO))
