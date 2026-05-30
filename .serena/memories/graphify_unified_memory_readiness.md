# Graphify And Unified Memory Readiness

Use this when preparing `synchronize` for the unified query memory skill or checking whether Graphify is current.

## Current Graphify setup

- `graphify` is installed at `/Users/abhirupdas/.local/bin/graphify`; version checked on 2026-05-30 was `0.8.14`.
- The intended project graph is the root `graphify-out/graph.json` under `/Users/abhirupdas/Codes/Personal/synchronize`.
- `graphify-out/` is ignored by git and should be treated as regenerated output.
- `.graphifyignore` should exclude generated/local roots: `graphify-out/`, `node_modules/`, `web/node_modules/`, `web/dist/`, `coverage/`, `.codex/`, `.synchronize-itest/`, `.demo-synchronize/`, `.claude/launch.json`, `.pytest_cache/`, `.claude/worktrees/`, `work/`, `.beads/`, `.serena/`.

## Verified clean rebuild

On 2026-05-30, a clean full rebuild was run after tightening `.graphifyignore`:

```bash
rm -f graphify-out/graph.json graphify-out/GRAPH_REPORT.md graphify-out/graph.html
graphify extract . --backend gemini --out . --max-concurrency 1
```

Result: `graphify-out/graph.json` contained 1,223 nodes, 2,485 edges, and 89 communities. Semantic extraction used 27 cached docs and re-extracted 18 docs. No tracked file was newer than the rebuilt graph at verification time.

## Readiness checks

Run these from the repo root:

```bash
graphify benchmark graphify-out/graph.json
graphify query "LaunchService reconcileLaunch bridge_launch agent-sessions launch" --graph graphify-out/graph.json --budget 2400
```

The targeted launch query should surface `src/launch/service.ts`, `src/launch/backend.ts`, `src/launch/build.ts`, `src/daemon.ts`, `src/api/agent-sessions.ts`, `src/mcp/tools/launch.ts`, and launch tests rather than local/generated folders.

## Gotchas

- `graphify update .` refreshes code incrementally but can preserve stale nodes from previously indexed ignored/generated folders. Use clean `extract` after changing ignore rules.
- Graphify broad queries can choose generic nodes like `Agent`; use exact terms such as `LaunchService`, `reconcileLaunch`, `bridge_launch`, or `/agent-sessions/launch` for launch work.
- Graphify is a routing/orientation layer. Use raw source/tests for exact line-level claims.
