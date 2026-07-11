# Daemon Env Files

Use daemon env files for local secrets or defaults that should not be committed.

On daemon startup, the runtime can fill missing environment variables from:

```text
<source-root>/.env/daemon.env
<source-root>/.env/synchronize.env
$SYNCHRONIZE_HOME/.env/daemon.env
$SYNCHRONIZE_HOME/.env/synchronize.env
```

These files do not override variables that are already present in the process
environment.

Example:

```text
# .env/daemon.env
OPENROUTER_API_KEY=...
SYNCHRONIZE_LLM_MODEL="google/gemini-2.5-flash-lite"
```

Use this for local secrets such as `OPENROUTER_API_KEY` or env-only feature
defaults. Prefer `config.toml` for supported daemon and remote-profile settings.

Source of truth:

- `src/env-files.ts`
- `tests/env-files.test.ts`
