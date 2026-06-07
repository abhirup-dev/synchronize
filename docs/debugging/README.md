# Debugging

This folder holds durable debugging references that are too detailed for agent
skills. Skills should point here instead of duplicating long command lists,
SQL snippets, or configuration tables.

## Index

| Need | Document |
|---|---|
| Raw read-only SQLite/Event SQL recipes | `sql-queries.md` |
| Runtime, env vars, config.toml, remote profiles, test harnesses | `../configuration/README.md` |
| Agent-facing symptom routing | `.claude/skills/synchronize-debugging/SKILL.md` |

## Debugging Flow

```text
symptom
  |
  v
make doctor / inspect-*        read-only snapshot
  |
  v
targeted doc or source file    current implementation wins
  |
  v
preserving restart or dev repro
```

For remote/profile config readiness, use:

```bash
synchronize remote doctor
synchronize remote show
```

That checks active profile resolution, reachability, auth, and API version. It
does not inspect the local daemon DB or process tree.

Keep production runtime state intact unless the operator explicitly asks for a
wipe. For isolated experiments, use a throwaway `SYNCHRONIZE_HOME`; see
`../configuration/testing-and-harnesses.md`.
