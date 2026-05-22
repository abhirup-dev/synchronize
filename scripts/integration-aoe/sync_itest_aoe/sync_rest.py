from __future__ import annotations

import json
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from .runtime import HarnessError


class SyncRestClient:
    def __init__(self, sync_home: Path) -> None:
        self.sync_home = sync_home

    def read_discovery(self) -> dict[str, Any]:
        path = self.sync_home / "daemon.json"
        if not path.exists():
            raise HarnessError(f"synchronize discovery file missing: {path}")
        return json.loads(path.read_text())

    def base_url(self) -> str:
        return str(self.read_discovery()["baseUrl"])

    def http_json(self, path: str) -> dict[str, Any]:
        try:
            with urllib.request.urlopen(f"{self.base_url()}{path}", timeout=5) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8", errors="replace")
            raise HarnessError(f"HTTP {error.code} for {path}: {body}") from error
        except urllib.error.URLError as error:
            raise HarnessError(f"HTTP request failed for {path}: {error}") from error

    def status(self) -> dict[str, Any]:
        return self.http_json("/status")

    def peers(self) -> dict[str, Any]:
        return self.http_json("/peers")

    def events(self, peer_id: str, *, cursor: int = 0, limit: int = 100) -> dict[str, Any]:
        return self.http_json(f"/events/{peer_id}?cursor={cursor}&limit={limit}")

    def inbox(self, peer_id: str) -> dict[str, Any]:
        return self.http_json(f"/peers/{peer_id}/inbox")

    def agent_sessions(self, tool: str) -> dict[str, Any]:
        return self.http_json(f"/agent-sessions?tool={tool}")

