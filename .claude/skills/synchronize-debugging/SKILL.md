---
name: synchronize-debugging
description: Use when debugging or inspecting the synchronize agent messaging bus — peers disappearing or showing 404 Peer not found, daemon health or wrong-worktree issues, agents not receiving DMs/group messages/thread replies/@mentions, stale state from prior sessions, isolated dev runtimes for ad-hoc testing, or any "what's actually happening on this daemon?" question. Covers chat, groups, threads, mentions, media, and agent-session surfaces.
---

# synchronize-debugging

Reference for diagnosing and inspecting synchronize daemon runtime, peer
lifecycle, and message delivery. Tuned for fast load: route by symptom,
load detail files only when needed.

## State anatomy

```
$SYNCHRONIZE_HOME/      (default ~/.synchronize)
  daemon.json           discovery: pid, port, base_url
  daemon.lock/          startup lock (stale > 30s)
  synchronize.db        SQLite (WAL): peers, groups, group_members, events,
                                      inbox, media_items, agent_sessions
  daemon.log            daemon stderr (when redirected)
  pi-extension.log      Pi extension lifecycle events
  pi-sessions/          per-Pi-session manifest files
  media/                per-group media assets
```

## Orientation — first 60 seconds

**Makefile is the primary tool surface.** Reach for raw `sqlite3` / `ps` /
`curl` only when a Make target doesn't cover the need.

```bash
make doctor                 # full snapshot: daemon + peers + groups + events + logs + tmux
make inspect-daemon         # which-worktree provenance, pid/port/health
make inspect-peers          # alive / online / soft-deleted / agent_sessions
make inspect-groups         # groups + active members + last activity
make inspect-events N=50    # most recent events with sender/parent/preview
```

For dev runtime override: `SYNCHRONIZE_HOME=$(pwd)/.dev-synchronize make doctor`.

## Symptom router

| Symptom | Load |
|---|---|
| Peer disappearance, "404 Peer not found", Pi/MCP cleanup misbehavior, alive-but-unreachable | `peer-lifecycle.md` |
| Daemon won't run / running from wrong worktree / port collision / lock issues / restart cascades | `daemon-forensics.md` |
| DM/group/thread/@mention/media routing problems, channel-push vs inbox confusion, alias-vs-session_name traps | `delivery-forensics.md` |
| Confusing reply target, stale `in_reply_to`, or "which exact event did this answer?" | `reply-target-forensics.md` |
| Running an isolated daemon for testing without touching production state | `dev-server-mode.md` |
| Need raw forensic SQL (live roster, soft-delete forensics, thread walks, inbox depth, stale agent_sessions) | `db-queries.md` |
| "Where in the code does X live?" — file/symbol/env-var navigation | `glossary.md` |
| Hard reference to a previous design or implementation session — **gated load** | `reference-v0-plans.md` |

## Mid-session health check

When something feels off, run `make doctor` and skim the output. Look for:
- `worktree:` line points where you expect
- Soft-deleted peer count growing during a session that shouldn't be deleting peers
- Groups with `active_members` lower than expected
- Events table not growing during active conversation

If anything's off, follow the symptom router.

## Working principle

The Makefile is the canonical tool surface. If you find yourself reaching
for ad-hoc shell pipelines, consider whether a new `make inspect-*` target
would serve future sessions better — and add it.

Detail files cross-reference each other liberally. Load multiple if needed,
but in symptom-order rather than reading-everything order.
