# Testing And Harness Configuration

Use throwaway runtime homes for manual tests and integration harnesses.

```bash
SYNCHRONIZE_HOME=/tmp/synchronize-demo synchronize status
```

For daemon tests, prefer writing `config.toml` into the temporary home instead of
mutating global process env:

```text
mktemp home
   |
   +-- config.toml
   +-- daemon.json
   +-- synchronize.db
   +-- media/
```

Common test/harness env:

| Env var | Role |
| --- | --- |
| `SYNCHRONIZE_HOME=/tmp/...` | Isolates daemon discovery, DB, media, logs, and config. |
| `SYNCHRONIZE_PORT=0` | Requests a random free port for parallel daemon tests. |
| `SYNCHRONIZE_SUMMARY_LIVE_TEST` | Enables summary live-smoke behavior. |
| `SYNCHRONIZE_AOE_HARNESS` | Marks AOE harness runs. |
| `SYNCHRONIZE_AOE_KEEP` | Keeps AOE harness artifacts/sessions for inspection. |
| `SYNCHRONIZE_DEBUG` | Enables debug behavior in selected paths. |
| `SYNCHRONIZE_REMOTE_PI_SESSION_DIR` | Remote Pi harness/session location. |

Source of truth:

- `tests/helpers/daemon.ts`
- `tests/runtime-config.test.ts`
- `tests/daemon-config-toml.test.ts`
- `scripts/integration-aoe/`
