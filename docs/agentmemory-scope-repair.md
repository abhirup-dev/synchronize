# AgentMemory Scope Repair

This documents the May 31, 2026 repair for the local AgentMemory install. The failure mode was cross-project pollution after importing historical sessions without stable repository scoping: `synchronize`, `content-intelligence`, worktree names, and full cwd paths all appeared as separate projects, while semantic memories and insights were mostly unscoped.

## Current State

- Global AgentMemory packages are on `0.9.24`.
- AgentMemory is healthy at `http://localhost:3111`.
- Sessions are normalized by repository:
  - `synchronize`
  - `content-intelligence`
  - other non-repo sessions keep their original project label
  - old empty sessions with no cwd/project are `unknown`
- Long-lived memories, lessons, crystals, summaries, sessions, and observations were preserved.
- Derived scopes were cleared and should be regenerated only after project-scoped consolidation is verified:
  - `mem:semantic`
  - `mem:insights`
  - `mem:graph:nodes`
  - `mem:graph:edges`

The backup from before the repair is:

```bash
/Users/abhirupdas/.agentmemory/backups/pre-scope-repair-20260531T082602Z
```

The normalized AgentMemory-native import payload is:

```bash
/Users/abhirupdas/.agentmemory/agentmemory-normalized-import-20260531T083602Z.json
```

## Reliable Restore Path

Direct writes to the iii-backed store are useful for audits and dry runs, but they are not the reliable live restore path. In testing, writing the KV files while the service was stopped could be overwritten when the engine restarted and hooks began writing again.

Use AgentMemory's import API instead:

```bash
node scripts/agentmemory-scope-repair.mjs backup --out /Users/abhirupdas/.agentmemory/backups/pre-scope-repair-$(date -u +%Y%m%dT%H%M%SZ)

node scripts/agentmemory-scope-repair.mjs export-agentmemory \
  --store /Users/abhirupdas/.agentmemory/backups/pre-scope-repair-20260531T082602Z/state_store.db \
  --drop-derived \
  --out /Users/abhirupdas/.agentmemory/agentmemory-normalized-import.json

node scripts/agentmemory-scope-repair.mjs import-agentmemory \
  --from /Users/abhirupdas/.agentmemory/agentmemory-normalized-import.json \
  --chunk-size 8 \
  --apply

node scripts/agentmemory-scope-repair.mjs compare-live \
  --from /Users/abhirupdas/.agentmemory/agentmemory-normalized-import.json
```

The first import chunk uses `strategy: replace`; later chunks use `strategy: merge`. The importer recursively splits failing chunks so bad legacy sessions do not prevent the rest of the restore.

## Verification Commands

Audit the raw store:

```bash
node scripts/agentmemory-scope-repair.mjs audit
```

Verify AgentMemory health:

```bash
agentmemory status --verbose
```

Verify scoped recall does not leak benchmark memories into `synchronize`:

```bash
curl -s -X POST http://localhost:3111/agentmemory/mcp/call \
  -H 'content-type: application/json' \
  --data '{"name":"memory_recall","arguments":{"query":"golden dataset benchmark prompt","project":"synchronize","format":"compact","limit":5}}'
```

Expected result: zero matches for the benchmark query under `project: synchronize`, and matches under `project: content-intelligence`.

## Local Package Patches

The installed package under `/opt/homebrew/lib/node_modules/@agentmemory/agentmemory` was patched locally after upgrading to `0.9.24`:

- Hook scripts resolve project names from the git common directory so sibling worktrees map to the main repository name, not the worktree folder name.
- `memory_recall` MCP schema and call handling accept `project` and `cwd`, then pass them to `mem::search`.
- Filtered `mem::search` scans the full in-memory search index before applying `project`/`cwd` filters; otherwise broad terms can exhaust the default pre-filter window before reaching the requested project.
- Project-scoped reflection filters semantic memories, crystals, graph nodes, and graph edges before building clusters.

These patches are local to this machine. Reinstalling or upgrading AgentMemory can overwrite them. Re-run the verification commands after any AgentMemory upgrade.

## MCP Wiring

Codex and Claude are wired to the installed MCP binary:

```text
/opt/homebrew/bin/agentmemory-mcp
```

This avoids repeated `npx -y @agentmemory/mcp` installs and ensures the MCP process loads the patched local package. Existing already-running `npx` MCP child processes may remain attached to older sessions until those sessions exit.
