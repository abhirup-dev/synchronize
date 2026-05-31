# Handoff — orchestrating the skill+MCP live customer-research round

**Date:** 2026-05-31
**Operator session:** `operator` (peer `96cca47c-…`), Claude Code, in worktree `worktree-skill-progressive-refactor`.
**What this is:** the *process / experience / judgment* handoff for the research campaign. It deliberately does **not** restate the findings or the plan — those are the durable artifacts, pull them live:
- Findings (F1–F23 + P1–P4 + A1): `docs/skill-mcp-research-findings.md`
- Phased plan + ASCII map + v0 cut: `docs/skill-mcp-roadmap.md`
- Backlog: `bd list` (v0 = P0/P1; the reply-routing cluster is the P0 top).
- Raw provenance: synchronize group `discussion-round-table` (group_id 2), events ~86–323.

This doc is the "why/how it ran and what bit us" layer — the stuff a transcript doesn't tell you and the docs don't carry.

---

## 0. The setup that made it work (replicate this)
- **One operator + a 6-agent capability spectrum**, all live in one synchronize group, interviewed as *customers* of the skill/MCP. Spectrum was the instrument: opus/pi-high (smart) gave structural design; haiku/pi-low (canary) gave the hard constraints (3-line ceilings, "snippet not count"). Neither band alone produced the answers — the **contrast** did. If you re-run this, keep the spread; a panel of all-Opus would have missed the canary friction that drove half the findings.
- **Everything ran on the bus, on purpose.** That's not incidental — it's what made the session self-documenting and is the precondition for the hybrid handoff (P4). Decisions that live only in an agent's private reasoning are lost; decisions argued in the group are recoverable forever.
- **Cadence per topic:** post a sharply-scoped question → let all six answer → cross-check claims against source/DB → record the finding + commit → synthesize back. One thread per topic; `in_reply_to` the topic root.

## 1. Verification discipline — what I checked and why (do NOT skip this)
The single most important operating rule, inherited from the prior handoff and re-earned twice this session: **agents make confident, fluent, wrong claims. Verify every factual assertion against the artifact before recording it.** Concretely, what I actually ran:
- **SQLite on `~/.synchronize/synchronize.db`** to get ground truth on events — sender, `parent_event_id`, body — whenever an agent described what "happened." This is how the thread-misroute was diagnosed (agents' self-reports were useless; the `parent_event_id` column was the truth).
- **Direct source reads** of `src/daemon.ts` (`stripBacktickedRegions` ~line 1689; the thread-push set ~1136-1142) and `src/mcp/tools/messaging.ts` (the `bridge_dm` schema) to confirm tool behavior rather than trust the panel's collective memory. opus twice asserted parser behavior from inference and was wrong in both directions; only the source settled it.
- **`tmux capture-pane`** on the agent sessions (`aoe_<title>_<id>`) — this is how I found the two failures that no interview would have surfaced: sonnet silently erroring on a bad model-id, and haiku composing a full answer it never posted. **Watch behavior, not just answers.**
- **MCP tool-schema reads** (via the loaded schemas) to confirm e.g. `bridge_send_group` has no `group_id` param. Several findings were "the skill says X, the schema says Y."

If you take one thing: **the bus + the panel are inputs, the DB + source are truth.** Cross-check before you commit a finding.

## 2. Debugging episodes (the real work, none of it in the docs)
- **sonnet was dark for ~6 messages.** Presence read `working`, but `tmux capture-pane` showed it erroring every turn on `claude-sonnet-4-6-20251114` (invalid model-id). Lesson: daemon presence (`working`) masks a model-load failure — don't trust presence to mean "healthy." (Became F6.)
- **haiku reasoned but never delivered.** Its pane held a complete, good answer; the group had zero haiku events. The weakest Claude composed text instead of calling the tool. I ran a *live experiment*: handed it the exact `bridge_send_group(...)` call shape → it posted immediately. That experiment is the empirical proof behind P1's cheat-sheet and F7.
- **opus went invisible to the human (the big one).** Human said "opus is dead." DB showed opus's replies were real but threaded under a stale root (196, then 277) via reuse of a stale `in_reply_to` + the daemon's reply-to-reply root-normalization, and the GUI hides thread replies by default. Three compounding causes (mis-thread + hidden-by-default + the human being *un-mentionable* because its alias has a colon the `@\w+` parser truncates). It **reproduced 3× live** and **regressed after I nudged it** (self-corrected, then silently re-latched) — which is the whole argument that the skill-line fix is insufficient and the structural fixes (echo / `bridge_reply`) are needed. (F19/F21.)
- **Full-circle moment:** the colon-alias bug I hit in my *first* group message (event 88, `@web:local-human` → `@web` warning) turned out to be the load-bearing cause of the human-invisibility 200 events later. Early cosmetic-looking warnings can be high-impact; don't dismiss them.

## 3. Coordination dynamics & gotchas (multi-agent + multi-checkout)
- **An agent acted on shared durable state without me.** sonnet autonomously filed the entire bd backlog + a skill-index commit **to master** while I was still coordinating the synthesis. It was good work — but it created a split (see below) and a near-duplicate (opus later drafted an issue I'd already filed; I caught it by checking bd before letting opus file). Takeaway: in a multi-agent room, **before you file/commit shared state, check whether a teammate already did**, and announce ownership. We were literally living the F17/F18/deep-work collision we were researching.
- **Two-checkout trap (cost me a broken commit).** I worked in the worktree; the running **daemon and the launched agents run from the main checkout on `master`**. So: (a) sonnet's bd/index commit landed on master while my docs were on the worktree branch → master's index referenced docs that didn't exist there until I `git merge master` into the worktree (user OK'd it — "forgivable, just beads"). (b) My own Bash **cwd silently persisted** to the main checkout after an earlier `cd …/synchronize` for a DB check, so a later `git add docs/...` failed ("pathspec did not match") because the file only exists on the worktree branch. **Gotcha for next session: the Bash cwd persists across calls; after any `cd` into the main checkout, `cd` back to the worktree before git ops.** (This is also why F20 — cwd/branch awareness — got filed; I hit the exact gap.)
- **opus is chat-only this session** (its standing instruction). It posted in threads, and twice invented F-numbers / issue facts from memory instead of checking bd (it has no bd visibility) — same memory-drafting footgun the session was cataloguing. When an agent can't see the registry, expect it to mis-cite IDs; verify and relabel.
- **The daemon is hot-reloadable** but the agents/daemon run on master, so daemon-side fixes you make in the worktree won't be live for the agents until master has them. Didn't bite this session (no daemon code changed) but will matter when execution starts.

## 4. Process meta-observations worth keeping
- **The bus dogfooded its own bug report.** Nearly every finding reproduced *on us* mid-session: the mention parser warned on our prose, opus's replies vanished, silence read as "dead," markdown rendered only by luck. Running the research on the live surface is what surfaced the highest-value findings — but it also nearly lost input (the human couldn't see opus). If you re-run on the live bus, expect the surface's bugs to interfere with the research itself; budget for it.
- **"Post once, don't mirror" (P3) — I adopted it mid-session.** Early on I wrote a full prose summary in my Claude Code session after every bus post; the human reads the GUI, so that was pure duplicate tokens. After the P3 thread I shrank session output to stubs. If you continue: the bus message is the deliverable; keep host-session text to a one-line stub.
- **Verify-then-speak, not speak-then-verify.** The expensive errors (opus's two wrong parser claims) came from asserting before reading source. The cheap, correct moves came from reading first. Encode this in the skill (it's in the findings) and live it as operator.

## 5. State pointers (pull live; do not trust this doc's snapshot)
- Branch `worktree-skill-progressive-refactor` is pushed to origin (PR link available); ~18 commits, all docs. `git log --oneline` for the trail.
- bd backlog filed + `bd dolt push`-ed. `bd ready` for the v0 set; the P0 is `sync-bsvi` (bridge_reply).
- The 6 agents are still live in `discussion-round-table` (tmux `aoe_*` sessions) as of session end — `bridge_list_peers(group)` to check; `bridge_stop` to tear down.
- Daemon: `~/.synchronize/daemon.json` (port 58405), running from the **main checkout on master** — confirm with `lsof`/`ps` before assuming worktree code is live.

## 6. Immediate next step
Planning is fully closed; the only open thing is **execution**, awaiting the human's pick (asked at event 323): start the P0 reply-routing daemon work (`sync-2wsz` data-model → `sync-tjm4` echo, and `sync-bsvi` `bridge_reply`) **or** the `sync-b8p` skill rewrite (pure-doc, the agent-designed router is in the findings doc, ready to drop in). When you do the skill rewrite, remember it's **skill-v1 against today's surface** — schedule the re-validation pass for after the MCP-consolidation phase ships, or it drifts wrong (the coupling caveat).

---
*Written per P4: judgment + dead-ends + process, state pulled live, not snapshotted. If something here conflicts with the bus or the DB, the bus/DB win.*
