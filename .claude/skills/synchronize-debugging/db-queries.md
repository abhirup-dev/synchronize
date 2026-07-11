# db-queries.md

The raw SQL reference has moved to repo documentation:

```text
docs/debugging/sql-queries.md
```

Use this skill file only as a routing hint. The docs version is the durable
surface for copy-paste SQL and should be updated when the schema or friendly
views change.

Preferred access paths:

```text
bridge_query_events({ sql: "...", params: [...] })
synchronize query events --sql "..."
sqlite3 -header -column "$SYNCHRONIZE_HOME/synchronize.db" "<query>"
```

Ground truth:

| Need | Source |
|---|---|
| Schema and migrations | `src/db.ts` |
| Query route guardrails | `src/daemon/routes/query.ts` |
| Typed query facade | `src/api/query.ts` |
| MCP query tool | `src/mcp/tools/query.ts` |
| Common SQL recipes | `docs/debugging/sql-queries.md` |
