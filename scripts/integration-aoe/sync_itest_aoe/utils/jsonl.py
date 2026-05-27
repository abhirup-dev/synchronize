from __future__ import annotations

import json
from pathlib import Path
from typing import Any


class JsonlTail:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._offset = 0
        self._pending = ""

    def read_complete_lines(self) -> list[str]:
        if not self.path.exists():
            return []
        with self.path.open("r", encoding="utf-8", errors="replace") as handle:
            handle.seek(self._offset)
            chunk = handle.read()
            self._offset = handle.tell()
        if not chunk:
            return []
        text = self._pending + chunk
        lines = text.splitlines(keepends=True)
        self._pending = ""
        if lines and not lines[-1].endswith(("\n", "\r")):
            self._pending = lines.pop()
        return [line.rstrip("\r\n") for line in lines]


def read_first_json_object(path: Path) -> dict[str, Any] | None:
    try:
        with path.open("r", encoding="utf-8", errors="replace") as handle:
            for line in handle:
                if not line.strip():
                    continue
                record = json.loads(line)
                return record if isinstance(record, dict) else None
    except (OSError, json.JSONDecodeError):
        return None
    return None
