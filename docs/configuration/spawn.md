# Spawn Configuration

Use this page for configured agent spawning: local persistent agents, remote
machine wiring, and Letta agents reached through a remote channel.

Related commands:

```bash
synchronize spawn claude --name NAME --repo PATH
synchronize spawn pi --name NAME --repo PATH
synchronize spawn PROFILE [--name NAME]
synchronize launch PROFILE
synchronize spawn letta --name NAME
synchronize remote connect HOST_OR_PROFILE
```

## Spawn Forms

`spawn` starts a persistent agent session. It is different from `launch`, which
runs an agent in the foreground.

Local Claude and Pi spawn through the launch backend:

```bash
synchronize spawn claude --name reviewer --repo /path/to/repo --group room
synchronize spawn pi --name planner --repo /path/to/repo --model MODEL --thinking LEVEL
```

Configured profiles work for both foreground launch and persistent spawn:

```bash
synchronize launch glaude
synchronize spawn glaude --name reviewer
```

For Claude/Pi profiles, `spawn PROFILE` requires `--name` unless the profile
sets `session_name`. `repo` can come from config or `--repo`.

The explicit Letta compatibility form remains:

```bash
synchronize spawn letta --name rocky
```

For a configured remote Letta agent, `--name` resolves `[agent.<name>]` from
`config.toml`. The command then derives the Letta server and remote machine
from config and runs the remote connection/channel workflow.

## Agent Profile Fields

Agent profiles use `[agent.<name>]`. The profile name must not be `claude`,
`pi`, or `letta`; those names are reserved for built-in runtime targets.

```toml
[agent.glaude]
tool = "claude"
bin = "/Users/example/.local/bin/claude"
repo = "/Users/example/project"
model = "claude-haiku-4-5-20251001"
thinking = "high"
args = []
session_name = "reviewer"

[agent.glaude.env]
ANTHROPIC_BASE_URL = "https://api.z.ai/api/anthropic"
ANTHROPIC_AUTH_TOKEN = { from_env = "ZAI_API_TOKEN" }
```

Supported fields:

| Field | Meaning |
| --- | --- |
| `tool` | Agent runtime: `claude`, `pi`, or `letta`. Required. |
| `bin` | Optional absolute binary path. Use this instead of shell aliases or zsh wrapper functions. |
| `repo` | Repository path for `spawn PROFILE`, and foreground cwd for `launch PROFILE`. |
| `model` | Optional model selector. CLI flags override config when provided. |
| `thinking` | Optional thinking/effort selector. CLI flags override config when provided. |
| `args` | Extra runtime arguments prepended before CLI passthrough args. |
| `session_name` | Default synchronize session name. Required for Claude/Pi `spawn PROFILE` when `--name` is omitted. |
| `[agent.NAME.env]` | Environment overlay for the launched process. Values can be literal strings, `{ from_env = "SOURCE" }`, or `{ from_file = "/path" }`. |
| `remote` | Reserved for remote agent shapes that do not use a Letta server profile. |

Only the profile name is stored in launch lifecycle SQLite rows. Environment
values and secret-source results are resolved from config at spawn/retry time
and are not persisted in daemon state.

## Remote Machine Profiles

Remote machine profiles also live under `[remote.<name>]`. A profile can be a
daemon connection target, a remote machine target, or both.

```toml
[remote.vpsme]
ssh_host = "vpsme"
runtime_path = "~/synchronize-letta-test"
expose = "ssh-reverse"
remote_port = 58455
install = true
```

Supported remote-machine fields:

| Field | Meaning |
| --- | --- |
| `ssh_host` | SSH config host used for provisioning, rsync, tunnels, and channel control. |
| `runtime_path` | Remote checkout/runtime path to sync. |
| `expose` | Exposure mode. Currently `ssh-reverse`. |
| `remote_port` | Remote localhost port that forwards to the Mac daemon. |
| `install` | `false` skips remote `bun install`; default is install. |

`remote connect` is repeatable. It should repair/reuse the tunnel and sync
runtime files. It should not imply a new agent identity.

## Letta Server Profiles

Letta server profiles describe where a Letta backend is reachable from the
machine that runs the Letta channel process.

```toml
[letta.server.vps]
remote = "vpsme"
base_url = "http://127.0.0.1:8283"
api_key_env = "LETTA_API_KEY"
```

Supported fields:

| Field | Meaning |
| --- | --- |
| `remote` | Name of the `[remote.<name>]` machine profile that runs the channel. |
| `base_url` | Letta server base URL from that remote machine. Required. |
| `api_key_env` | Environment variable holding the Letta API key. Preferred. |
| `api_key` | Literal Letta API key. Avoid in shared files. |

## Remote Letta Agent Profiles

The remote Letta spawn shape keeps the CLI explicit while making the wiring
config-driven:

```toml
[agent.rocky]
tool = "letta"
server = "vps"
session_name = "rocky"
agent_id = "agent-814dab68-2d4d-4cac-9f29-86d987494b13"
conversation_id = "default"
poll_ms = 1000
```

Then spawn with:

```bash
synchronize spawn rocky
synchronize spawn letta --name rocky
```

Supported Letta agent fields:

| Field | Meaning |
| --- | --- |
| `tool` | Must be `letta`. |
| `server` | Name of `[letta.server.<name>]`. |
| `session_name` | Synchronize peer session name. Defaults to the config key. |
| `agent_id` | Letta agent id. Required for remote Letta. |
| `conversation_id` | Letta conversation id. Defaults to `default`. |
| `poll_ms` | Channel inbox polling interval. |

Before spawning, the CLI checks the daemon roster. If an online `letta` peer
already has the configured `session_name`, the spawn fails locally instead of
provisioning or restarting anything.

## Channel Process Policy

The Letta channel is a long-running process on the remote machine:

```bash
letta-code server --channels synchronize --debug
```

It is runtime glue, not the durable store. Durable Synchronize messages live in
the daemon SQLite database, and Letta state lives in the Letta backend. However,
the channel process does keep transient in-memory work such as timers, the
current delivery job, and the event queue.

Because of that, `remote connect` does not kill an existing channel by default.
The policy is:

| Existing channel processes | Behavior |
| --- | --- |
| `0` | Start one. |
| `1` | Leave it running. |
| `>1` | Fail loudly; operator must clean up. |

Use an explicit restart only when you intend to reload channel runtime state:

```bash
synchronize remote connect vpsme --restart-channel
```

## Source Of Truth

- `src/config.ts` parses and normalizes `[remote.*]`, `[letta.server.*]`, and
  `[agent.*]`.
- `src/launch/profiles.ts` resolves configured agent profiles, binary overrides,
  and env source descriptors.
- `src/cli/commands/launch.ts` and `src/cli/commands/spawn.ts` accept built-in
  runtime targets or configured profile targets.
- `src/launch/service.ts` persists profile names and re-resolves profile
  command/env at durable spawn/retry time.
- `src/cli/commands/remote.ts` maps remote profiles into connect/sync/channel
  plans.
- `src/remote/plan.ts` defines tunnel, sync, and Letta channel process policy.
- `tests/config.test.ts`, `tests/launch-profiles.test.ts`,
  `tests/launch-service.test.ts`, `tests/cli-spawn-config.test.ts`, and
  `tests/remote-plan.test.ts` cover the config and process invariants.
