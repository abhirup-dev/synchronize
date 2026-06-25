# Remote Profiles And LAN Mode

Use this page for named remote daemon targets, named remote machine targets,
and one-off LAN hosting. For agent spawn wiring on top of remote machines, see
[spawn.md](spawn.md).

## Named Profiles

Remote profiles can describe a daemon connection target, a remote machine, or
both.

When the active profile resolves to a remote URL, CLI and MCP clients use that
daemon directly and do not read local `daemon.json` or auto-start a local
daemon.

```toml
active = "hub"

[remote.hub]
url = "http://100.126.163.80:8787"
token_env = "SYNCHRONIZE_TOKEN"
health_timeout_ms = 5000

[remote.hub.sync]
ssh_host = "vpsme"
paths = [".claude/skills", ".mcp.json"]
```

Remote machine profiles are used by `remote connect`, configured Letta spawn,
and other sync/deploy flows:

```toml
[remote.vpsme]
ssh_host = "vpsme"
runtime_path = "~/synchronize-letta-test"
expose = "ssh-reverse"
remote_port = 58455
install = true
```

Manage profiles with:

```bash
synchronize remote add hub --url http://100.126.163.80:8787 --token-env SYNCHRONIZE_TOKEN --ssh-host vpsme --use
synchronize remote ls
synchronize remote show
synchronize remote use hub
synchronize remote remove hub
```

`remote connect` can take either an SSH host directly or the name of a remote
machine profile:

```bash
synchronize remote connect vpsme
```

With `expose = "ssh-reverse"`, the Mac daemon remains localhost/no-token. The
remote machine reaches it through a reverse tunnel on its own localhost port.

One-off environment overrides still win over the active profile:

```bash
SYNCHRONIZE_REMOTE_URL=http://override:9999 synchronize remote show
```

## LAN Hosting

For a one-off token-protected host daemon:

```bash
bun run src/cli.ts host \
  --bind 100.126.163.80 \
  --port 8787 \
  --token 'replace-with-a-secret'
```

Use the Mac's Tailscale IP for `--bind` when the Mac is the central v0 daemon.
The command starts or verifies a token-protected daemon and prints the remote
client environment. If a daemon is already running with incompatible host/token
settings, it exits without changing it; pass `--restart` to relaunch while
preserving `SYNCHRONIZE_HOME` state.

Remote clients must use the daemon URL and the same token:

```bash
export SYNCHRONIZE_REMOTE_URL='http://100.x.y.z:8787'
export SYNCHRONIZE_TOKEN='replace-with-a-secret'
```

The daemon expects:

```text
Authorization: Bearer <SYNCHRONIZE_TOKEN>
```

## Source Of Truth

- `src/cli/commands/remote.ts`
- `src/cli/commands/host.ts`
- `src/client.ts`
- `tests/cli-remote.test.ts`
- `tests/host-command.test.ts`
