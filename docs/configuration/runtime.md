# Runtime And Daemon Config

Use this page for local daemon configuration and runtime resolution rules.

## Resolution

```text
defaults
   |
   v
$SYNCHRONIZE_HOME/config.toml
   |
   v
environment variables
   |
   v
resolved runtime config
```

Environment variables always win. This keeps one-off shell overrides and tests
backward-compatible while allowing persistent machine settings in `config.toml`.

## Local Daemon

Minimal local config:

```toml
[daemon]
bind = "127.0.0.1"
port = 58405
```

Full daemon config fields:

```toml
[daemon]
bind = "127.0.0.1"
port = 58405
token = "replace-with-a-secret"
lease_ms = 259200000
peer_retention_ms = 86400000
sweep_interval_ms = 3600000
```

Localhost mode does not need a token. A non-localhost daemon bind must use a
token, either in config or through `SYNCHRONIZE_TOKEN`.

## MCP Heartbeat Caveat

The resolver currently parses:

```toml
[mcp]
heartbeat_ms = 15000
```

However, current MCP adapter heartbeat behavior still reads
`SYNCHRONIZE_MCP_HEARTBEAT_MS` from the process environment. Treat the env var as
the live operator path until `src/mcp/lifecycle.ts` consumes `RuntimeConfig`.

## Source Of Truth

- `src/config.ts` — resolver and supported TOML fields.
- `src/daemon/server.ts` — daemon startup and runtime config consumption.
- `tests/runtime-config.test.ts` — resolver precedence tests.
- `tests/daemon-config-toml.test.ts` — real daemon proof for `[daemon]`.
