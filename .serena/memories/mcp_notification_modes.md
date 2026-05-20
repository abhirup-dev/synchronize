# MCP Adapter — Notification Modes

The MCP stdio server (`src/mcp/`) has **two notification delivery paths**, selected by the `SYNCHRONIZE_MCP_MODE` env var. The daemon doesn't know which mode the adapter is in — both modes read from the same event stream, they just present it differently to the MCP client.

## `codex` mode (default)
- Adapter component: `NotificationBridge` in `src/mcp/codex-notifier.ts`.
- Mechanism: **polling loop**. One peer-level polling bridge per registered peer; polls `/events/{peer_id}` and forwards each event via standard MCP `notifications/message`.
- Constants in `src/constants.ts`: `NOTIFIER_ACTIVE_MS` (busy poll interval), `NOTIFIER_IDLE_MS` (idle poll interval).
- Best for: any MCP client that supports `notifications/message` (Codex CLI, generic MCP hosts).

## `claude` mode
- Adapter component: `EventSubscription` in `src/mcp/claude-subscription.ts`.
- Mechanism: **one localhost HTTP callback subscription** per session. The adapter starts a tiny callback server, registers it with the daemon, and the daemon pushes events into the callback. Notifications surface as `notifications/claude/channel` (Anthropic experimental channel).
- Requires Claude Code launched with `--dangerously-load-development-channels server:synchronize`. Without that flag, the channel push won't surface in the UI — but `bridge_inbox` durable fallback still works.
- The wrapper `cch synchronize` (user-level shell function) handles the flag.

## Universal fallback

`bridge_inbox` (durable inbox polling) works in **both** modes and works even when channel/notification delivery is silently dropped by the client. Treat inbox as the source of truth; treat live notifications as nice-to-have.

## Why this split exists

Codex doesn't support Anthropic's experimental channel notifications. Claude doesn't natively idle-poll. Rather than reduce to lowest-common-denominator polling for both, the adapter speaks each client's native push protocol.

## Adapter is intentionally thin

The MCP adapter doesn't replay missed deliveries, doesn't store state, doesn't second-guess the daemon. All durable state lives in the daemon's SQLite + filesystem MediaStore.
