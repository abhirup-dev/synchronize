# PI Session Log Parser Integration Plan

## Summary

The real Pi integration harness should keep AoE/tmux as the launch and input
layer, but it should stop using terminal pane text as the validation source.
The stable evidence is Pi's native JSONL session files. Each Pi session should
get a stateful watcher that incrementally parses appended JSONL entries into a
queryable state object, and scenario assertions should query that state.

```text
PI JSONL files
    |
    v
PiSessionWatcher per PI session
    |
    | incrementally extracts structured events
    v
Queryable session state
    |
    v
Scenario assertion layer
    |
    v
Integration test pass/fail
```

## Architecture

The watcher stack is intentionally general-purpose. Baton-specific checks live
only in scenario code.

```text
Raw file IO
   |
   v
utils.JsonlTail
   - owns byte offset / partial trailing line handling
   - returns complete appended JSONL lines only
   |
   v
pi_session.parser
   - converts PI JSONL entries into normalized events
   |
   v
PiSessionWatcher
   - owns one PI session file
   - appends normalized events to in-memory state
   |
   v
PiSessionState
   - metadata
   - assistant text
   - tool calls
   - tool results
   - synchronize pushed events
   - parser diagnostics
   |
   v
queries.pi_session
   - has_assistant_marker(...)
   - tool_calls(...)
   - has_tool_call(...)
   - pushed_events(...)
   - has_pushed_event(...)
   - forbidden_tool_calls(...)
   |
   v
Assertion helpers
   - wait_until(...)
   - assert_no_forbidden(...)
   - assert_received_event(...)
```

Each agent gets an independent watcher:

```text
alpha PI session JSONL  -> PiSessionWatcher(alpha) -> alpha.state
beta PI session JSONL   -> PiSessionWatcher(beta)  -> beta.state
gamma PI session JSONL  -> PiSessionWatcher(gamma) -> gamma.state
```

The registry maps agents to watchers without relying on pane output:

```text
synchronize /agent-sessions?tool=pi
        |
        | host_session_id + session_name
        v
PI_CODING_AGENT_SESSION_DIR/**/*.jsonl
        |
        | session header id or filename stem
        v
PiSessionWatcherRegistry
        |
        +-- watcher_for("alpha")
        +-- watcher_for("beta")
        +-- watcher_for("gamma")
```

## Normalized Events

The extractor converts Pi JSONL entries into reusable event types:

```text
PI JSONL entry
 |
 +-- type=session
 |     -> SessionMetadataEvent
 |
 +-- assistant text
 |     -> AssistantTextEvent
 |
 +-- assistant toolCall block
 |     -> ToolCallEvent
 |
 +-- toolResult message
 |     -> ToolResultEvent
 |
 +-- message.details.mode == "call"
 |     -> ToolCallEvent(source="observed-details")
 |
 +-- custom_message / custom / user content containing <synchronize_event>
       -> SynchronizePushEvent
```

Pushed synchronize messages are parsed as XML envelopes:

```text
<synchronize_event type="group_message" event_id="123" group_id="..." sent_at="...">
BATON {"step":"alpha"}
</synchronize_event>
        |
        v
SynchronizePushEvent(
  event_id=123,
  type="group_message",
  group_id="...",
  body='BATON {"step":"alpha"}'
)
```

## Integration Test Shape

The new runner is a sibling of the current thread-baton test:

```text
Existing:
  uv run scripts/integration_thread_baton_pi.py

New:
  uv run scripts/integration_thread_baton_pi_logs.py
```

The parser-backed test drives the same baton workflow but swaps validation
surfaces:

```text
Old assertion                         New assertion
-------------                         -------------

wait_for_pane_text("BATON_SENT")  ->  watcher.has_assistant_marker("BATON_SENT")

pane contains event_id="123"      ->  watcher.has_pushed_event(event_id=123)

raw transcript contains tool name ->  watcher.has_tool_call("bridge_send_group")

raw text lacks forbidden tools     ->  watcher.forbidden_tool_calls([...]) == []

tmux capture on timeout            ->  watcher diagnostics + tmux capture for debugging only
```

## Test Plan

Unit tests cover:

- watcher initialization from an existing JSONL file
- incremental updates when new lines are appended
- partial trailing-line tolerance
- malformed complete-line diagnostics
- assistant marker, tool-call, tool-result, and synchronize-push queries
- one watcher per session
- registry mapping from daemon PI bindings to JSONL files
- assertion helpers calling query methods rather than raw JSONL parsing

End-to-end validation:

```text
general watcher unit tests pass
        |
        v
old tmux-backed PI test passes
        |
        v
new watcher-backed PI test passes
        |
        v
Bun test/typecheck pass
        |
        v
merge is allowed
```
