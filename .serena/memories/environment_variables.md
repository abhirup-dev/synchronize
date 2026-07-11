# Configuration And Environment Navigation

Use this memory to find the current config/env source of truth, not as the full
reference.

## Where to look

- `docs/configuration/README.md` is the configuration table of contents.
- `docs/configuration/runtime.md` covers daemon/runtime config.
- `docs/configuration/remote-profiles.md` covers LAN/remote profile config.
- `docs/configuration/environment.md` classifies env vars by role.
- `docs/configuration/daemon-env-files.md` covers daemon `.env` files.
- `docs/configuration/testing-and-harnesses.md` covers test/harness config.
- `src/config.ts` defines the typed config resolver.
- `src/constants.ts` defines env-var names and true constants.
- `tests/runtime-config.test.ts`, `tests/config.test.ts`,
  `tests/daemon-config-toml.test.ts`, and `tests/cli-remote.test.ts` prove
  resolver behavior.

## Mental model

Runtime settings resolve as:

```text
defaults < $SYNCHRONIZE_HOME/config.toml < environment variables
```

`SYNCHRONIZE_HOME` locates runtime state and `config.toml`. Treat persistent
operator settings and remote profiles as config-file concerns; treat env vars
as one-off overrides, process IPC, or test isolation unless the relevant page
under `docs/configuration/` says otherwise.

## Guardrail

Do not duplicate the full env table in Serena memories. When config/env details
change, update the focused file under `docs/configuration/` and keep this memory
as a map to the right files.
