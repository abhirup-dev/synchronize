# Letta Synchronize Harness

Runs a Letta agent as a Synchronize peer. Incoming Synchronize DMs or group
messages are delivered into the agent, and the agent's reply is delivered back
to the source event. Two backends are supported:

- **`remote` (default)** — drives a live agent on a remote **Letta server** (the
  agent platform) over its REST API via `@letta-ai/letta-client`. The agent
  (e.g. `Rocky`) is persistent server-side and keeps its own memory, but only
  has the server's tools (web search + memory) — **no host shell/filesystem**.
  Lightweight; runs anywhere. Good for memory-backed Q&A.
- **`agent`** — drives the **same remote agent's brain/memory** but via
  `@letta-ai/letta-code-sdk`, which spawns the local `letta` CLI to execute the
  agent's **client-side tools** (`Bash`, `Read`, `Write`, `Edit`, `Glob`,
  `Grep`, skills) in `--cwd`. Run this **where the files live** (e.g. on the VPS
  with `--cwd` pointed at the Obsidian vault) to give Rocky real vault access.
- **`local`** — drives a throwaway local Letta Code agent in-process (the
  original harness; not the remote agent). Kept behind `--backend local`.

The harness never steers the agent by tmux input or by pasting text into a
terminal; AOE/tmux only hosts the process. Delivery uses the SDK/REST control
path, and `--delivery interrupt` cancels the in-flight turn (remote:
`messages.cancel`; local: SDK `abort()`) before inserting a newer event.

## Remote backend

```bash
LETTA_BASE_URL=http://100.96.245.110:8283 \
LETTA_AGENT_ID=agent-814dab68-2d4d-4cac-9f29-86d987494b13 \
bun run extensions/letta-synchronize/src/index.ts \
  --name rocky \
  --delivery interrupt
```

Equivalent flags: `--server <url> --agent <agent-id> [--api-key <key>]`.

Via the Synchronize launch flow (env is forwarded from the daemon process):

```bash
LETTA_BASE_URL=http://100.96.245.110:8283 \
LETTA_AGENT_ID=agent-814dab68-2d4d-4cac-9f29-86d987494b13 \
synchronize spawn letta --name rocky --repo "$PWD" --group demo
```

Config:

- `LETTA_BASE_URL` / `--server` — Letta server base URL (default
  `http://localhost:8283`). Reach a Tailscale-hosted server by its tailnet IP.
- `LETTA_AGENT_ID` / `--agent` — **required**: the existing agent to drive.
- `LETTA_API_KEY` / `LETTA_SERVER_PASSWORD` / `--api-key` — optional bearer.
  Omit when the server runs with `SECURE=false`.

The remote stream protocol (`reasoning_message` / `tool_call_message` /
`tool_return_message` / `assistant_message`, terminated by `stop_reason` +
`usage_statistics`) is translated into the harness's internal session contract;
all `assistant_message` content for a turn is concatenated and delivered back.

## Agent backend (remote brain + local tools)

Run on the host where the files live (the VPS). The Letta Code SDK connects to
the server for Rocky's brain/memory and runs Rocky's client-side tools in `cwd`:

```bash
LETTA_BASE_URL=http://localhost:8283 \
LETTA_AGENT_ID=agent-814dab68-2d4d-4cac-9f29-86d987494b13 \
bun run extensions/letta-synchronize/src/index.ts \
  --backend agent \
  --name rocky \
  --cwd "/home/abhirup/obsidian/Obsidian Vault" \
  --delivery interrupt
```

To join a synchronize bus on **another machine** (e.g. the daemon on your Mac,
reachable over Tailscale), point the harness at it instead of auto-starting a
local daemon:

```bash
SYNCHRONIZE_DAEMON_URL=http://<mac-tailnet-ip>:<port> \
SYNCHRONIZE_TOKEN=<token> \
LETTA_BASE_URL=http://localhost:8283 \
LETTA_AGENT_ID=agent-814dab68-... \
bun run extensions/letta-synchronize/src/index.ts --backend agent --name rocky \
  --cwd "/home/abhirup/obsidian/Obsidian Vault"
```

Headless reliability: the agent backend runs with `permissionMode:
"bypassPermissions"`, `disallowedTools: ["AskUserQuestion"]`, and a `canUseTool`
auto-allow policy so the session never stalls on approval/interactive prompts
(the failure mode of the older `rocky-agent` bridge).

## Local backend

```bash
ZAI_CODING_API_KEY=... \
ZAI_CODING_BASE_URL=https://api.z.ai/api/coding/paas/v4 \
bun run extensions/letta-synchronize/src/index.ts \
  --backend local \
  --name letta \
  --model zai/glm-4.7 \
  --delivery interrupt
```

Runtime notes:

- `ZAI_CODING_BASE_URL` defaults to the Z.ai coding-plan endpoint when unset.
- `ZAI_CODING_API_KEY_FILE` is accepted as a secret-file alternative to
  `ZAI_CODING_API_KEY`; AOE demos should prefer the file form.
- `LETTA_LOCAL_BACKEND_EXPERIMENTAL=1` is set by the harness when unset.
- `LETTA_CLI_PATH` is resolved to the installed `@letta-ai/letta-code` package
  when unset so the SDK does not fall back to an older global CLI.
