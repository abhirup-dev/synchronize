# Configuration

This folder is the configuration reference for `synchronize`. Start here, then
open the focused page for the surface you are changing or operating.

Runtime settings resolve as:

```text
defaults < $SYNCHRONIZE_HOME/config.toml < environment variables
```

`SYNCHRONIZE_HOME` locates runtime state. If unset, the default runtime home is
`~/.synchronize`, so the default config file is:

```text
~/.synchronize/config.toml
```

## Diagnostics

Use the remote doctor for profile/config connection readiness:

```bash
synchronize remote doctor
synchronize remote show
```

Use `make doctor` or `scripts/doctor.sh` for local daemon process, DB, peer,
group, event, log, and tmux state. The two doctors answer different questions:

```text
synchronize remote doctor  -> did config/profile/env resolve to a usable hub?
make doctor                -> what is the local daemon runtime doing now?
```

## Use The Right Page

| Need | Read |
| --- | --- |
| Understand config precedence, `config.toml`, and daemon settings | [runtime.md](runtime.md) |
| Configure a remote daemon or named remote profiles | [remote-profiles.md](remote-profiles.md) |
| Classify environment variables by role | [environment.md](environment.md) |
| Use daemon `.env` files for local secrets/defaults | [daemon-env-files.md](daemon-env-files.md) |
| Set up test or harness runtime isolation | [testing-and-harnesses.md](testing-and-harnesses.md) |

## Current Config File Support

Implemented `config.toml` sections:

```text
config.toml
  |
  +-- [daemon]
  |     bind
  |     port
  |     token
  |     lease_ms
  |     peer_retention_ms
  |     sweep_interval_ms
  |
  +-- [mcp]
  |     heartbeat_ms
  |
  +-- active
  |
  +-- [remote.<name>]
        url
        token_env
        token
        health_timeout_ms
        |
        +-- [remote.<name>.sync]
              ssh_host
              paths
```

Current-state caveat: `[mcp].heartbeat_ms` is parsed by the runtime resolver and
covered by resolver tests, but the MCP adapter still reads
`SYNCHRONIZE_MCP_HEARTBEAT_MS` through its env-backed lifecycle constant. Treat
the env var as the current operator path for MCP heartbeat until the adapter is
migrated.

Do not document `[summary]`, `[llm]`, `[launch_worker]`, or `[skills]` as
supported `config.toml` sections until their consumers use the runtime resolver.
