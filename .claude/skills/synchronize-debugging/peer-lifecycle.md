# peer-lifecycle.md

Use this for peers disappearing, `Peer not found`, soft-deletes, lease/offline
state, stale `agent_sessions`, and alive-but-unreachable push failures.

## Current Model

```text
peer row
  |
  +-- lease_expires_at      online/offline signal
  +-- lifecycle_state       active / archived / stopped-style state
  +-- deleted_at            soft-delete audit marker
  +-- agent_sessions        host-session bindings, may outlive a peer
  +-- subscriber callback   in-memory push channel, lost on restart
```

The daemon now leans on lease/retention semantics for crash detection. A peer
can be online by lease while still missing push callbacks; inbox remains the
durable fallback.

## Source Map

| Need | Current source |
|---|---|
| Register/heartbeat/delete/activity routes | `src/daemon/routes/peers.ts` |
| Lease, presence, soft-delete, retention helpers | `src/daemon/repo/peers.ts` |
| MCP register/heartbeat/cleanup | `src/mcp/lifecycle.ts` |
| Pi extension lifecycle | `extensions/pi-synchronize/src/index.ts` |
| Agent-session routes/repo | `src/daemon/routes/agent-sessions.ts`, `src/daemon/repo/agent-sessions.ts` |
| Archive/resume peer preservation | `src/daemon/services/archive.ts`, `src/daemon/repo/archive.ts` |
| SQL recipes | `docs/debugging/sql-queries.md` |

## First Checks

```bash
make inspect-peers
make inspect-events N=50
```

If you need a raw view, use `docs/debugging/sql-queries.md`.

## Failure Signatures

| Symptom | Likely area |
|---|---|
| `Peer not found` | Deleted/expired peer, stale host-session binding, or caller using old peer id. |
| Online in roster but no live messages | Missing subscriber callback; inspect delivery and reconnect/restart client. |
| Soft-deleted but expected alive | Check owner cleanup path and retention/stop/archive rules. |
| Archived peer vanished or alias freed unexpectedly | Inspect archive service/repo before treating it as normal cleanup. |
| Duplicate/stale session rows | `agent_sessions` history is not the same thing as peer liveness. |

## De-risking

```text
inspect peer row
  -> inspect agent_sessions
  -> inspect inbox/event rows
  -> reconnect/restart affected client
  -> restart daemon preserving state
```

Avoid deleting peers or wiping runtime state during diagnosis unless the
operator asked for cleanup. For production-safe questions, prefer read-only
doctor output and SQL.

## See Also

- `delivery-forensics.md` for push vs inbox interpretation.
- `daemon-forensics.md` for wrong-worktree or daemon restart issues.
- `docs/configuration/runtime.md` for lease/retention config.
