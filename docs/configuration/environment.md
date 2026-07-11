# Environment Variables

Use this page to classify env vars. Prefer the focused pages for detailed
runtime, remote, daemon env file, or test workflows.

## Operator Overrides

These variables override corresponding `config.toml` or profile fields.

| Env var | Config field | Notes |
| --- | --- | --- |
| `SYNCHRONIZE_BIND` | `[daemon].bind` | Daemon bind host. |
| `SYNCHRONIZE_PORT` | `[daemon].port` | `0` requests a random free port. |
| `SYNCHRONIZE_TOKEN` | `[daemon].token`, `[remote.*].token_env` | Required for non-localhost daemon binds and authenticated remote clients. |
| `SYNCHRONIZE_LEASE_MS` | `[daemon].lease_ms` | Peer liveness lease window. |
| `SYNCHRONIZE_PEER_RETENTION_MS` | `[daemon].peer_retention_ms` | Offline peer retention before soft-delete sweeps. |
| `SYNCHRONIZE_SWEEP_INTERVAL_MS` | `[daemon].sweep_interval_ms` | Expired-peer sweep cadence. |
| `SYNCHRONIZE_REMOTE_URL` | active remote profile URL | Existing daemon URL for remote clients; disables local discovery/autostart. |
| `SYNCHRONIZE_HEALTH_TIMEOUT_MS` | `[remote.*].health_timeout_ms` | Remote daemon validation timeout. |
| `SYNCHRONIZE_MCP_HEARTBEAT_MS` | `[mcp].heartbeat_ms` | Current MCP adapter path is env-backed; resolver support exists. |

## Process IPC And Launcher Env

These variables bind one spawned process to one daemon/session. They are not
normal persistent operator config.

| Env var | Role |
| --- | --- |
| `SYNCHRONIZE_HOME` | Runtime home bootstrap; locates config, discovery, DB, logs, and media. |
| `SYNCHRONIZE_MCP_MODE` | Per-process MCP adapter mode: `codex` or `claude`. |
| `SYNCHRONIZE_PEER_ID` | Stable peer id for MCP/Pi restarts. |
| `SYNCHRONIZE_SESSION_NAME` | Stable session name for hooks/Pi registration. |
| `SYNCHRONIZE_LAUNCH_ID` | Correlates launch, hook, and MCP registration for one spawned agent. |
| `SYNCHRONIZE_STARTED_BY_CLIENT` | Marker used by client-spawned daemon processes. |
| `SYNCHRONIZE_CLI` | Explicit CLI binary path for resilient wrappers. |
| `SYNCHRONIZE_MCP` | Explicit MCP binary path for resilient wrappers. |
| `SYNCHRONIZE_CONFIGURED_CLI` | Installed wrapper fallback path captured during setup. |
| `SYNCHRONIZE_CONFIGURED_MCP` | Installed MCP wrapper fallback path captured during setup. |
| `SYNCHRONIZE_HOOK_ENABLE` | Enables host-agent hook ingestion for the launched process. |

## Env-Only Feature Knobs

These are env-only or env-file-backed today. Do not document them as
`config.toml` fields until their consumers use `RuntimeConfig`.

| Env var | Role |
| --- | --- |
| `SYNCHRONIZE_LLM_PROVIDER` | Summary LLM provider. |
| `SYNCHRONIZE_LLM_MODEL` | Summary LLM model. |
| `SYNCHRONIZE_SUMMARY_*` | Thread summary strategy, counts, polling, staleness, and batch knobs. |
| `SYNCHRONIZE_LAUNCH_WORKER_*` | Launch worker polling, lease, and batch knobs. |
| `SYNCHRONIZE_CLAUDE_SKILL_DIRS` | Extra Claude skill directories. |
| `SYNCHRONIZE_WEB_DIST` | Override built web asset directory. |
| `SYNCHRONIZE_PI_*` | Pi extension auth, debug, heartbeat, and skill-dir knobs. |

## Browser-Local Switches

| Name | Storage | Role |
| --- | --- | --- |
| `SYNCHRONIZE_DATA_SOURCE` | `localStorage` | `mock` forces mock data; `live` uses daemon data. |
| `SYNCHRONIZE_TOKEN` | `sessionStorage` or `localStorage` | Bearer token for protected daemon mode in the browser. |
