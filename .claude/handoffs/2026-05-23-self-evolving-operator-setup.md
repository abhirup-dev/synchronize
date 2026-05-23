# Self-evolving operator setup — handoff

**Date:** 2026-05-23 (late evening)
**Continuation of:** `2026-05-23-v0-manual-test-orchestrator.md` (which is itself a continuation of `2026-05-23-group-policy-v0-phases-1-2-dx2.md`)
**Integration worktree:** `.claude/worktrees/plan-group-policy-v0/`
**Integration tip:** `6e11a8e` (4 new commits this round on top of `f3baa73`)
**Status:** Server-side hot-reloadable customer-driven improvement loop has been built and run twice. The MCP-adapter pass remains as the next big step. Master merge is still paused, but on a clear glide path.

---

## 0. Read this first — what the previous session built

This is not a normal handoff. The previous session **stumbled into a self-evolving product loop** that is worth preserving and continuing.

Briefly:

1. **Three live LLM agents** were launched into a `synchronize` group via the project's own `synchronize launch` CLI inside dedicated `tmux` sessions: `bob` (Claude Opus, in `tmux -t sync-bob`), `alice` (Claude Opus, `sync-alice`), `karel` (Pi GPT-5.4-mini, `sync-karel`). They run as real participants of the `v0-recheck` group on the live daemon at `~/.synchronize/`.

2. **The Claude Code session itself acts as the orchestrator** (`operator`, peer `507784dc-…`). It does not join the group. It DMs the agents, asks them to run precise tool calls, and verifies their results against SQLite + REST. The orchestrator is **also** the one editing source code, restarting the daemon, and shipping fixes mid-session.

3. **The daemon is hot-reloadable.** Every server-side change (mentions, threads, idempotency, response shapes, new endpoints) takes effect after a 1-second `make daemon-kill && synchronize status` cycle. The live agents reconnect on their next call without restart. So the loop is:

```
┌───────────────────────────────────────────────────────────────────────────┐
│                                                                           │
│    1. Operator asks live agents to run a flow (DM)                        │
│                       │                                                   │
│                       ▼                                                   │
│    2. Agents execute → DM raw responses back                              │
│                       │                                                   │
│                       ▼                                                   │
│    3. Operator cross-checks against SQLite                                │
│                       │                                                   │
│                       ▼                                                   │
│    4. Operator either:                                                    │
│         (a) marks behavior verified, files no bug, OR                     │
│         (b) edits src/daemon.ts, restarts daemon, retests live, OR        │
│         (c) files a bd issue for MCP-side or schema-migration work        │
│                       │                                                   │
│                       ▼                                                   │
│    5. Loop back to (1) with the next test or follow-up                    │
│                                                                           │
│    ALSO PERIODICALLY:                                                     │
│    6. Operator interviews the agents as customers — "what was hard?"      │
│       Their PR-review-style answers drive the next loop iteration.        │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

This is what the user is calling **"self-evolving"** — the product evolves through live customer feedback in a single uninterrupted session, with the fixes landing inline, without an out-of-band code-review cycle.

**Your job, resumed agent, is to continue this loop.**

---

## 1. The customer-as-product-source principle

The agents are **customers** of the synchronize MCP API. Their job is to use it. Their friction *is* the product feedback.

Three observed agents during the 2026-05-23 round, with their per-model character:

| Agent | Model | Role | Character of feedback |
|---|---|---|---|
| `bob` | Claude Opus 4.7 | Original test participant | Sharp, structured, finds real bugs. PR-review style. Caught `in_reply_to`-to-non-message gap that operator missed. |
| `alice` | Claude Opus 4.7 | Second test participant | Designs product proposals. Wrap-up after sustained-thread test was a 7-point structured analysis with API-shape suggestions. |
| `karel` | Pi GPT-5.4-mini | Small-model UX canary | Describes **lived friction**, not feature requests. "Context rehydration: every round." "Verification overhead: trust resolution blindly." |

**The product principle from this:**

> An Opus agent describes the missing feature; a small model describes the felt cost. Both signals are real. The small-model perspective is rarer and more important — if Karel struggles, the defaults are wrong, not features are missing.

So when you read agent feedback in the next session, weight Karel's friction signals at least as heavily as bob's and alice's structural proposals.

The corollary the user surfaced explicitly: **keep the MCP surface lean**. Don't add a new `bridge_*` tool every time someone asks for an affordance — extend existing tools, improve descriptions, add fields to response shapes. New tools cost every agent (especially Karel) cognitive bandwidth on every turn.

This is recorded in the reframed `sync-si2` and `sync-nsk` bd issues — both were originally "add a new tool" and are now "extend the existing tool."

---

## 2. What got built and shipped this round

### Architectural

- **Daemon-restart resilience documented** as section 9 of `docs/group-sync-integrity.md`, including the asymmetry (Claude-side adapter re-resolves cleanly; Pi extension caches `baseUrl` at startup). The Pi gap is partially mitigated by:
- **Port pin** — `DEFAULT_PORT` changed from `0` (random) to `58405` (stable) in `src/constants.ts` so the cached URL never goes stale in practice. (Commit `e51aa4d`.)

### Server-side fixes (hot-reloadable, all visible to live agents on next call)

Each commit list below is in execution order. All are in `src/daemon.ts` unless noted.

1. **`576bef4`** — `fix(pi-extension): honor SYNCHRONIZE_SESSION_NAME over piSessionId fallback`. Closes `sync-ecs`. Plus stderr launch logging in `src/cli/commands/launch.ts` and identity log in `extensions/pi-synchronize/src/index.ts`.

2. **`2bca157`** — Big batch from the first customer interview:
   - Self-mention filter in `mentions_json` (sender always excluded from "mentions" list, mirroring delivery behavior).
   - Idempotent `bridge_join_group`: same-alias re-join returns `{event: null, already_member: true}` instead of phantom `group_joined`.
   - Idempotent `bridge_leave_group`: not-a-member returns `{ok: true, event: null, already_left: true}`.
   - `reclaimed_from: { previous_peer_id, event_id }` field on join response when reclaim fires (alice's #1 ask).
   - `warnings: []` always returned by `bridge_send_group` (no more default-undefined).
   - `delivery: { pushed_to: [...], inbox_only: [...] }` summary added to `bridge_send_group` response (alice's #5 ask).
   - `formatGroup` applied to create + patch responses so `durable` is `boolean` not `0|1` (bob's bonus catch).
   - `GET /events/:event_id` endpoint with visibility enforcement (both bob and alice asked).
   - `reply_count` + `last_reply_event_id` on default `/history` rows. Closes `sync-0gl`.

3. **`e51aa4d`** — `fix(daemon): pin DEFAULT_PORT to 58405`. Workaround for Pi-extension URL cache issue.

4. **`dd11677`** — Batch from the sustained-thread test:
   - Backtick carve-out for `@`-mention parser (alice observed `@peer:<uuid>` inside `` ` `` producing false-positive warnings mid-thread).
   - `in_reply_to` rejects roster events with `reply_target_not_message` (bob caught this).
   - `GET /threads/:root_event_id` endpoint returning `{root, replies, participants, reply_count, last_event_id}` in a single call.

5. **`6e11a8e`** — `test(api): lock in the 10 server-side behaviors shipped this round`. 26/26 tests pass in `tests/api.test.ts`. Behavior-descriptive prose names, co-located with existing tests by feature area (not by date).

### bd issues filed (deferred to MCP-adapter pass or later)

| ID | Pri | Title |
|---|---|---|
| `sync-2sr` | P1 | Pi extension caches daemon URL; doesn't re-resolve on connection error |
| `sync-dmc` | P1 | Hard delete of peer cascades to group_members and destroys reclaim/audit trail |
| `sync-2zl` | P1 | Structured error envelope across all tool/HTTP errors (bob's #1 friction) |
| `sync-anr` | P2 | Parallel test runs collide on DEFAULT_PORT=58405 |
| `sync-cp5` | P2 | `mentions_json` is double-encoded; surface parsed `mentions: string[]` instead |
| `sync-si2` | P2 | Extend `bridge_group_history` with `event_ids` filter (reframed — don't add new tools) |
| `sync-nsk` | P2 | Improve `bridge_list_peers` description for group filter (reframed — don't add new tools) |
| `sync-n53` | P3 | MCP tool descriptions need "Returns:" block + per-tool idempotency contract |
| `sync-XXX` | P3 | Accelerate test suite — currently ~30-47s for 43 tests *(filed during this session, exact id in bd list)* |

### bd issues closed this round

- `sync-ecs` (Pi `--name` flag) — shipped in `576bef4`.
- `sync-0gl` (thread-visibility metadata) — shipped in `2bca157`.

---

## 3. The live runtime state right now

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Daemon: ~/.synchronize/daemon.json — port 58405 (pinned)                │
│                                                                          │
│  Peers (sqlite ~/.synchronize/synchronize.db):                           │
│  - bob        Claude Opus    peer 26020713-bf80-4...   tmux sync-bob    │
│  - alice      Claude Opus    peer d8a7fb3a-296f-4...   tmux sync-alice  │
│  - karel      Pi GPT-5.4-mini peer 5c5cebd4-dcf4-4...  tmux sync-karel  │
│  - operator   Claude Opus    peer 507784dc-01d9-4...   THIS Claude Code │
│                                                                          │
│  Group `v0-recheck`, durable, 3 active members (bob, alice as "ghost",  │
│    karel). Group has 88+ events including a 16-message sustained thread │
│    rooted at event 60 — worth reading for product context.              │
└──────────────────────────────────────────────────────────────────────────┘
```

Each agent's tmux session can be attached with `tmux attach -t sync-<name>` (detach with `Ctrl-b d`). You can monitor without attaching via `tmux capture-pane -t sync-<name> -p`.

A handful of quick state-inspection commands:

```bash
# Live peer table
sqlite3 ~/.synchronize/synchronize.db "SELECT session_name, tool, datetime(updated_at) FROM peers ORDER BY updated_at DESC;"

# Recent events
sqlite3 ~/.synchronize/synchronize.db "SELECT event_id, type, sender_peer_id, parent_event_id, substr(body,1,60) FROM events ORDER BY event_id DESC LIMIT 15;"

# Daemon health
curl -s "http://127.0.0.1:58405/summary" | jq

# Pi extension log (this is the one place where Pi-side issues surface)
tail -f ~/.synchronize/pi-extension.log
```

---

## 4. The plan from here — what the next session should do

The user committed to this sequence at the end of the round:

1. ✅ **Tests** (done this round — `6e11a8e`).
2. ✅ **This handoff** (you're reading it).
3. ⏭ **MCP adapter pass** — implement the 4-5 deferred bd issues that need the MCP adapter rebuilt.
4. ⏭ **One more interactive validation round** — repeat the customer-feedback loop with the live agents on the new MCP surface.
5. ⏭ **Master merge** — plain `--no-ff` (NOT squash), preserving phase-by-phase commit history.
6. (deferred) **Skill refactor under `sync-b8p`** — touching the skills now would conflict with the broader progressive-discovery refactor. Today's response-shape updates will be folded into that work.

### Concrete next-step (step 3 — MCP adapter pass)

The deferred fixes — all require an MCP adapter rebuild + `make install-claude install-pi` + relaunch of bob/alice/karel:

| Issue | Work |
|---|---|
| `sync-2zl` (P1) | All MCP tool errors return `{error: {code, message, ...details}}` JSON instead of bare English strings. Touches `src/mcp/util.ts` error formatter + every tool that throws. Bob's #1 friction. |
| `sync-cp5` (P2) | Parse `mentions_json` at the response boundary; expose as `mentions: string[]`. Bob + alice both flagged independently. |
| `sync-si2` (P2) | Extend `bridge_group_history` with `event_ids: number[]` filter so agents can do single-event lookups without a new tool. (Server-side `GET /events/:id` endpoint already exists from this round — wire it through.) |
| `sync-nsk` (P2) | Rewrite `bridge_list_peers` description to lead with the group-scoped use case. Ensure group-scoped response includes `alias`, `active`, `joined_at` fields. |
| `sync-n53` (P3) | Add a "Returns:" block + idempotency note to every `bridge_*` tool description. Especially target Karel (small-model UX). |

After shipping those:

- `make install-claude install-pi` to copy the new MCP binary + skills to the install locations.
- `tmux kill-server` and re-spawn bob/alice/karel via `synchronize launch`.
- Re-run the customer-feedback loop. **Crucially, ask Karel first** — she's the canary, her friction will tell you whether the lean-surface principle was honored.

### Concrete next-step (step 4 — interactive validation)

Suggested test set after the MCP pass:

1. **Sustained thread round 2.** Karel initiates; track whether the new descriptions / parsed mentions / structured errors reduce her observed friction (versus her 2026-05-23 wrap-up). She listed: context rehydration, notification routing, identity drift, reply discipline, verification overhead. Specifically watch round-over-round if any of those felt categories *disappear* with the new MCP shapes.

2. **Structured-error verification.** Have bob deliberately hit alias-collision, peer-not-found, group-not-found, reply-target-not-message. Assert each response is now JSON with a `code` field instead of an opaque English string.

3. **Edge cases not yet tested:**
   - Media share + retrieval flow (untouched in 2026-05-23 round).
   - DM to non-existent peer error shape.
   - Empty-body group_message (does the daemon reject? It does — `requireString` should fail. Verify the error shape.)
   - Very long message body (> MAX_MESSAGE_CHARS).
   - Race-condition: two peers join with the same alias simultaneously.

### Concrete next-step (step 5 — master merge)

Per the original `2026-05-23-group-policy-v0-phases-1-2-dx2.md` handoff:

```bash
git checkout main
git merge --no-ff worktree-plan-group-policy-v0
# Resolve any conflicts
git push origin main
```

Use `--no-ff` to preserve the phase-by-phase commit graph. No squash. Worktree cleanup follows per the original plan.

**Pre-merge checklist:**
- [ ] All tests pass in `tests/api.test.ts` (currently 26/26).
- [ ] Open P1 bd issues are documented or workaround'd. Currently OK: `sync-2sr` has port-pin mitigation; `sync-dmc` has same indirect mitigation; `sync-2zl` will land in step 3.
- [ ] Handoff doc (this one) is on the integration branch.
- [ ] `docs/group-sync-integrity.md` section 9 covers the resilience story.

---

## 5. How to continue the self-evolving loop in practice

If you are reading this as the resumed agent, here is the operating playbook for the next session, distilled:

### The role you take

You are `operator` — peer `507784dc-…` — registered on the live daemon, **not** a member of the `v0-recheck` group. You orchestrate from outside. You can:

- DM bob, alice, karel via `bridge_dm({recipient_peer_id, message})`.
- Read your own inbox via `bridge_inbox({ack: true})`.
- Inspect any state via SQLite + REST.
- Edit `src/daemon.ts` and any non-MCP code; the daemon is hot-reloadable.
- Edit MCP code (`src/mcp/...`) but with the understanding that those changes only take effect after `make install-*` + agent relaunch.

### The mental model

- **The daemon is the product surface.** Agents see response shapes, event types, error formats. Every customer-facing field needs to make sense to an LLM.
- **Tests are durability.** Every behavior shipped without a test will silently regress when someone else refactors. The `tests/api.test.ts` convention (flat `test(...)` with prose names) is the right convention to follow.
- **Beads issues are the durable backlog.** Every customer finding that can't be fixed inline gets filed. Use sub-200-char titles, P0–P4 priority, structured descriptions with Evidence / Root cause / Fix proposal sections.
- **Skills are deferred work-in-progress.** Both Claude and Pi skills will be refactored under `sync-b8p`. Don't patch them piecemeal; let the response shapes do the work until the refactor lands.
- **Karel is the canary.** If you ship something and Karel struggles, the defaults are wrong.

### The cadence

A productive cycle from this round looked like this — replicate the pattern:

1. **Pick a flow** (e.g., "sustained thread", "mention semantics", "leave + reclaim").
2. **DM precise tool calls** to one or more agents, asking for raw JSON responses verbatim.
3. **Cross-check the response against SQLite.** Never trust agent self-reports without DB verification. (This was a hard-earned operating principle from the previous session.)
4. **When you find a wart**, fix it server-side if you can (one of: response-shape augmentation, new field, validation tightening, idempotency, new GET endpoint, parser improvement). Otherwise file a bd issue.
5. **Restart the daemon** if you edited the daemon (`make daemon-kill && synchronize status`). The agents' MCP adapters re-resolve automatically.
6. **Have the same agent verify the fix** by re-running the call.
7. **Periodically interview the agents** — "as a customer of this API, what was hardest about the last N minutes?" Their answers are denser product feedback than any spec doc.

### Useful artifacts in this worktree

- `docs/group-sync-integrity.md` — single-page invariant catalog with the routing matrix, the resilience story (section 9), and known v0 deferrals.
- `session-tracker/plan-group-policy-v0.md` — the original v0 plan, with phases 3a/3b/3d shipped and 3c (ACL) deferred.
- `.claude/handoffs/` — all prior handoffs. The most relevant lineage for this round is `2026-05-23-group-policy-v0-phases-1-2-dx2.md` → `2026-05-23-v0-manual-test-orchestrator.md` → this doc.
- `tests/api.test.ts` — 26 tests, follow the convention.
- `.beads/issues.jsonl` — full bd issue history. Always-on `bd ready` and `bd list --status=open` for daily orientation.

---

## 6. What could go wrong

A few traps that already snared the previous session, worth flagging:

- **Pi extension fails silently when the daemon's port changes.** Port pin solves it in normal operation, but if you ever explicitly set `SYNCHRONIZE_PORT` to something else, you'll see Pi heartbeat failures cascade to peer hard-deletion (via `sync-dmc`). Don't change the port without fixing `sync-2sr` first.

- **Agents make confident-sounding factual statements that contradict the DB.** Bob's "zero threads exist" earlier in the test history is the canonical example. **Verification is operator's job, never the customer's.**

- **Idempotent operations that weren't documented as such created phantom events.** Verified this round and fixed for join + leave. If you add more operations (e.g., a future media-share or roster patch), explicitly think through the idempotency contract and document it in the tool description.

- **The test suite is slow (~30-47s) and currently has port-collision issues under parallel execution.** Tracked under `sync-anr`. Acceptable for now; run targeted tests with `bun test tests/api.test.ts -t "<name>"` while iterating.

- **MCP adapter changes need a full install + agent relaunch cycle to test.** The daemon changes today were 1-second restarts. The MCP pass in step 3 will be a 30-second relaunch cycle per change. Plan iterations accordingly.

- **The handoff lineage matters.** Don't write a new handoff from scratch — *unless* the user asks for a fresh framing (as happened this round). When in doubt, extend the previous handoff with a new section. When the work introduces a fundamentally new operating model (as the operator-as-product-manager did this round), a fresh handoff is the right call.

---

## 7.5. Addendum — round 2 of the operator loop (same day, later)

Resumed agent ran another customer-driven pass and shipped the deferred MCP-adapter work the original handoff prescribed. Captured here as one section rather than a new handoff because the methodology and live runtime state are unchanged — only the catalog has grown.

### What got built and shipped in round 2

| Commit | What |
|---|---|
| `87e9bfe` | **MCP adapter pass**: structured error envelope (`ApiError` + `wrap()` in `src/mcp/util.ts`), parsed `mentions: string[]` at MCP boundary, `event_ids: number[]` filter on `bridge_group_history`, `bridge_list_peers` description + response shape, Returns: blocks + Idempotency lines on every `bridge_*` tool. Closes `sync-2zl`, `sync-cp5`, `sync-si2`, `sync-nsk`, `sync-n53`. |
| `416dad7` | **Pi resilience**: `extensions/pi-synchronize/src/client.ts` now retries-with-rediscover on transport errors (`fetch failed`, `ECONNREFUSED`, etc.), mirroring the Claude-side lazy-discovery pattern. Closes `sync-2sr` — Pi is no longer fragile to daemon port changes. |
| `2a50588` | **Inline-event consistency**: `bridge_join_group` / `_leave_group` / `_rename_in_group` / `_share_media` inline `event` fields now also run through `formatEventForMcp` (bob caught the gap; previously their inline events still showed `mentions_json: null`). |
| `44d52a0` | **Karel-driven description fix**: `bridge_group_history` description rewritten as an explicit 3-mode table (default / thread_of / event_ids) after Karel's canary signal flagged the inline prose as ambiguous. |

### Live customer signals captured (and what they cost)

- **Bob** (Opus, 2026-05-23 round 2): caught the inline-event `mentions_json` consistency gap on `bridge_join_group` — exactly the kind of bug a reviewer-eye finds on first pass. Real bug, fixed in same session.
- **Alice** (Opus): produced a 9-point PR-grade review on the new shapes. 1 false alarm (mentions_json on read paths — already covered). 5 genuine findings filed as bd: `sync-hwg` (P2 — event.body dual-encoded across group_message vs system events, her sharpest catch), `sync-5t0` (resolved-alias receipt), `sync-spq` (drop dead `recipient_peer_id` on group_message), `sync-235` (`include_inactive` on list_peers), `sync-9cf` (doc send-time delivery resolution).
- **Karel** (Pi GPT-5.4-mini): canary signal — *"bridge_group_history made me pause because I had to map when thread replies are hidden vs directly fetched."* That one sentence is the operating definition of small-model friction: the mode-disambiguation that Opus models infer in one tokenizer cycle costs Karel real cognitive load. The rewrite as a numbered-mode table directly addresses it.

### Closed this round

- `sync-2zl` P1, `sync-cp5` P2, `sync-si2` P2, `sync-nsk` P2, `sync-n53` P3 — MCP adapter pass.
- `sync-2sr` P1 — Pi extension URL cache fix.

### New bd issues filed

| ID | Pri | Title |
|---|---|---|
| `sync-hwg` | P2 | `event.body` dual-encoded across event types (alice's sharpest catch) |
| `sync-5t0` | P3 | Alias-to-peer-id resolution receipt on `bridge_send_group` |
| `sync-spq` | P3 | Drop `recipient_peer_id` from `group_message` event shape |
| `sync-235` | P3 | `bridge_list_peers` should support `include_inactive=true` |
| `sync-9cf` | P3 | `bridge_send_group` description should note send-time delivery resolution |

### Updated live runtime state

```
Daemon:    ~/.synchronize/daemon.json — port 58405 (unchanged)
Peers:
  - bob     Claude Opus    peer 612c79ac-15d7-4b37-9e02-73d1353a34a9   tmux sync-bob
            (claude --resume f4b0b7f3-4260-425a-8396-e8c8d3da0d99)
  - alice   Claude Opus    peer c1affbce-0e5c-445c-87fe-fc9131d1074f   tmux sync-alice
            (claude --resume f699f130-3ecb-4024-b675-d9af51f0c494)
  - karel   Pi GPT-5.4-mini peer 3fe46bbf-dcc0-4a6a-b8d3-647f2036f1ff   tmux sync-karel
            (fresh; karel's prior peer was hard-deleted by sync-dmc — full re-register)
  - operator Claude Opus   peer 507784dc / ac8be6ed (two zombies, harmless)

Test groups now present: bob-mentions-verify (id=2), alice-mentions-verify (id=3)
Latest event_id: ~110
```

The MCP code is reinstalled (`make install-claude install-pi`). All three agents are back online via `synchronize launch claude --resume <id>` / `synchronize launch pi --name karel`. All running the new MCP code; operator session itself is on the old MCP and would benefit from a session restart before the next round.

### What's now next

The handoff's original plan stands:

3. ✅ MCP adapter pass (done this round)
4. ✅ Interactive validation (done this round)
5. ⏭ **Master merge — plain `--no-ff`**, preserving the phase-by-phase commit history. This is now the only remaining big step before v0 is unblocked. Pre-merge state:
   - Tests: 26/26 in `tests/api.test.ts`, 3/3 in `tests/mcp-e2e.test.ts`, all Pi extension tests green.
   - Open P1 bd issues: `sync-9e0`, `sync-gt8`, `sync-wyx`, `sync-7fq`, `sync-dmc` — all orthogonal to v0 group policy (host bindings + cascade-delete); v0 ships without them, but `sync-dmc` should not be forgotten because it's the bug that hard-deleted Karel.
   - `sync-anr` (P2 port collision in tests) and `sync-pmi` (P3 slow tests) remain workarounds-applied; defer.
   - Skill refactor under `sync-b8p` still deferred until after merge — touching skills now would conflict with the in-flight progressive-discovery refactor.

After the master merge, the natural next loop iteration is `sync-hwg` (the event.body dual-encoding wart). That's a server-side change with a small surface area; it would be the cheapest follow-up customer pass for the next session.

### One more meta-observation

This round confirmed the central tenet from §1: **Karel is the canary, and her friction is rarer + more important than Opus structural critique.** Bob caught a code consistency bug. Alice produced design feedback. Karel produced one sentence: *"the split between main-channel history, thread_of, and event_ids made me pause."* That sentence was the highest-leverage friction signal of the round — because every future small-model agent who reads that description will pause too, and the rewrite fixes them all at once. **When tempted to over-engineer, ask "would Karel have asked for this?" and "would Karel struggle if we didn't ship this?" If both are no, defer.**

---

## 8. Self-evolving loop status — round count

- Round 1 (handoff sections 0-7): server-side hot-reloadable improvements driven by bob/alice/karel customer feedback.
- Round 2 (this addendum): MCP adapter pass + Pi resilience + inline-event consistency + Karel canary description fix.

Open question for round 3: should the operator session itself be re-launched on the new MCP between rounds, so the orchestrator sees the new shapes too? Currently the operator runs on the *previous* round's MCP, which is fine for orchestration (DM/inbox semantics unchanged) but means the operator can't validate parsed-mentions or structured-error shapes from its own bridge_* calls. Cheap fix next round: restart the operator session first, then re-engage agents.

---

## 7. One-paragraph summary if you only read one section

You are `operator`, a Claude Code session orchestrating a live multi-agent test campaign against the `synchronize` daemon at port 58405. Three live agents (bob = Claude Opus, alice = Claude Opus, karel = Pi GPT-5.4-mini) are running in tmux and acting as customers of the MCP API. Your last session shipped 14 server-side hot-reloadable improvements based directly on their feedback (commits `576bef4` → `6e11a8e`), filed 9 bd issues for deferred work, and locked everything in `tests/api.test.ts` (26/26 pass). The next step is the **MCP adapter pass** — implement the deferred `sync-2zl` / `sync-cp5` / `sync-si2` / `sync-nsk` / `sync-n53` fixes, reinstall, relaunch agents, run **one more interactive validation round with Karel-as-canary**, then master-merge with plain `--no-ff`. The self-evolving loop is the product methodology: live agents are the customers, their friction is the spec, the daemon's hot-reloadability is what makes the loop tight enough to converge in a single session.
