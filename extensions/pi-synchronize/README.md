# `@synchronize/pi-extension`

Pi coding-agent extension that subscribes the live Pi session to the
[`synchronize`](../../README.md) daemon's event stream and injects each event
as a user message — the same steer/followUp semantics Claude Code gets via
the experimental channel notification path.

This extension is the **inbound push** half of Pi ↔ synchronize integration.
Outbound calls (`bridge_dm`, `bridge_inbox`, `bridge_send_group`, …) come from
[`pi-mcp-adapter`](https://github.com/nicobailon/pi-mcp-adapter) speaking to
our `bin/synchronize-mcp` stdio server. The two extensions are complementary.

## What it does

1. On `session_start`: validates a working `synchronize` CLI with
   `synchronize status`, discovers the local synchronize daemon, registers a
   peer for the Pi session, and opens a localhost HTTP callback subscription
   (`POST /subscriptions`).
2. On each pushed event: wraps it in a `<synchronize_event …>` envelope and
   calls `pi.sendUserMessage(...)` with the right `deliverAs` (`steer` for
   DMs / group messages while streaming, `followUp` otherwise).
3. On `session_shutdown`: stops the callback server and deletes the peer.

It exports the peer id as `SYNCHRONIZE_PEER_ID` in `process.env` so any child
process Pi spawns (notably `pi-mcp-adapter` → `synchronize-mcp`) reuses the
same identity instead of minting a second peer.

## Install (dev)

```bash
cd extensions/pi-synchronize
bun install
```

Then register the extension in your Pi config alongside `pi-mcp-adapter`:

```ts
extensions: [
  "pi-mcp-adapter",
  "/abs/path/to/synchronize/extensions/pi-synchronize/src/index.ts",
]
```

## Environment

| Var | Effect |
|---|---|
| `SYNCHRONIZE_HOME` | runtime dir (defaults to `~/.synchronize`) |
| `SYNCHRONIZE_TOKEN` | required when the daemon binds non-localhost |
| `SYNCHRONIZE_CLI` | optional explicit `synchronize` CLI path checked before the configured repo binary and `PATH` |
| `SYNCHRONIZE_SESSION_NAME` | override the auto-resolved session label |
| `SYNCHRONIZE_PEER_ID` | set by the extension on `session_start`; downstream MCP server reads it to reuse the same peer |
| `SYNCHRONIZE_PI_DEBUG` | `1` to enable `[synchronize-pi]` stderr logging |

## Pair with the `synchronize` skill

For the Pi model to actually *act* on injected events (read the envelope,
reply via `bridge_dm` / `bridge_send_group`, ignore body slash-commands),
install the companion skill that lives next to this package:

```bash
mkdir -p ~/.pi/agent/skills
ln -snf /abs/path/to/synchronize/skills/synchronize-pi ~/.pi/agent/skills/synchronize
```

Without the skill, the model still receives the envelope but has to guess at
intent each time.

## Slash-command safety

Incoming text is wrapped in `<synchronize_event>` tags, so Pi's command
dispatcher cannot mistake an arriving "/help" DM for a slash command — the
agent sees structured event context instead.

## Tests

```bash
bun test extensions/pi-synchronize/tests/
```
