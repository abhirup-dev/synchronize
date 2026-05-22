from __future__ import annotations

import json
import urllib.parse
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

    def http_json(self, path: str, *, method: str = "GET", body: dict[str, Any] | None = None) -> dict[str, Any]:
        data = None
        headers: dict[str, str] = {}
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["content-type"] = "application/json"
        request = urllib.request.Request(f"{self.base_url()}{path}", data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8", errors="replace")
            raise HarnessError(f"HTTP {error.code} {method} {path}: {body}") from error
        except urllib.error.URLError as error:
            raise HarnessError(f"HTTP request failed for {method} {path}: {error}") from error

    def status(self) -> dict[str, Any]:
        return self.http_json("/status")

    def peers(self) -> dict[str, Any]:
        return self.http_json("/peers")

    def group_peers(self, name: str) -> dict[str, Any]:
        return self.http_json(f"/peers?group={url_quote(name)}")

    def events(self, peer_id: str, *, cursor: int = 0, limit: int = 100) -> dict[str, Any]:
        return self.http_json(f"/events/{peer_id}?cursor={cursor}&limit={limit}")

    def inbox(self, peer_id: str) -> dict[str, Any]:
        return self.http_json(f"/peers/{peer_id}/inbox")

    def agent_sessions(self, tool: str) -> dict[str, Any]:
        return self.http_json(f"/agent-sessions?tool={url_quote(tool)}")

    def list_groups(self) -> dict[str, Any]:
        return self.http_json("/groups")

    def create_group(
        self,
        name: str,
        *,
        creator_peer_id: str | None = None,
        ephemeral: bool = False,
        description: str | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"name": name, "ephemeral": ephemeral}
        if creator_peer_id is not None:
            body["creator_peer_id"] = creator_peer_id
        if description is not None:
            body["description"] = description
        return self.http_json("/groups", method="POST", body=body)

    def patch_group(self, name: str, *, description: str | None) -> dict[str, Any]:
        return self.http_json(f"/groups/{url_quote(name)}", method="PATCH", body={"description": description})

    def join_group(self, name: str, *, peer_id: str, alias: str | None = None, fresh: bool = False) -> dict[str, Any]:
        body: dict[str, Any] = {"peer_id": peer_id, "fresh": fresh}
        if alias is not None:
            body["alias"] = alias
        return self.http_json(f"/groups/{url_quote(name)}/join", method="POST", body=body)

    def leave_group(self, name: str, *, peer_id: str) -> dict[str, Any]:
        return self.http_json(f"/groups/{url_quote(name)}/leave", method="POST", body={"peer_id": peer_id})

    def rename_in_group(self, name: str, *, peer_id: str, new_alias: str) -> dict[str, Any]:
        return self.http_json(
            f"/groups/{url_quote(name)}/rename",
            method="POST",
            body={"peer_id": peer_id, "new_alias": new_alias},
        )

    def send_group_message(
        self,
        name: str,
        *,
        sender_peer_id: str,
        message: str,
        in_reply_to: int | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"sender_peer_id": sender_peer_id, "message": message}
        if in_reply_to is not None:
            body["in_reply_to"] = in_reply_to
        return self.http_json(f"/groups/{url_quote(name)}/messages", method="POST", body=body)

    def group_history(
        self,
        name: str,
        *,
        peer_id: str,
        thread_of: int | None = None,
        cursor: int = 0,
        limit: int = 100,
    ) -> dict[str, Any]:
        params = {"peer_id": peer_id, "cursor": str(cursor), "limit": str(limit)}
        if thread_of is not None:
            params["thread_of"] = str(thread_of)
        return self.http_json(f"/groups/{url_quote(name)}/history?{urllib.parse.urlencode(params)}")


def url_quote(value: str) -> str:
    return urllib.parse.quote(value, safe="")
