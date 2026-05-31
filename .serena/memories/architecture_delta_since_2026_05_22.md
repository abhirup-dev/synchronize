# Architecture Delta Since 2026-05-22 Serena Refresh

Use this as a quick orientation memory when asking what changed after the previous broad Serena refresh at commit `f350325` (`docs(serena): refresh memories after pi-extension merge`).

## Biggest additions

- Web UI scaffold and polish under `web/`, with its own `web_ui_overview` memory.
- Group policy v0: identity-bound aliases, group alias rename/audit events, descriptions, case-insensitive name collision handling, and ephemeral cleanup.
- Slack-style group threads using `parent_event_id`, `in_reply_to`, `thread_of`, and `GET /threads/:root`.
- Mention-aware delivery using `mentions_json`, unresolved mention warnings, self-mention filtering, code-span/code-fence carve-out, and inbox-vs-push fanout distinction.
- Agent session correlation via `agent_sessions`, auto-registration hooks, `SYNCHRONIZE_SESSION_NAME`, and hook/launch CLI surfaces.
- MCP adapter response improvements: structured error envelopes, parsed `mentions`, `bridge_rename_in_group`, and `bridge_group_history` event retrieval modes.
- Peer soft-delete through `peers.deleted_at` with resurrection on re-register.
- Pi extension resilience: daemon rediscovery on transport error and explicit session-name override.
- AoE/tmux/Pi integration harnesses under `scripts/integration-aoe/` plus wrapper scripts and docs.
- Default daemon port pinned to `58405` (`DEFAULT_PORT`) instead of random-by-default.

## New focused memories

- `backend_daemon_runtime_series`.
- `backend_group_policy_series`.
- `backend_threads_mentions_series`.
- `mcp_adapter_surface_series`.
- `cli_surface_series`.
- `agent_sessions_hooks_series`.
- `pi_extension_surface_series`.
- `tmux_aoe_integration_harness_series`.
- `tests_quality_gates_series`.
- `web_frontend_series`.

## Stale older memories to interpret carefully

- `architecture` is still directionally right on layers, but misses group policy, threads, mentions, agent sessions, soft-delete, fixed default port, and new integration harnesses.
- `codebase_layout` is missing several newer scripts/docs and newer API/CLI/MCP fields.
- `environment_variables` is stale on default port and does not include `SYNCHRONIZE_SESSION_NAME` or `SYNCHRONIZE_WEB_DIST`.
- `mcp_notification_modes` is still valid for notification-mode architecture but does not describe newer MCP tool response formatting or structured errors.
