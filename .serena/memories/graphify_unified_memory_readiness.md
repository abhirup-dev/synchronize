# Graphify Navigation

Use this memory to run or interpret Graphify without re-learning repo-specific
scope rules.

## Where to look

- `.graphifyignore` is the source of truth for Graphify scope.
- `graphify-out/graph.json` is the regenerated project graph.
- `graphify-out/` is ignored by git and should not be treated as a durable
  source file.

## Current scope rule

Graphify should exclude generated/local roots including `graphify-out/`,
`node_modules/`, `web/dist/`, `.beads/`, `.serena/`, `.understand-anything/`,
test/demo runtime homes, worktrees, and local agent/cache folders. Keep that
list in `.graphifyignore`, not in memory.

## Latest known clean graph

On 2026-06-07, a clean scoped extraction at commit
`2e89c000a2b245846f7f302dec78f1733e0dcdad` produced:

```text
2391 nodes
5605 links
134 communities
0 ignored-source leakage hits
```

Topic coverage included config, daemon, remote profiles, archive/resume, web,
launch, and MCP.

## Gotcha

`graphify update .` can preserve stale nodes from previously indexed ignored
folders. After changing ignore rules, move top-level current graph/cache files
aside and run `graphify extract . --out .`.
