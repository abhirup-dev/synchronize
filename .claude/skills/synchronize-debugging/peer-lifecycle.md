# peer-lifecycle.md

Peers are the unit of identity in synchronize. Almost every operator failure
that looks like "agent X disappeared / stopped responding / lost messages"
reduces to a peer-lifecycle question. This file is the reference for
diagnosing those.

## Two-layer ownership model

A peer row in the database can be shared across two processes:

| Process | File | Role |
|---|---|---|
| Pi extension | `extensions/pi-synchronize/src/index.ts` | **Owner** — registers the peer in `session_start` and writes `SYNCHRONIZE_PEER_ID` into its own env |
| MCP adapter (subprocess of Pi) | `src/mcp/lifecycle.ts` | **Borrower** — reads `SYNCHRONIZE_PEER_ID` from inherited env and reuses the existing peer instead of registering its own |

The ownership rule is: **the process that registers the peer owns its
lifetime.** The borrower must NOT call `DELETE /peers/:id` because its own
shutdown (stdin close, restart, MCP rotation) does not imply the peer should
go away — the owning Pi process is still alive.

For Claude Code the MCP adapter is the owner (no Pi extension wrapping it),
so stdin close → delete IS correct there. The borrower-only-when-env-var-set
discrimination lives in `cleanup()`.

> **Code gap as of this branch (master):** the borrowed-peer guard in
> `src/mcp/lifecycle.ts` and the `teardownSession` / `teardownProcess` split
> in `extensions/pi-synchronize/src/index.ts` were committed in
> `sync-h9u-live-web-ui` and are pending merge. If `grep -n borrowed
> src/mcp/lifecycle.ts` returns nothing, you are looking at pre-fix code and
> Pi peers are vulnerable to the borrowed-delete trap described below.

## Lifecycle timeline

A peer row has four time columns. Reading them together tells you exactly
what happened:

```
created_at        → when registerPeer first ran
updated_at        → most recent heartbeat (refreshed every MCP_HEARTBEAT_MS)
lease_expires_at  → updated_at + DEFAULT_LEASE_MS; how the daemon decides "online"
deleted_at        → set by DELETE /peers/:id (soft-delete from sync-dmc)
```

Diagnostic patterns:

| Pattern | Interpretation |
|---|---|
| `updated_at` matches `deleted_at` (to the millisecond) | DELETE was called by an owner/borrower at last heartbeat — find who. |
| `deleted_at` IS NULL and `lease_expires_at` < now | Peer's process died without DELETE; daemon considers it offline but not soft-deleted. |
| `deleted_at` set, `updated_at` far in the past | Peer was deleted long ago and never resurrected. |
| `deleted_at` IS NULL, `lease_expires_at` > now, but channel pushes never arrive | The "alive but unreachable" trap — see below. |

Forensic query — when did peer X die and how:

```sql
SELECT
  peer_id, tool, session_name,
  datetime(created_at)        AS created,
  datetime(updated_at)        AS last_heartbeat,
  datetime(lease_expires_at)  AS lease,
  datetime(deleted_at)        AS deleted
FROM peers
WHERE session_name = 'bob';
```

## Pi extension event mapping

The Pi runtime fires three lifecycle events. The extension's handling must
match this exactly:

| Pi event | Correct handling | Wrong handling (root cause of past bugs) |
|---|---|---|
| `session_start` | Register peer if not yet registered; otherwise refresh the per-session `agent_session` binding and rebuild the event subscription. **Idempotent.** | Always register fresh — produces duplicate peers per Pi session. |
| `session_before_switch` | **Do not register a handler.** Pi rotates its internal sessions during normal operation (context-window flushes, tool flows). The peer is process-lifetime, not Pi-session-lifetime. | Calling `deletePeer` here — caused recurring Pi peer soft-deletes mid-session. |
| `session_shutdown` | Full teardown: stop heartbeat, stop subscription, `deletePeer`, unlink session file, clear `SYNCHRONIZE_PEER_ID`. This is the ONLY legitimate delete path. | (none — this one's straightforward.) |

If you see "Peer not found" 404 spam in `~/.synchronize/pi-extension.log`
while the Pi process is clearly still running, a `session_before_switch`
handler is the likely culprit. Confirm by `grep -n session_before_switch
extensions/pi-synchronize/src/index.ts`.

## The "alive but unreachable" trap

A peer can heartbeat fine (`updated_at` advancing, `lease_expires_at` > now,
`deleted_at` IS NULL) while still receiving zero channel pushes. The daemon
considers it online but has no callback URL to push to.

How it happens: the peer was soft-deleted, then resurrected via re-register,
but only the database row was restored. The Pi extension's
`PiEventSubscription` (which registered the callback URL with the daemon's
in-memory subscriber map) was never re-established because it lives in the
old Pi process state.

Detection:
- DB looks healthy (`make inspect-peers` shows online: yes).
- DM send response shows `pushed_to: []` and `inbox: true`.
- pi-extension.log has no recent `subscribed peer_id=…` line for this peer.

Cure:
- Full Pi process restart. Re-registering alone is insufficient because the
  callback subscription is held by the live Pi process, not the DB.
- `make daemon-kill` + `make daemon-relaunch` ALSO works but is heavier — it
  forces every connected agent to re-subscribe.

## Resurrection recipe

If a peer is soft-deleted but its process is still alive (e.g. the borrowed-
delete trap fired), you can resurrect without restarting the process:

1. Call `bridge_register` again with the same `session_name`. The upsert path
   in `src/api/peers.ts` clears `deleted_at` and refreshes `lease_expires_at`.
2. If the peer was in groups, group_members rows have `active = 0` — rebind
   via `bridge_rename_in_group` with the original alias. Membership history
   is preserved (the row is reactivated, not recreated).
3. If channel pushes still don't arrive afterward, the subscription is dead
   — see "alive but unreachable" above; restart the process.

## Borrowed-peer guard (what the fix looks like)

The fix in `src/mcp/lifecycle.ts cleanup()` is a single env-var check:

```ts
const borrowedPeerId = process.env[ENV_PEER_ID];
if (borrowedPeerId && borrowedPeerId === state.peer.peer_id) {
  log(`skip unregister peer ${state.peer.peer_id} (borrowed via ${ENV_PEER_ID})`);
  return;
}
```

When the MCP adapter inherits `SYNCHRONIZE_PEER_ID` from its parent Pi
extension, it knows the peer is borrowed and skips delete on its own
shutdown. The Pi extension still owns the peer and will delete on its own
`session_shutdown`.

## Heartbeat-only future (sync-6mz)

The borrowed-peer guard is tactical. The durable architectural cleanup
tracked in `sync-6mz` removes ALL client-driven `deletePeer` calls and
relies entirely on lease expiry — if a peer stops heartbeating for >
DEFAULT_LEASE_MS, the daemon considers it dead. That requires dropping the
default lease from 7 days back to ~60-300s. Until that lands, both delete
paths (correct and incorrect) coexist and the guard is the only thing
keeping borrowed peers alive.

## Common failure signatures

| Symptom | Likely cause | First diagnostic |
|---|---|---|
| `Peer not found` 404 spam in pi-extension.log while Pi process is alive | Borrowed-delete trap (MCP cleanup deleted the shared peer) OR `session_before_switch` handler firing | `make inspect-peers` — is the peer soft-deleted? |
| Agent shows online in `make doctor` but receives no DMs | Alive-but-unreachable (subscription dead) | `grep "subscribed peer_id=$peer_id" ~/.synchronize/pi-extension.log` — recent? |
| Same `session_name` appears multiple times in soft-deleted list | Repeated registration after deletes; check if each delete had a legitimate `session_shutdown` cause | Cross-reference `deleted_at` timestamps with operator activity log |
| New Pi agent never appears | Pi extension errored during `session_start`; check pi-extension.log for the registration call | `tail -50 ~/.synchronize/pi-extension.log` |

## See also

- `daemon-forensics.md` — for daemon-process and worktree-provenance issues that masquerade as peer issues
- `delivery-forensics.md` — for "peer is alive but message X didn't arrive" diagnostics
- `db-queries.md` — for canonical SQL recipes used in this file
- bd issues: `sync-6mz` (heartbeat-only refactor), `sync-dmc` (soft-delete origin), `sync-2sr` (Pi resilience fix)
