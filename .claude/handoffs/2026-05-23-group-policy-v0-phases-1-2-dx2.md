# Session handoff — Group policy v0: design, Phase 1, Phase 2, dx2 TUI suffix

**Date:** 2026-05-23
**Continuation of:** `2026-05-22-web-chat-ui-vim-colors-toasts.md`
**Integration branch:** `worktree-plan-group-policy-v0` (worktree at `.claude/worktrees/plan-group-policy-v0/`)
**Integration tip:** `342128e`
**Status:** Phases 1, 2, and the TUI half of dx2 shipped on the integration branch. Master is unchanged — the whole epic merges back in one bundle when Phase 3 lands.

---

## 1. Session overview

This session followed the web-chat-ui handoff. The user asked for a deep look at the group creation / joining / registering policy in `synchronize`, then grilled the design tree through an `AskUserQuestion`-driven interview, landed on a coherent v0 group-policy plan, filed a Beads epic + child beads, and shipped the first three implementation chunks.

Three things from the prior session that mattered for this one:

- The hook-based agent-session registration (sync-0ql cluster) had been **merged into master** as commit `813b5e3` *before* this session opened, but several of its child beads (`sync-2l1`, `sync-49i`, `sync-wyx`, etc.) were still showing OPEN. The very first move this session was to verify and close those beads — the hook epic is fully closed now.
- The web chat UI from the prior session was on a separate branch (`feat/web-chat-ui`); this session merged it into master at the start. Master tip when this session ended: `813b5e3` (unchanged after the merge of feat/web-chat-ui as `166f841` → `d03593f`).
- `DaemonDataSource` (the live data adapter for the web UI) is still a throwing stub — tracked under `sync-jix`. That gates the web half of any "render with daemon data" work, including dx2's web portion.

---

## 2. Worktree map (created this session)

```
.claude/worktrees/
├── plan-group-policy-v0/             <-- INTEGRATION BRANCH (worktree-plan-group-policy-v0)
│                                         contains plan doc + Phase 1 + Phase 2 + dx2
├── phase1-identity-join-hardening/   <-- worktree-phase1-identity-join-hardening
│                                         (kept, ff-merged into integration)
├── phase2-bug-cluster/               <-- worktree-phase2-bug-cluster
│                                         (kept, ff-merged into integration)
└── sync-dx2-tui-suffix/              <-- worktree-sync-dx2-tui-suffix
                                          (kept, ff-merged into integration)
```

All four branches still exist locally. The integration branch fast-forwarded through Phase 1 → Phase 2 → dx2 — no merge commits, linear history.

---

## 3. Commits on the integration branch (newest first)

```
342128e  feat(tui): render alias#<suffix> in synchronize top peer listing  [sync-dx2]
282ee3e  fix(groups): case-insensitive name collision + ephemeral media-dir cleanup  [sync-49i]
871aa79  docs(plan): group policy v0 design (epic sync-l91)
6e8523c  chore(events): pin canonical event types in a TS const + SQLite CHECK
8b04a11  feat(groups): identity-bound alias with reclaim audit + bridge_rename_in_group  [sync-2l1]
813b5e3  feat(hooks): auto-register Claude and Pi agent sessions with daemon  (already on master)
```

Tests: **27 pass, 0 fail** at the integration tip.

---

## 4. Group policy v0 — the architectural decisions

Full design at `session-tracker/plan-group-policy-v0.md` (committed as `871aa79`). The load-bearing decisions:

### Identity & alias

- **Hook is the canonical registration path.** `bridge_whoami` returns peer + `agent_sessions[]` with `host_session_id`. Group join uses that identity.
- **Alias unique among *active* members only.** Partial unique index `WHERE active = 1` stays — leaving frees the alias. **This is intentional** to support respawn: a fresh peer_id under the same logical role can reclaim its old alias.
- **`group_member_alias_reclaimed`** event emitted when a freed alias is claimed by a different peer_id than its previous holder. Makes respawn visible vs. impersonation.
- **`bridge_rename_in_group({ name, new_alias })`** — self-scoped (daemon trusts the MCP-passed peer_id; admin/other-peer renames deferred to v1).
- **Roster/history always render `alias#<suffix>`** — `host_session_id[0:6]` if bound, `peer_id[0:4]` for CLI fallback peers. Deterministic, not collision-resistant.
- **CLI fallback peers are allowed**, marked second-class via the suffix scheme.

### Threads (Phase 3a)

- **`events.parent_event_id INTEGER NULL`**, one level deep, daemon normalizes reply-to-reply to the thread root.
- `bridge_send_group({ name, message, in_reply_to? })`, `bridge_group_history({ name, thread_of? })`.

### Mentions & notification routing (Phase 3b)

- **`events.mentions_json TEXT NULL`** — resolved peer_ids at send time. Body keeps literal `@alias` text.
- Unresolved `@token` → message sends with `warnings: [{ token, reason }]`.
- Routing matrix:

  | context | push | inbox |
  |---|---|---|
  | main channel msg | mentions only | all members |
  | thread reply | root_author ∪ thread_posters ∪ new mentions | all members |
  | group_joined/left/alias_reclaimed | none | all members |

### Access control (Phase 3c)

- **All groups public by default** in v0; no `groups.visibility` column.
- **CLI-only admin** via privileged daemon-host commands (`synchronize group block/allow/acl`). No MCP tools touch ACL.
- New `group_acl(group_id, key_type, key_value, status)` table. `key_type ∈ {peer_id, host_session_id}`.
- Block effect: group visible in `listGroups`, ops return 403.

### Deferred to v1

In-band admin roles, group archive/delete/rename, visibility levels beyond block-list, per-thread ACL, ACL `allowed` invite status, mention-search FTS.

---

## 5. What was implemented (in chronological order)

### Phase 1 — Identity & join hardening (`sync-2l1`, closed)

Commits: `8b04a11` + `6e8523c`.

- **Reclaim detection in `POST /groups/:name/join`** (`src/daemon.ts:621-647`): queries the most-recent inactive holder of the alias; if a different peer_id, emits `group_member_alias_reclaimed`.
- **`POST /groups/:name/rename`** + `renameInGroup` API helper + `bridge_rename_in_group` MCP tool + `synchronize group rename` CLI subcommand.
- **`group_member_renamed`** event for audit.
- **`host_session_id` on every group_members response row** via `MEMBER_SELECT_SQL` subquery against `agent_sessions` (latest binding).
- **`EVENT_TYPES` TS const + SQLite CHECK constraint** pinning canonical event types. Includes `media_changed` reserved for future media-edit events.
- **`bridge_join_group` tool description** updated to mention rename + reclaim.
- **Skill docs** (claude/codex/pi) updated.

### Phase 2 — Bug cluster (`sync-49i`, closed)

Commit: `282ee3e`.

- **Case-insensitive group-name collision check** before insert (`src/daemon.ts:584-595`); `media_dir` lowercased.
- **Ephemeral media-dir cleanup**: extracted ephemeral row purge from `db.ts:migrate` into new `pruneEphemeralGroups(db, removeMediaDir)`. Daemon `main()` calls it with `rm -rf` as the callback.

De-scoped during re-evaluation:

- `sync-rwy` (CLI duplicate peers) — **verified fixed** by current `resolveCliRegisterPeerId` + `findReusablePeer`. 3× register from one home → 1 peer. Closed.
- `sync-0oc` (top/status duplicate display) — **superseded by `sync-dx2`**. Closed.

### dx2 — TUI suffix rendering (`sync-dx2`, closed)

Commit: `342128e`.

- **`/summary` peers query** now joins `agent_sessions` to surface `host_session_id` per peer (`src/daemon.ts:286-302`).
- **`peerDisplayName()`** helper in `src/cli/render/summary.ts` — exported so other CLI surfaces can reuse it.
- **`synchronize top`** renders `session_name#<suffix>` for every peer row. Suffix is `host_session_id[0:6]` when bound, `peer_id[0:4]` otherwise.
- Web UI half of dx2 is **structurally blocked by `sync-jix`** (`DaemonDataSource` is still a throwing stub). When `sync-jix` lands, the same `peerDisplayName` helper applies.

---

## 6. Beads board state — group policy epic (`sync-l91`)

```
sync-l91 [epic] Group policy v0  ........................ open
├── ✓ sync-2l1  Phase 1: identity & join hardening
├── ✓ sync-49i  Phase 2: bug cluster
├── ○ sync-1vi  Phase 3a: Slack-style threads             ← NEXT
├── ○ sync-6kt  Phase 3b: mentions + notification routing (depends on sync-1vi)
├── ○ sync-aeb  Phase 3c: ACL / blocks (CLI-only admin)
└── ○ sync-6kc  Phase 3d: group description metadata

Follow-ups filed during this session:
○ sync-dx2  Render alias#<suffix> in TUI and web UI            <-- CLOSED (TUI done; web blocked on sync-jix)
○ sync-cg8  Daemon-side identity enforcement for self-scoped mutations (P3, deferred)

Closed this session:
✓ sync-0ql  Design agent session correlation hooks   (verified shipped in 813b5e3)
✓ sync-buz  Implement agent session hook bindings    (verified shipped in 813b5e3)
✓ sync-wyx  Add daemon-backed host session bindings  (verified shipped in 813b5e3)
✓ sync-9e0  Implement Claude Code session hook       (verified shipped in 813b5e3)
✓ sync-gt8  Move Pi session correlation              (verified shipped in 813b5e3)
✓ sync-fl6  Design launch wrappers                   (verified shipped in 813b5e3)
✓ sync-7fq  Preserve correct tool attribution        (verified shipped in 813b5e3)
✓ sync-rwy  Avoid duplicate CLI peers                (verified fixed by existing code)
✓ sync-0oc  Improve top/status duplicate display     (superseded by sync-dx2)
```

---

## 7. What's next — Phase 3a (sync-1vi)

The natural next claim. Scope per the plan doc:

**Schema**

```sql
ALTER TABLE events ADD COLUMN parent_event_id INTEGER REFERENCES events(event_id);
CREATE INDEX idx_events_group_parent_event ON events (group_id, parent_event_id, event_id);
```

**API**

- `bridge_send_group({ name, message, in_reply_to? })` — daemon normalizes `parent_event_id`: if `target = events[in_reply_to]`, `parent_event_id = target.parent_event_id ?? target.event_id` (collapses reply-to-reply to root).
- `bridge_group_history({ name, thread_of? })` — when `thread_of` is set, return root + replies in chronological order; when unset, exclude thread replies from main-channel history.

**Files to touch**

- `src/db.ts` — column + index (no migration ceremony, no production data)
- `src/daemon.ts` — `POST /groups/:name/messages` parent normalization; `GET /groups/:name/history` filter
- `src/api/groups.ts` — `sendGroupMessage` and `getGroupHistory` shapes
- `src/mcp/tools/groups.ts` — tool input schemas
- `tests/api.test.ts` — normalization, thread filter, main-channel exclusion

**What's intentionally *not* in 3a**

- Notification routing for thread replies — that's Phase 3b (`sync-6kt`).
- Per-thread ACL — v1.

Phase 3b is bundled tightly with 3a (shares the `notifySubscribers` rewrite). Recommend keeping them as adjacent worktrees with the same base.

---

## 8. Open follow-ups (not blocking Phase 3)

- **`sync-cg8` (P3, deferred):** daemon-side identity enforcement for self-scoped writes (rename, group create). Current model: daemon trusts request-body `peer_id`. Documented as the v0 trust boundary; ADR or memo decision needed before any change.
- **`sync-dx2` web half:** gated on `sync-jix` (`DaemonDataSource`). When that adapter lands, reuse `peerDisplayName` from `src/cli/render/summary.ts`.
- **Manual smoke test gate for Phase 1:** the user explicitly waived this. CLI verification (3× register → 1 peer) was treated as sufficient.

---

## 9. Test state

```
$ bun test
27 pass, 0 fail, 145 expect() calls
Ran 27 tests across 7 files
```

New tests added this session (all in `tests/api.test.ts`):

- alias reclaim audit (same-peer rejoin silent; different-peer reclaim emits event)
- rename round-trip + collision rejection
- `host_session_id` surfacing on `/peers?group=`
- `events.type` CHECK rejects unknown types
- case-insensitive group name collision
- ephemeral media-dir purged on daemon restart
- summary peers carry `host_session_id` + `peerDisplayName` composes suffix

---

## 10. Continuation pointers

To start Phase 3a from a fresh session:

```bash
# Enter the integration worktree (or create a fresh Phase 3a worktree from it)
cd .claude/worktrees/plan-group-policy-v0
git log --oneline -1     # should be 342128e
bun test                  # should pass 27/27
bd update sync-1vi --claim
# spin a new worktree branched off integration tip; implement; ff-merge back.
```

Key context: design plan at `session-tracker/plan-group-policy-v0.md`. The notification routing decisions in section "Mentions & notification routing" are Phase 3b — do not implement in 3a; 3a is purely storage + query.

When the whole epic is done (Phases 3a/3b/3c/3d), merge `worktree-plan-group-policy-v0` into master in one bundle.
