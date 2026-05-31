# Letta Synchronize Harness

This extension runs a Letta Code SDK session as a Synchronize peer. Incoming
Synchronize DMs or group messages are delivered into the live Letta session via
the SDK `send()` control path, and `--delivery interrupt` uses SDK `abort()` to
stop the active turn before inserting the newer event.

It deliberately does not steer Letta by tmux input or by pasting text into a
terminal. AOE/tmux only hosts the process.

```bash
ZAI_CODING_API_KEY=... \
ZAI_CODING_BASE_URL=https://api.z.ai/api/coding/paas/v4 \
bun run extensions/letta-synchronize/src/index.ts \
  --name letta \
  --model zai/glm-4.7 \
  --delivery interrupt
```

The launch integration uses the same harness through:

```bash
synchronize spawn letta --name letta --repo "$PWD" --group demo
```

Runtime notes:

- `ZAI_CODING_BASE_URL` defaults to the Z.ai coding-plan endpoint when unset.
- `ZAI_CODING_API_KEY_FILE` is accepted as a secret-file alternative to
  `ZAI_CODING_API_KEY`; AOE demos should prefer the file form.
- `LETTA_LOCAL_BACKEND_EXPERIMENTAL=1` is set by the harness when unset.
- `LETTA_CLI_PATH` is resolved to the installed `@letta-ai/letta-code` package
  when unset so the SDK does not fall back to an older global CLI.
