from __future__ import annotations

from typing import Any


def string_or_none(value: Any) -> str | None:
    return value if isinstance(value, str) else None


def parse_int(value: str | None) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except ValueError:
        return None


def nested_string_values(value: dict[str, Any]) -> list[str]:
    result: list[str] = []
    for item in value.values():
        if isinstance(item, str):
            result.append(item)
        elif isinstance(item, dict):
            result.extend(nested_string_values(item))
        elif isinstance(item, list):
            for child in item:
                if isinstance(child, str):
                    result.append(child)
                elif isinstance(child, dict):
                    result.extend(nested_string_values(child))
    return result
