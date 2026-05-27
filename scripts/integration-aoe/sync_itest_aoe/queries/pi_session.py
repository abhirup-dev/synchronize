from __future__ import annotations

from ..pi_session.state import PiSessionState, SynchronizePushEvent, ToolCallEvent


def has_assistant_marker(state: PiSessionState, marker: str) -> bool:
    return any(marker in event.text for event in state.assistant_texts)


def tool_calls(state: PiSessionState, tool: str | None = None) -> list[ToolCallEvent]:
    if tool is None:
        return list(state.tool_calls)
    return [event for event in state.tool_calls if event.tool == tool or event.tool.endswith(f"_{tool}")]


def has_tool_call(state: PiSessionState, tool: str) -> bool:
    return bool(tool_calls(state, tool))


def forbidden_tool_calls(state: PiSessionState, forbidden: list[str]) -> list[ToolCallEvent]:
    forbidden_set = set(forbidden)
    return [event for event in state.tool_calls if event.tool in forbidden_set or any(event.tool.endswith(f"_{tool}") for tool in forbidden_set)]


def pushed_events(
    state: PiSessionState,
    *,
    event_id: int | None = None,
    event_type: str | None = None,
    body: str | None = None,
) -> list[SynchronizePushEvent]:
    events = list(state.synchronize_events)
    if event_id is not None:
        events = [event for event in events if event.event_id == event_id]
    if event_type is not None:
        events = [event for event in events if event.event_type == event_type]
    if body is not None:
        events = [event for event in events if event.body == body]
    return events


def has_pushed_event(
    state: PiSessionState,
    *,
    event_id: int | None = None,
    event_type: str | None = None,
    body: str | None = None,
) -> bool:
    return bool(pushed_events(state, event_id=event_id, event_type=event_type, body=body))
