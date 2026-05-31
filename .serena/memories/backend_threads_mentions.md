# Backend / Threads And Mentions Series

Covers Slack-style threads and mention-aware delivery. Search terms: backend, daemon, threads, mentions, notifications, inbox, parent_event_id, mentions_json.

## Thread model

Threading is stored on events via `parent_event_id`.

- Root group messages have `parent_event_id = null`.
- Replies pass `in_reply_to` from API/MCP/CLI.
- The daemon normalizes reply-to-reply to the original root, so threads remain one level deep.
- Main-channel group history excludes thread replies by default.
- Thread history uses `thread_of=<root_event_id>` and returns the root plus replies in posting order.
- `GET /threads/:root_event_id?peer_id=<peer>` returns root, replies, participants, and `last_event_id` in one call.

## Mention model

Mentions are resolved at send time and stored as `mentions_json`, a JSON string array of peer ids or `null`.

- `@alias` tokens resolve against active group members.
- Sender/self mentions are filtered out, so persisted `mentions_json` matches delivered push targets.
- Unresolved aliases produce warnings, not a send failure.
- Single-backtick and triple-backtick regions are carved out before parsing, so examples like `@peer:uuid` do not create mentions.

## Delivery semantics

Durable inbox and live push are intentionally different:

- Inbox rows are written for all active members who should have durable visibility.
- Live push is selective.
- In the main channel, only mentioned peers receive push notifications.
- In a thread, push reaches the root author and prior thread posters, plus any newly mentioned peers.
- The sender is excluded from live push.

`sendGroupMessage` returns a delivery summary that distinguishes pushed recipients from `inbox_only` recipients.

## MCP response formatting

MCP callers should not consume raw `mentions_json`. `src/mcp/tools/event-format.ts` converts events to `mentions: string[]` and removes `mentions_json`. This formatter must be applied to every MCP response carrying event(s), including join/leave/rename/share/history paths.

## Useful files

- `src/daemon.ts` — `resolveMentions`, `stripBacktickedRegions`, `resolveThreadParent`, thread and fanout logic.
- `src/api/groups.ts` — `sendGroupMessage`, `getGroupHistory` thread/event modes.
- `src/mcp/tools/event-format.ts` — MCP event normalization.
- `src/mcp/tools/groups.ts` — tool descriptions and argument validation for `in_reply_to`, `thread_of`, `event_ids`.
- `tests/api.test.ts` — executable spec for thread collapse, mention parsing, fanout, and `/threads`.
- `scripts/integration-aoe/sync_itest_aoe/scenarios/pi_mcp_thread_baton.py` — real multi-agent thread/mention baton workflow.
