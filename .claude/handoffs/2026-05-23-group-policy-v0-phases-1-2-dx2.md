# Session handoff — Group policy v0: design + Phases 1, 2, 3a, 3b, 3d + dx2 TUI

**Date:** 2026-05-23
**Continuation of:** `2026-05-22-web-chat-ui-vim-colors-toasts.md`
**Integration branch:** `worktree-plan-group-policy-v0` (worktree at `.claude/worktrees/plan-group-policy-v0/`)
**Status:** Phases 1, 2, 3a, 3b, 3d shipped on the integration branch. Phase 3c (ACL/blocks) intentionally deferred — see section 4.5. dx2 TUI half shipped; web half blocked on `sync-jix`. Master is unchanged; the integration branch is ready for a bundle merge once you've reviewed the diff.

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
<this commit>  docs(handoff): group policy v0 — full epic recap, 3c deferred
<3d>  feat(groups): description metadata + describe CLI + topic line in RoomHeader  [sync-6kc]
<3b>  feat(groups): mention-aware + thread-aware notification fanout              [sync-6kt]
<3a>  feat(groups): Slack-style threads — parent_event_id + thread_of + in_reply_to  [sync-1vi]
d132572   docs(handoff): group policy v0 — phases 1, 2, and dx2 TUI complete  (this file, earlier revision)
342128e  feat(tui): render alias#<suffix> in synchronize top peer listing  [sync-dx2]
282ee3e  fix(groups): case-insensitive name collision + ephemeral media-dir cleanup  [sync-49i]
871aa79  docs(plan): group policy v0 design (epic sync-l91)
6e8523c  chore(events): pin canonical event types in a TS const + SQLite CHECK
8b04a11  feat(groups): identity-bound alias with reclaim audit + bridge_rename_in_group  [sync-2l1]
813b5e3  feat(hooks): auto-register Claude and Pi agent sessions with daemon  (already on master)
```

Tests at the current tip: **33 pass, 0 fail** across 7 test files. Typecheck clean.

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

### Access control (Phase 3c) — **deferred from v0**

The plan-doc design (`group_acl` table + CLI-only admin + 403 on blocked routes) is unchanged; we chose not to ship it. Rationale recorded explicitly so a future iteration doesn't have to redo the thinking:

- **No adversary to defend against.** Single-machine, single-user tool. The user controls every agent.
- **It contradicts the v0 trust posture.** We already chose not to enforce identity at the daemon (`sync-cg8` deferred to P3 with the rationale "we are the hostile direct REST caller use case"). Policing group access without policing identity is incoherent.
- **The plan already deferred everything *around* it to v1.** Without `role`, `visibility`, `allowed`, or per-thread ACL, shipping just `blocked` leaves a half-finished concept sitting in the schema.
- **Cheap to add later.** One table + one index, one `ensureNotBlocked` helper called from ~5 routes, three CLI subcommands. Nothing in 3a/3b/3d locks the door — schemas/touchpoints stay clean.

**Reconsider when** an adversary appears: untrusted/autonomous agents, multi-user daemon, or compliance-style "secrets" groups other agents shouldn't peek into. `sync-aeb` stays OPEN at P3 with a deferral note; design intact in `session-tracker/plan-group-policy-v0.md`.

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

### Phase 3a — Slack-style threads (`sync-1vi`, closed)

- **Schema:** `events.parent_event_id INTEGER REFERENCES events(event_id) ON DELETE CASCADE` + `idx_events_group_parent_event(group_id, parent_event_id, event_id)`.
- **Send normalization:** `POST /groups/:name/messages` accepts `in_reply_to`; daemon resolves to the thread root via `resolveThreadParent` (reply-to-reply collapses to original root). Threads stay one level deep.
- **History filter:** `GET /groups/:name/history?thread_of=<root>` returns root + replies in chronological order. Without `thread_of`, main channel hides thread replies (`parent_event_id IS NULL`).
- **Validation:** `thread_of` must point to a root event in the same group (rejects non-root and non-existent); `in_reply_to` must reference an event in the group.
- **Surfaces:** `bridge_send_group` + `bridge_group_history` MCP tools gain optional thread params; `synchronize group send … --in-reply-to N` and `… history … --thread-of N` CLI flags.
- **Tests:** thread normalization, default-history filter, validation rejections.

### Phase 3b — Mentions + notification routing (`sync-6kt`, closed)

- **Schema:** `events.mentions_json TEXT` — JSON array of resolved peer_ids at send time.
- **Resolver:** `resolveMentions` parses `@token` against active `group_members.alias`. Unresolved → non-fatal `warnings: [{token, reason: "alias_not_in_group"}]` on the send response. Message still sends.
- **Push routing** (matches the spec routing table exactly):
  - Main channel → mentioned peers only.
  - Thread reply → root author ∪ prior thread posters (via `computeThreadParticipants`) ∪ this-message mentions; sender excluded.
  - Roster events (`group_joined` / `group_left` / `group_member_renamed` / `group_member_alias_reclaimed`) → **no push**.
- **Inbox fanout:** messages still hit every active member (unchanged). Roster events **now also hit every active member's inbox** via `fanoutRosterEventToInbox`. Durable visibility for the membership timeline.
- **Decision recorded:** media-share push was *not* rescoped — it still pushes to all active members. Spec didn't list media in the routing table; left for a future pass if it matters.
- **Tests:** mention resolution + warnings + main-channel push isolation; thread reply push reaches root author + thread posters + new mentions; roster events land in inboxes without pushing. One existing `messaging.test.ts` assertion updated because roster events now show up in inboxes.

### Phase 3d — Group description metadata (`sync-6kc`, closed)

- **Schema:** `groups.description TEXT` nullable.
- **REST:** `POST /groups` accepts optional `description`; new `PATCH /groups/:name` with `{description?: string | null}` — `null` or empty/whitespace string clears.
- **CLI:** `synchronize group create … --description TEXT` plus a new `synchronize group describe NAME DESCRIPTION | --clear` subcommand.
- **Web UI:** `Room.description?: string` added to the data type; `RoomHeader` renders a `.room-topic` line below the meta row when present. Styled in `extra.css`. Empty case is a no-op, so MockDataSource consumers stay unaffected until `DaemonDataSource` (`sync-jix`) lands.
- **Test:** round-trip create-with-description → listGroups → patch overwrite → null clear → whitespace normalize → plain-create defaults to null.

---

## 6. Beads board state — group policy epic (`sync-l91`)

```
sync-l91 [epic] Group policy v0  ........................ closed
├── ✓ sync-2l1  Phase 1: identity & join hardening
├── ✓ sync-49i  Phase 2: bug cluster
├── ✓ sync-1vi  Phase 3a: Slack-style threads
├── ✓ sync-6kt  Phase 3b: mentions + notification routing
├── ○ sync-aeb  Phase 3c: ACL / blocks (CLI-only admin)        ← P3, deferred
└── ✓ sync-6kc  Phase 3d: group description metadata

Follow-ups still open:
○ sync-aeb  ACL/blocks — deferred from v0; design intact; reconsider when multi-user, untrusted agents, or sensitive groups appear
○ sync-cg8  Daemon-side identity enforcement for self-scoped mutations (P3, deferred)
○ sync-dx2 (web half)  Render alias#<suffix> in web UI — gated on sync-jix (DaemonDataSource)
○ sync-jix DaemonDataSource implementation (gating sync-dx2 web half + future web rendering of description, threads, mentions)

Closed this session:
✓ sync-l91  Group policy v0 epic                       (closed with 3c explicitly out-of-scope)
✓ sync-2l1  Phase 1 identity hardening
✓ sync-49i  Phase 2 bug cluster
✓ sync-1vi  Phase 3a Slack-style threads
✓ sync-6kt  Phase 3b mentions + notification routing
✓ sync-6kc  Phase 3d group description metadata
✓ sync-dx2  TUI suffix rendering                       (web half remains open under sync-dx2 / sync-jix)
✓ sync-0ql  Design agent session correlation hooks    (verified shipped in 813b5e3)
✓ sync-buz, sync-wyx, sync-9e0, sync-gt8, sync-fl6, sync-7fq  Hook epic children (all verified)
✓ sync-rwy  CLI duplicate peers                       (verified fixed by existing code)
✓ sync-0oc  top/status duplicate display              (superseded by sync-dx2)
```

---

## 7. What's next — bundle merge to master

The integration branch is feature-complete for v0 (less 3c, which is deferred by design). Recommended next move:

```bash
cd .claude/worktrees/plan-group-policy-v0
git log --oneline master..HEAD     # review the bundle
bun test && bun run typecheck      # final sanity (expect 33 pass)
git checkout master
git merge --no-ff worktree-plan-group-policy-v0 -m "merge group policy v0 epic (sync-l91)"
```

After the merge:

- The four phase worktrees (`phase1-…`, `phase2-…`, `sync-dx2-tui-suffix`, `plan-group-policy-v0`) can be removed with `git worktree remove --force`.
- The 3c follow-up lives on as `sync-aeb` at P3; reconsider when an adversary actually appears.
- `sync-jix` becomes the next natural target — wiring `DaemonDataSource` unlocks the web half of dx2 and surfaces threads/mentions/descriptions in the web UI.

---

## 8. Open follow-ups (not blocking Phase 3)

- **`sync-cg8` (P3, deferred):** daemon-side identity enforcement for self-scoped writes (rename, group create). Current model: daemon trusts request-body `peer_id`. Documented as the v0 trust boundary; ADR or memo decision needed before any change.
- **`sync-dx2` web half:** gated on `sync-jix` (`DaemonDataSource`). When that adapter lands, reuse `peerDisplayName` from `src/cli/render/summary.ts`.
- **Manual smoke test gate for Phase 1:** the user explicitly waived this. CLI verification (3× register → 1 peer) was treated as sufficient.

---

## 9. Test state

```
$ bun test
33 pass, 0 fail, 179 expect() calls
Ran 33 tests across 7 files
```

Typecheck (`bun run typecheck`) clean.

New tests added this session (all in `tests/api.test.ts` unless noted):

**Phase 1 / Phase 2 / dx2:**
- alias reclaim audit (same-peer rejoin silent; different-peer reclaim emits event)
- rename round-trip + collision rejection
- `host_session_id` surfacing on `/peers?group=`
- `events.type` CHECK rejects unknown types
- case-insensitive group name collision
- ephemeral media-dir purged on daemon restart
- summary peers carry `host_session_id` + `peerDisplayName` composes suffix

**Phase 3a (threads):**
- thread replies collapse to root and main-channel history excludes them
- `thread_of` rejects non-root and non-existent events; `in_reply_to` rejects orphan target

**Phase 3b (mentions + routing):** uses a local `Bun.serve` push sink so we can assert per-peer push counts, not just inbox writes
- group message mentions resolve to peer_ids and main-channel push reaches only mentioned peers; non-mentioned peers still get inbox rows; unresolved tokens surface in `warnings`
- thread reply push reaches root author + prior thread posters + new mentions; sender never pushes to self
- roster events (rename + leave) land in every active member's inbox but never push
- one assertion in `tests/messaging.test.ts` updated to filter inbox rows by `type === "group_message"` because roster events now appear in inboxes

**Phase 3d (description):**
- description persists at create (with whitespace trim), surfaces in `listGroups`, mutable via `PATCH /groups/:name`, null/empty clears, plain-create defaults to null

---

## 10. Continuation pointers

```bash
cd .claude/worktrees/plan-group-policy-v0
git log --oneline master..HEAD   # see the full bundle
bun test                          # 33 pass
bun run typecheck                 # clean
```

To merge to master:

```bash
git checkout master
git merge --no-ff worktree-plan-group-policy-v0 -m "merge group policy v0 epic (sync-l91)"
```

Key references that should survive this session:

- `session-tracker/plan-group-policy-v0.md` — the design doc. Still accurate. 3c section is the design we explicitly chose not to ship; keep it as the spec for when `sync-aeb` is picked up.
- Routing matrix in section 4 above — the source of truth for who-pushes-where.
- `peerDisplayName` in `src/cli/render/summary.ts` — the shared suffix helper for any future renderer.
- `resolveMentions` + `computeThreadParticipants` + `fanoutRosterEventToInbox` in `src/daemon.ts` — the three helpers that encode the routing matrix; touch these together if you ever rework fanout.

## 11. Decisions taken along the way (not re-derivable from code)

- **Alias is freed on leave, not permanently bound to a peer.** Supports respawn. Reclaim event distinguishes respawn from impersonation.
- **Display suffix = `host_session_id[0:6]` if bound, else `peer_id[0:4]`.** Deterministic, not collision-resistant. CLI fallback peers are second-class on purpose.
- **Daemon trusts request-body `peer_id` at v0** ("we are the hostile direct REST caller use case"). `sync-cg8` files the enforcement deferral.
- **Threads are one level deep**, daemon collapses reply-to-reply to root. No nested-thread UI to design.
- **`@mention` only governs push routing, not inbox visibility.** Inbox is always full-fanout for messages. Mentions are an attention signal, not an ACL.
- **Roster events (joined/left/renamed/reclaimed) now fan out to all members' inboxes.** Push remains off for them. Lets agents reconstruct membership timeline on reconnect.
- **Media share push was *not* rescoped.** Spec didn't cover media in the routing table; left as full-fanout. Revisit if it becomes noisy.
- **Phase 3c (ACL) was deferred from v0 as a deliberate scoping call.** Rationale captured in section 4 above. Design intact in the plan doc.
- **No migrations.** No production data; schema changes land in `CREATE TABLE` bodies; `make daemon-relaunch` wipes any local dev state.
- **CLI verification was treated as sufficient.** User waived manual smoke; integration tests + typecheck are the bar.
- **Master merge will preserve history, not bundle-squash.** Decision taken 2026-05-23 after the audit. The master commit graph should reflect the iteration order (Phase 1 → 2 → 3a → 3b → 3d → handoff → integrity doc → skills polish → testing harness merge) so future archaeology can pin behaviors to phases. Use `git merge --no-ff`, not `git merge --squash`.
- **Integration harness lives on master, not on a tooling sideband.** The `group-policy-v0-additional-testing` branch was merged into the integration branch (commit `1658b08`, two parents) before the master merge. Rationale: keeping the harness with the daemon source means a regression to the daemon trips the right scenario in the same checkout, and the master commit graph carries the harness alongside the behavior it tests.

---

## 12. Addendum — post-audit polish (2026-05-23 evening)

After the integration-harness audit (see section 6 successor) the following landed on the integration branch before the master merge:

### Skills + plan-doc polish (commit `96b2e41`)

- `skills/synchronize-claude/SKILL.md` and `skills/synchronize-pi/SKILL.md` gained thread (`in_reply_to` / `thread_of`), mention (`@alias` + warnings shape), and CLI-only-description guidance. CLI fallback examples now show `--in-reply-to`, `--thread-of`, `--description`, `group describe`, and `group rename`.
- The Pi skill's "Replying — recipe by event type" section has explicit thread-reply and mention examples. A linter-style fix replaced a leftover `group_id=` parameter with the correct name-based group tool signature.
- `session-tracker/plan-group-policy-v0.md` "Access control" section gained a `DEFERRED FROM V0 — tracked under sync-aeb (P3)` callout. Design preserved verbatim; rationale points at this handoff and `docs/group-sync-integrity.md`.
- **`skills/synchronize-codex/SKILL.md` was NOT updated.** Per operator decision 2026-05-23, Codex is no longer maintained. Leave the file as-is unless that call is reversed.

### Testing harness folded into the integration branch (merge commit `1658b08`)

Branch `group-policy-v0-additional-testing` (commits `02ee16d`, `194373f`) was merged with `--no-ff`. Brings in:

- `scripts/integration-aoe/sync_itest_aoe/` — the shared AoE/tmux/Pi integration runtime.
- Five scenarios under `scripts/integration-aoe/sync_itest_aoe/scenarios/`: `cli_dm.py`, `group_policy_cli.py`, `pi_mcp_dm.py`, `pi_mcp_group_policy.py`, `pi_mcp_thread_baton.py`.
- Top-level wrapper scripts: `scripts/integration_{tmux,pi,group_policy_tmux,group_policy_pi,thread_baton_pi}.py`.
- `docs/integration-tmux.md`, `scripts/README.md`, and an AoE/tmux integration handoff under `.claude/handoffs/`.
- Minor edits to `AGENTS.md`, `CLAUDE.md`, `.gitignore`, `skills/synchronize-pi/SKILL.md`, `src/mcp/tools/messaging.ts`, `tests/mcp-e2e.test.ts`.

Test state at the merge commit: **33 pass, 0 fail** (`bun test`), typecheck clean.

### Beads filed post-audit

- **`sync-6p4`** (epic, P3) — Integration harness coverage gaps for group policy v0. Children:
  - `sync-r4q` B6 default-alias path; `sync-uqa` B7 alias-collision UX; `sync-or7` B11 fresh-join history boundary; `sync-hdt` D4 thread-reply push fanout; `sync-2ic` D7 stale-mention no-push.
  - Brittle-assertion fixes: `sync-egw` forbidden-tool detection; `sync-4nv` loop guard run_id dependency; `sync-3as` warning-shape assertion bypasses MCP/CLI layer.
  - Epic description explicitly enumerates the seven audit gaps that were deliberately NOT filed because they are covered by `tests/api.test.ts` (A3, B3, B4, C4, C7, C8, E1).
- **`sync-b8p`** (chore, P3) — Refactor synchronize SKILL.md files to progressive-discovery format. The monolithic Claude and Pi SKILL.md files should split into a thin SKILL.md router + `reference/*.md` topic docs (groups, threads, mentions, dms, media, inbox, event-delivery, cli-fallback, do-and-dont, troubleshooting; plus possibles for peers, security-posture, v0-known-limits). Codex skill is out of scope.

### Pre-master-merge state

```
integration tip:  1658b08  (merge commit: 96b2e41 + 194373f)
master tip:       813b5e3  (unchanged — auto-register hook merge)
tests:            33 pass, 0 fail
typecheck:        clean
working tree:     clean
```

### What's left before master merge

1. **Manual verification with live agents** (operator-driven; harness can't model model-driven variation).
2. **Master merge as plain `--no-ff`**, not a squash. Preserve the phase-by-phase commit history.
3. **Worktree cleanup post-merge:**
   - `git worktree remove --force .claude/worktrees/phase1-identity-join-hardening`
   - `git worktree remove --force .claude/worktrees/phase2-bug-cluster`
   - `git worktree remove --force .claude/worktrees/sync-dx2-tui-suffix`
   - `git worktree remove --force .claude/worktrees/group-policy-v0-additional-testing`
   - `git worktree remove --force .claude/worktrees/plan-group-policy-v0`
   - Delete the corresponding branches with `git branch -D`.

After cleanup, the master commit graph carries: the v0 epic (Phases 1, 2, 3a, 3b, 3d, dx2 TUI) + integration harness + integrity reference doc + updated skills + plan doc with explicit 3c deferral. Open at master tip: `sync-aeb` (ACL deferred), `sync-cg8` (daemon identity enforcement deferred), `sync-jix` (DaemonDataSource), `sync-dx2` web half (gated on `sync-jix`), `sync-6p4` (harness coverage gaps), `sync-b8p` (skill refactor).
