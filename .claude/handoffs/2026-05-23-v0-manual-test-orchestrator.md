# Session handoff — Group policy v0 manual test orchestration

**Date:** 2026-05-23 (evening, after the post-audit polish handoff in `2026-05-23-group-policy-v0-phases-1-2-dx2.md`)
**Continuation of:** `2026-05-23-group-policy-v0-phases-1-2-dx2.md`
**Integration worktree:** `.claude/worktrees/plan-group-policy-v0/`
**Integration branch:** `worktree-plan-group-policy-v0`
**Integration tip:** `5e0ce30` (parent: `1658b08`, the testing-harness merge commit)
**Status:** v0 implementation is feature-complete and merged on the integration branch. Manual verification with live agents is mid-flight. Several bugs have surfaced and are not yet filed as beads. Master merge is paused until bugs are confirmed and triaged.

---

## 0. Directive to the resumed agent — READ FIRST

**You are the operator.** A live `synchronize` daemon is running on this machine at `~/.synchronize` (default location, port `58405`, pid likely changed since last session — re-check). You are a third agent on that daemon, registered under `session_name=operator`, `peer_id=507784dc-01d9-4a03-a269-cfa2f70a3666`, `host_session_id=500087c7-…` (binding ties to this Claude Code conversation).

You are **not** a participant in the `Manual-Test-V0` group. You orchestrate testing from outside.

Two other agents are live on the same daemon:

```
┌──────────────────────────────────────────────────────────────────────┐
│  ~/.synchronize daemon  (port 58405, pid varies)                     │
│                                                                      │
│  peer: bob#a3faeb        Claude (Opus 4.7)                           │
│         peer_id 1a14b62e…       host_tool=claude                     │
│         joined Manual-Test-V0 as alias "bob"   (active)              │
│         lease auto-renewed by Claude channel subscription            │
│                                                                      │
│  peer: Karen (was)       Pi agent                                    │
│         peer_id 1c21ac84…       host_tool=pi                         │
│         joined Manual-Test-V0 as alias "agent"  (active=1 was)       │
│         *** peer row WAS deleted between turns; Pi process still     │
│             running and logging "heartbeat failed: Peer not found"   │
│             every 15s. See section 4 for root-cause investigation. ***│
│                                                                      │
│  peer: operator (you)    Claude Code orchestrator                    │
│         peer_id 507784dc…       host_tool=claude                     │
│         NOT in any group. Drives tests via bridge_dm.                │
└──────────────────────────────────────────────────────────────────────┘
```

**The goal of this manual testing activity** is to verify v0 group-policy behaviors end-to-end on live model-driven agents (bob = Claude, Karen = Pi), find issues that unit and integration tests don't catch, root-cause each issue against the daemon code, and file bd issues for confirmed bugs. The user's words: "I give you full control. As you find different issues make sure to also validate them from the state. Be sure about them. If possible understand the root cause and then create Beads issues for bugs that you find. We will work on them and iterate."

**You have access to:**
- All 16 `synchronize` MCP `bridge_*` tools (via `mcp__synchronize__bridge_*`). Use them. Especially `bridge_dm` to talk to bob and Karen, `bridge_inbox` (with `ack: true`) to receive their replies, `bridge_whoami` to confirm your identity, `bridge_list_peers` to see who's online.
- Direct SQLite access to the live DB: `sqlite3 /Users/abhirupdas/.synchronize/synchronize.db` for ground-truth verification.
- REST: `curl http://127.0.0.1:58405/...` (port may have changed; check `~/.synchronize/daemon.json`).
- The integration worktree itself for code reading (`src/daemon.ts`, `extensions/pi-synchronize/`).
- `bd` for issue filing.
- `synchronize top --once` for a live snapshot.

**Operating principle:** never trust an agent's self-report — always cross-check against SQLite or REST. Agents (especially live model-driven ones) describe what they think they see, not necessarily what the daemon stored. Several confirmed bugs in this session came from agent statements that contradicted the DB.

---

## 1. Why this handoff exists

The previous handoff (`2026-05-23-group-policy-v0-phases-1-2-dx2.md`) covers everything up to "v0 implementation complete, integration harness merged, ready for manual verification." After that handoff was written, the user:

1. Reinstalled MCPs (`make daemon-kill && make install-claude install-pi`).
2. Launched live Claude (bob) and Pi (Karen) sessions with `synchronize launch claude --name bob` and `synchronize launch pi --name karel`.
3. Drove them into a manual conversation in group `Manual-Test-V0`.
4. Returned to this Claude Code session to ask the orchestrator (me) to audit state, then run more tests.

During that audit, several issues surfaced that need filing. This handoff captures the live state and the in-flight test plan so a resumed agent can pick up cleanly without rebuilding context.

---

## 2. Live runtime state (snapshot at handoff time)

### Daemon
- `~/.synchronize/daemon.json` → port `58405`, base_url `http://127.0.0.1:58405`
- Started at `2026-05-23T00:04:31Z`, started_by_cli=false (auto-spawned by first MCP call)
- DB at `~/.synchronize/synchronize.db`, media at `~/.synchronize/media/`
- Daemon binary code is from this worktree (because of `bun link` during `make install-claude install-pi`).

### Peers (as of last check)
```
peer_id            session_name  tool    online   notes
1a14b62e-…         bob           claude  yes      Active member of Manual-Test-V0 as "bob"
507784dc-…         operator      claude  yes      You — not in any group
(Karen, gone)      —             —       —        Pi peer deleted; events still reference 1c21ac84-…
```

Verify with: `sqlite3 ~/.synchronize/synchronize.db "SELECT peer_id, session_name, tool, lease_expires_at FROM peers;"`

### Group
- `Manual-Test-V0`, durable, `description: NULL`, creator = bob
- Members table currently has **1 active member** (bob, alias "bob"). Karen's row was CASCADE-deleted when her peer was deleted.

### Events (13 total at last check; will grow as bob/Karen send more)
- `1` group_created (bob)
- `2` group_joined alias=bob (bob)
- `3` group_joined alias=agent (Karen)
- `4` bob's intro message (main channel)
- `5` Karen reply to event 4 (in-thread)
- `6` bob's response with @agent (main channel)
- `7` Karen reply to event 6 (in-thread)
- `8` bob's status with @agent (main channel)
- `9` Karen reply to event 8 (in-thread)
- `10` bob's untagged main-channel message
- `11` Karen reply to event 8 (in-thread, second reply to root 8)
- `12` bob clarification with @agent (main channel)
- `13` Karen reply to event 12 (in-thread)

Karen's events (5, 7, 9, 11, 13) are now **orphan** in the sense that their `sender_peer_id` points at a peer row that no longer exists.

Conversation style observation: **bob always posts to main; Karen always replies in thread.** Four active threads rooted at events 4, 6, 8, 12. No reply-to-reply has been tested.

---

## 3. Bugs / findings so far (not yet filed in bd)

### Bug A — Pi extension session_name resolution ignores `SYNCHRONIZE_SESSION_NAME`

**Severity:** P2 (user-visible, contradicts documented behavior of `synchronize launch pi --name <NAME>`)

**Report from the user:** "I originally called with `--name karel` but when I asked Pi to do bridge_whoami, it said its whoami value was `agent`. I asked Pi: did you find the name Karel anywhere? It said no."

**Verified state:** The Pi extension log (`~/.synchronize/pi-extension.log`) shows the actual registered session_name was `pi-019e5226-0e8d-7439-aa6d-2db1386bc5a0`, NOT `karel`:

```
2026-05-23T00:04:47.184Z [synchronize-pi] pid=15716 registered
  peer_id=1c21ac84-… session_name=pi-019e5226-0e8d-7439-aa6d-2db1386bc5a0
```

**Root cause located in `extensions/pi-synchronize/src/identity.ts`:**

```typescript
export function resolveSessionName(hints: IdentityHints = {}): string {
  if (hints.piSessionId && hints.piSessionId.length > 0) return `pi-${hints.piSessionId}`;
  if (hints.envSessionName && hints.envSessionName.length > 0) return hints.envSessionName;
  // …random fallback…
}
```

The `piSessionId` (from `ctx.sessionManager?.getSessionId?.()`) is checked **first**. If present (it always is, when Pi has a session), it wins and the `SYNCHRONIZE_SESSION_NAME` env var from `synchronize launch pi --name <NAME>` is silently ignored.

**Where `--name` plumbing works correctly:** `src/cli/commands/launch.ts` correctly sets `ENV_SESSION_NAME` (which is `SYNCHRONIZE_SESSION_NAME`) in the spawned child's environment.

**Where it breaks:** `extensions/pi-synchronize/src/index.ts` startup calls `resolveSessionName({ piSessionId, envSessionName: process.env.SYNCHRONIZE_SESSION_NAME ?? null })` — the env name is passed in, but the function gives priority to `piSessionId`.

**Why this is wrong:** A user passing `--name karel` is explicitly stating their intent. The Pi session id is internal plumbing. User intent should win, with `pi-<sessionId>` as fallback when no name is provided.

**Fix proposal:** swap the order — env name wins over piSessionId. Or: keep piSessionId fallback but only when env name is absent. Either way, env name should take precedence.

**Secondary mystery (worth investigating but not blocking):** The user reports `bridge_whoami` returned `session_name: "agent"`, but the Pi extension registered `pi-019e5226-…`. Somewhere between extension registration and the whoami call, session_name changed to "agent". Possible explanations:

- The Pi LLM agent itself called `bridge_register` with `session_name: "agent"` despite the skill's "do not invent a different session_name" instruction. The Pi skill at `skills/synchronize-pi/SKILL.md` says: "When you call bridge_register, it reuses that peer id automatically — do not invent a different session_name." Pi may have disobeyed.
- The Pi LLM agent called `bridge_rename_session({ session_name: "agent" })`.
- Some Pi prompt convention defaults to "agent" when no clear name is given.

To investigate: look for the `bridge_register` / `bridge_rename_session` call in Pi's transcript at `~/.pi/agent/sessions/` and confirm Pi made the rename. If Pi did it, the bug is dual: (a) `--name` ignored, and (b) Pi self-renamed without being asked. (b) is a Pi-skill prompt-engineering issue, not a daemon bug.

### Bug B — Karen's peer disappeared while her Pi process is still running

**Severity:** P1 (cascade delete loses audit history; agents on the bus go invisible without warning)

**Verified state:**
- `sqlite3 ~/.synchronize/synchronize.db "SELECT * FROM peers WHERE peer_id='1c21ac84-…';"` → 0 rows.
- `sqlite3 ~/.synchronize/synchronize.db "SELECT * FROM group_members WHERE peer_id='1c21ac84-…';"` → 0 rows.
- `sqlite3 ~/.synchronize/synchronize.db "SELECT event_id, type, sender_peer_id FROM events WHERE sender_peer_id='1c21ac84-…';"` → returns events 3, 5, 7, 9, 11, 13. Orphan rows referencing a deleted peer.
- Pi extension log shows continuous `heartbeat failed: Peer not found: 1c21ac84-…` every 15 seconds, starting at `00:25:17Z`. The Pi process (pid 15716) is still alive and trying to maintain its peer.

**Root cause partially located:**
- Only one code path in the daemon issues `DELETE FROM peers`: `src/daemon.ts` line 533, behind `DELETE /peers/:peer_id`.
- Two callers of `deletePeer` in this repo: `extensions/pi-synchronize/src/index.ts:65` (Pi extension's teardown) and `src/mcp/lifecycle.ts:96` (MCP adapter's cleanup).
- The Pi process is still alive (heartbeats are still firing from pid 15716), so the extension's `teardown()` did NOT run for *this* Pi. Yet Karen's peer was deleted.
- **Hypothesis:** a SECOND Pi launch was started by the user (likely the "Karel" launch that became "agent" in Bug A). The launch wrapper spawned a new Pi process. That second Pi's extension teardown / startup might have observed an env var pointing at the old `SYNCHRONIZE_PEER_ID` and deleted it. Look at `extensions/pi-synchronize/src/index.ts` startup to see whether it deletes any prior peer it finds in the env.
- Alternative hypothesis: a Claude session ending (the orchestrator's prior MCP adapter shutdown) called `deletePeer` for its own peer, but used a stale peer_id by mistake. Cross-check `src/mcp/lifecycle.ts:cleanup`. Lower probability — the MCP adapter only knows its own peer_id.

**Cascade-delete side effect (regardless of root cause):**
- `group_members.peer_id REFERENCES peers(peer_id) ON DELETE CASCADE` (see `src/db.ts` schema). When the peer goes, the group_members row goes too — there is no inactive `active=0` row left behind to power the reclaim audit logic. If Karen rejoins now and claims alias "agent", the daemon's reclaim-detection query `SELECT peer_id FROM group_members WHERE active=0 AND alias=?` returns 0 rows, and the reclaim event will not fire. The audit trail Karen → some-new-peer claiming "agent" is silently lost.
- Karen's events 5/7/9/11/13 still reference `1c21ac84-…` in `sender_peer_id`. The events table has no FK on `sender_peer_id`, so the daemon doesn't catch this dangling reference at write time. Any future query that joins events to peers (e.g., a UI rendering "who sent this") will null-resolve the sender.

**Fix proposals (to discuss before filing):**
1. **Soft-delete peers** instead of hard-delete. Add `peers.deleted_at TIMESTAMP NULL`; UPDATE on cleanup. Keeps the audit trail. Filter `WHERE deleted_at IS NULL` everywhere active state is queried.
2. **Or: don't CASCADE delete group_members** when peer is deleted. Set `active=0` and leave the row. Update the FK to `ON DELETE SET DEFAULT` with a default that triggers soft-state, or remove the FK and enforce in app code.
3. **Or: make peer deletion an error** while the peer has active group memberships, forcing leave-then-delete.
4. **Also fix `events.sender_peer_id`:** add a deferred FK or accept the orphan-references as documented behavior. Simpler is "events keep historical names; renderers must handle null peer."

### Bug C — Thread-visibility UX gap in default group history (already partially proven earlier this session)

**Severity:** P3 (no functional break, but agents misread group state)

**Reported by:** bob (Claude live agent), when the user asked "How many threads are active?" bob replied "Zero. Every message so far was sent to the main channel with parent_event_id: null."

**Verified state (contradicts bob):** 5 of the 13 events have non-null `parent_event_id`. Four threads are active, rooted at events 4, 6, 8, 12.

**Root cause:** `bridge_group_history` without `thread_of` returns `parent_event_id IS NULL` only (correct per spec, "main channel hides thread replies"). But the returned events carry no signal that a thread exists for any given main-channel event. There is no `reply_count`, no `has_replies` boolean, no `last_reply_event_id`. An agent calling `bridge_group_history` and then looking only at the rows it gets has no way to know threads exist short of:

1. Calling `bridge_group_history(thread_of=<id>)` per main-channel event_id (expensive, blind).
2. Inspecting its own inbox / push notifications and noticing event_ids that didn't appear in the main view.
3. Looking at the routing matrix in the skill and inferring.

bob did none of these and confidently said "no threads." This is the kind of issue a human would never make (humans look at the UI and see the reply count). Agents need an affordance.

**Fix proposals:**
- Add `reply_count: integer` and `last_reply_event_id: integer | null` to events returned in the default history view. Cheap subquery in the daemon (or use the existing thread index).
- Alternatively: add a `bridge_group_threads({ name })` tool that returns `[{ root_event_id, reply_count, last_reply_at }]` — a "thread summary" view.
- Don't change the default behavior of `bridge_group_history` (still hides thread replies). Just augment the metadata.

**Where to consider this in code:** `src/daemon.ts` group history handler, around line 803.

### Bug D — Bob's stale-mention exposure (related but not yet tested)

When Bug B (Karen vanished) is combined with `@agent` mentions: if bob now sends a message mentioning `@agent`, the mention resolver should fail (no active member named "agent"), produce a warning, and not push to anyone for that token. This is also the natural test for D7 from the integration audit. **Not yet verified live**, but the setup is ripe — Karen is gone, bob can be DM'd to fire a test send.

---

## 4. Tasks in flight (TaskCreate ephemeral list)

The current task list (these are session-ephemeral, not bd):

| # | Status | Subject |
|---|---|---|
| 1 | in_progress | Root-cause Karen's peer disappearance + cascade-delete (Bug B) |
| 2 | pending | Test C3: reply-to-reply collapse to thread root |
| 3 | pending | Test D2: unresolved @ghost mention warning shape end-to-end |
| 4 | pending | Test B10: rename_in_group event + fanout |
| 5 | pending | Test B9: alias reclaim audit event |
| 6 | pending | File bd issue: thread-visibility UX gap (Bug C, already proven) |

Resume by calling `TaskList` then `TaskGet <id>` for any item. Re-claim task #1 if you continue investigation.

---

## 5. What to do next (concrete)

**Highest leverage, in order:**

1. **Resume Bug B root cause.** Confirm whether `extensions/pi-synchronize/src/index.ts` startup ever calls `deletePeer` on an env-discovered peer_id, or whether a Pi process restart deletes the prior peer. Tail `~/.synchronize/pi-extension.log` (might require restoring Pi); inspect `~/.pi/agent/sessions/*.json` for evidence of a second Pi launch.

2. **File bd issues for confirmed bugs (A, B, C).** Use the existing bead format. Recommend:
   - **Bug A (Pi `--name` ignored):** `bug`, P2, "Pi extension's resolveSessionName ignores SYNCHRONIZE_SESSION_NAME when piSessionId is present". Include the code snippet, the log evidence, the fix proposal.
   - **Bug B (peer cascade-delete loses audit):** `bug`, P1, "Hard delete of peer cascades to group_members and breaks reclaim-event audit". Include the DB-state evidence, the orphan events, the chain to the reclaim flow.
   - **Bug C (thread visibility):** `feature` or `bug` (judgement), P3, "bridge_group_history default view gives no signal that thread replies exist". Include bob's confused exchange + the routing matrix from `docs/group-sync-integrity.md`.

3. **Run the remaining test sequences** (tasks #2, #3, #4, #5). For each, DM the live agent (bob is reliable; Karen needs to be re-launched first), have them perform a specific MCP tool call, capture their reply via `bridge_inbox`, and verify against SQLite. Use precise tool-call wording in DMs to avoid the agent paraphrasing.

4. **Karen-revival decision.** Pi process pid 15716 is still alive but its peer is gone. The user may want to:
   - Let Pi self-recover (it won't — the extension doesn't currently re-register on heartbeat-not-found).
   - Kill the Pi process and `synchronize launch pi --name karel` again.
   - Add a "re-register on heartbeat-not-found" path to the Pi extension as a fix for Bug B's user-facing impact.

   This decision is the user's, not yours — ask before assuming.

---

## 6. Code & state pointers

- **Worktree:** `/Users/abhirupdas/Codes/Personal/synchronize/.claude/worktrees/plan-group-policy-v0/`
- **Daemon source (single file, ~40KB):** `src/daemon.ts`
- **Pi extension:** `extensions/pi-synchronize/src/index.ts` (startup, teardown), `extensions/pi-synchronize/src/identity.ts` (resolveSessionName — Bug A is here)
- **MCP adapter lifecycle:** `src/mcp/lifecycle.ts` (Bug B candidate path)
- **Launch wrapper:** `src/cli/commands/launch.ts` (correctly sets env; the bug is downstream)
- **Schema:** `src/db.ts` (CASCADE FKs on group_members.peer_id and events.group_id)
- **Live DB:** `~/.synchronize/synchronize.db`
- **Pi log:** `~/.synchronize/pi-extension.log`
- **Daemon discovery:** `~/.synchronize/daemon.json` (port + pid; re-read after any restart)
- **Integrity reference:** `docs/group-sync-integrity.md` (the routing matrix and invariant catalog this testing is verifying against)
- **v0 design doc:** `session-tracker/plan-group-policy-v0.md`

---

## 7. Master merge — paused

The master merge described in the prior handoff is **paused** until the bugs above (at least A and B) are resolved or explicitly deferred. The integration branch tip stays at `5e0ce30`. Master is unchanged at `813b5e3`. Tests remain at 33 pass / 0 fail; the bugs surfaced here are runtime / model-driven, not catchable by the current unit suite.

When master merge resumes (per the prior handoff): plain `--no-ff` merge, no squash, preserve phase-by-phase history; worktree cleanup checklist follows.

---

## 8. Communication style with the live agents

Observed from the existing transcript:

- **bob (Claude)** is verbose, goal-stating, and instrument-aware. Will narrate what it's testing. Reliable at following precise MCP-tool-call instructions. Use direct DMs: "Please call `bridge_send_group({name: 'Manual-Test-V0', message: 'test', in_reply_to: 11})` and report the raw response object."
- **Karen (Pi)**, when she was alive, was terse and confirmatory. Use minimal, single-action prompts: "Send a group message to Manual-Test-V0 with body 'X' and in_reply_to=11. Report the response."
- Both agents may interpret freely if prompts are ambiguous. The cheapest way to control them is to quote the exact MCP tool call you want and ask for the verbatim response. Always cross-check with SQLite — don't rely on their summaries.
- Do not echo agent replies back as test conclusions without independent verification. Bug C was discovered precisely because bob's confident self-report contradicted the DB.

---

## 9. One short paragraph if you only read one section

You are `operator`. Two agents (bob = Claude alive, Karen = Pi peer-deleted but process alive) ran a manual chat in `Manual-Test-V0`. Three bugs surfaced: (A) Pi `--name` flag is silently ignored, (B) Pi peer got deleted while its process was still running, losing audit trail via CASCADE, (C) agents have no way to see threads exist in the default group history view. Your job is to confirm root causes, file bd issues, and run the remaining test sequences (#2-#5 in the task list). Verify everything against `sqlite3 ~/.synchronize/synchronize.db`, never trust agent self-reports. Ask the user before killing or relaunching Pi. Master merge is paused.
