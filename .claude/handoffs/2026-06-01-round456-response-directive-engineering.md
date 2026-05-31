# Handoff — rounds 4→6: response-directive engineering + live validation

**Date:** 2026-06-01 (work spanned 2026-05-31 evening → 06-01)
**Operator session:** `operator` (peer `96cca47c-…`), Claude Code, on **`master`** in the main checkout (`/Users/abhirupdas/Codes/Personal/synchronize`).
**What this is:** the process / judgment / dead-ends layer (P4). It does **not** restate bug bodies or the directive text — those are durable in `bd`, in the commit messages, and in `src/mcp/lifecycle.ts` + the two `SKILL.md` files. Pull them live.

Predecessor: `.claude/handoffs/2026-06-01-round2-redux-reliability-debugging.md` (the "round-2 redux" reliability session). This one picks up at **round 3** and runs **rounds 4, 5, 6** — but it stopped being "research rounds" almost immediately and became a **prompt-engineering + empirical-validation loop**: change an agent-facing directive on master → reinstall → launch a fresh panel → measure the behavior delta → repeat.

---

## 0. Shape of the session (read first)
The user asked to "run round 3 of the round table." It immediately became iterative **directive engineering**. The loop, three times:
1. **Round 4** (group `round-four`): re-ran the round-2 probes on a healthy panel → reproduced the findings cleanly + found a **P0 launch bug** (sonnet model id) and a new one (presence shows a crashed agent as `working`). Recorded `sync-koh1` (response-instinct), `sync-eix6` (host-mirroring), `sync-jf75` (presence honesty), fixed `sync-2zkb`.
2. **Round 5** (`round-five`): shipped the first directive reword ("respond by the **lightest sufficient means**" + DM-priority + skill pointer), reinstalled, validated cold-start (5/6 react unprimed vs round-4 needing operator priming). Surfaced the session's sharpest bug live: **`sync-ajkz` silent reply loss** — opus *composed* answers but never called `bridge_reply`, so they only existed in its host transcript.
3. **Round 6** (`round-six`): shipped the **top-level directive** (you-are-live-on-synchronize, **respond exclusively via `bridge_*`**, the human user **is a peer on the bus**, **GUI-mode** in-session override) across all three agent-facing layers, reinstalled, and **re-ran the entire round-4/5 battery** to measure before/after.

If you take one thing: **the live bus is both the lab and the subject.** Every directive change was validated by launching real agents and watching what they actually did — not by reasoning about the prompt. That caught the gap between *stated* and *revealed* behavior every single round (agents articulate a rule perfectly, then violate it reflexively).

## 1. The directive — what shipped and where it lives
One coherent response directive now lives on **three** agent-facing surfaces (the only three synchronize owns — see §5):
- **MCP instruction block** — `src/mcp/lifecycle.ts` `MCP_INSTRUCTIONS` (served to **both** Claude and Pi adapters at adapter start; **not** the daemon — so newly-launched agents pick up edits without a daemon restart).
- **Tool descriptions** — `bridge_reply` / `bridge_dm` (`src/mcp/tools/messaging.ts`) + `bridge_send_group` (`src/mcp/tools/groups.ts`): terse "delivery is via this tool only" lead lines.
- **Skills** — `skills/synchronize-claude/SKILL.md` + `skills/synchronize-pi/SKILL.md`, top-level paragraph.

Precedence the directive encodes: **GUI mode (if the user declares it) → reply in host session; otherwise → everything, including talking to the human, goes through `bridge_*`.** Commits: `62413d9` (lightest-means + DM-priority + skill pointer), `8f0cf73` (DM priority), `38fdd3a` (top-level + exclusively-`bridge_*`), `b93f000` (user-is-a-peer + GUI-mode).

## 2. Validated results (the before/after — this is the payload)
- **Response instinct** (contextless tag, no ask): round-4 primed = 5/5 react; round-5 unprimed (lightest-means) = 5/6 react + 1 reply; **round-6 = 4 react / 2 silent / 0 reply** — least noise yet, silence became a confident choice.
- **Delivery + framing**: round-6 **6/6 posted via `bridge_*`** (incl. opus, last round's silent-reply failure), **6/6** described the human as a peer *on the bus* (the "NOT from your user" → foreign-entity misread is gone), exclusively-`bridge_*` unanimous. All quoted the new text verbatim; **haiku read it from the MCP instructions** (it never opens the skill) — that's why the always-loaded MCP surface, not just the skill, was the right home.
- **GUI mode**: bidirectional toggle proven — ON → host-only reply, OFF → bus reply, inferred purely from the flag with zero extra steering.
- **No over-correction**: a real direct question still drew 6/6 substantive bus replies. Direct ask → reply; no ask → react/silence. Clean separation.
- **What the directive did NOT fix**: host **presence-narration** (`sync-eix6`). Agents still reflexively narrate "standing by" to their host session. Their own diagnosis: the delivery rule governs where a *response* goes, but "standing by" isn't a response — it's narrating one's own *non-action*, and the rule "doesn't reach it" (opus). sonnet's sharpening: since the human is an on-bus peer, host narration is a *side channel* that bypasses the bus. → needs a structural nudge, not just wording.

## 3. Bugs & findings (pull live from bd)
- **`sync-2zkb` (P0, CLOSED):** launch hardcoded the dated model snapshot `claude-sonnet-4-6-20251114`, which Claude Code rejects; sonnet booted then errored every turn. Fix = undated `claude-sonnet-4-6` (match opus's resilient pattern). Lesson: **pin model aliases, not dated snapshots, in launch configs.** Verified live in round-6.
- **`sync-koh1` (CLOSED):** the "respond immediately" reword. Validated round-6.
- **`sync-ajkz` (OPEN, P1):** silent reply loss — text answers fall back to host output; reactions don't, because a reaction is **tool-or-nothing** while a sentence has a **free host sink**. The round-6 directive *mitigates* it (opus now posts) but keep open for the **structural backstop**: a post-turn check that warns when a channel event was handled with no outbound `bridge_*` call.
- **`sync-eix6` (OPEN, P2):** host presence-mirroring. Root cause verified: `SKILL.md:18` literally institutionalized it ("return only a short host-session status"). Fix direction recorded: terminal+silent by default; gate any host status on a daemon-provided `host_observed` flag (distinct from `human_attached`). Round-6 proved instruction alone is insufficient.
- **`sync-jf75` (OPEN, P2):** presence reports adapter heartbeat, not agent health — a crashed agent shows `working`. opus's layered fix: liveness-by-decay (floor) + connected/active split (presentation).
- **`sync-9fzx` (OPEN, P2):** orphaned `synchronize-mcp` adapters linger when tmux is killed outside `bridge_stop`; want a reaper / adapter self-exit on host death (without deleting the durable peer).
- **`sync-bridge_stop-claude-code`** (filed; grab id via `bd list`): `bridge_stop` fails for peers whose `tool` field is `claude-code` (vs `claude`) — "cannot derive backend title." Resolve by launch_id/title, not the mutable tool string.
- **Group deletion gap (filed P2):** durable groups can only be created and *left* — no delete/archive endpoint, so stale test groups accumulate permanently.
- Carried from round 2 (still open): `sync-6ipk` (MCP instruction-block tool-list drift — partly addressed when I refreshed the tool list), `sync-nf8m` (first-contact primer).

## 4. Operational gotchas (these wasted time / will bite again)
- **Daemon restart race:** killing the daemon and starting your own with `nohup` loses the race — the operator's *own* MCP adapter heartbeat fires `ensureDaemon` and spawns the replacement first (parented to the adapter). Net result is fine (one daemon on the pinned port, current source), but `daemon.json` may show a stale pid for a beat. Always **pin `SYNCHRONIZE_PORT=58405`** so the adapter reconnects seamlessly; verify by reading `daemon.json` + `lsof :58405` after, not by assuming your `nohup` won.
- **`git_sha` in `daemon.json` ≠ HEAD is normal:** the user runs **parallel sessions committing to `master`** (thread-summary work landed interleaved with mine). Confirm your commits are ancestors of HEAD (`git merge-base --is-ancestor`) rather than panicking; the daemon reads files at import so it has working-tree state regardless of the recorded sha.
- **GUI-mode confounds mirroring data:** if you've put an agent in GUI mode, its host-session narration is *compliance*, not a mirroring bug. The user caught this for sonnet — exclude GUI-mode agents from mirroring measurements.
- **`claude-code` tool tag breaks `bridge_stop`** (round-four opus): kill its tmux directly. Round-five/six opus carried `tool: claude` and stopped fine — non-deterministic.
- **AOE HUD retains dead sessions.** Profile name is `synchronize-<djb2hash(home)>` = `synchronize-82cf6c71` for `~/.synchronize` (compute via `aoeProfileName` in `src/launch/service.ts:119`). `aoe -p <profile> list` shows ghosts; `aoe -p <profile> remove <id>` prunes each (its stdout "Removed session…" gets eaten if you `>/dev/null`, making a loop look like it failed — it didn't). `bridge_stop` *does* reap the session+adapter when it works; ghosts come from tmux killed directly or `claude-code`-tag failures.
- **Not every `synchronize-mcp` process is yours:** the user's **Codex.app** spawns adapters (PPID = Codex app-server) and Claude Code keeps a **`--bg-spare`** adapter. Identify by PPID before killing. Only kill adapters parented to the panel tmux/AOE you launched.
- **Groups can't be deleted in v0** (only `leave`). Don't hard-delete group rows from SQLite at closeout — events reference `group_id` and orphaning rows can blank web state (cf. the round-2 evict bug `sync-b41h`).

## 5. The "only three layers" fact (the user asked; verify if it changes)
The agent-facing surfaces synchronize **owns**: the MCP instruction block, the `bridge_*` tool descriptions, and the two `SKILL.md` files. The Claude `<channel source="synchronize" …>` wrapper ("This is NOT from your user…") is generated by the **Claude Code harness**, not us — we can't edit it (and it's the thing that triggers the foreign-entity misread the directive now counteracts). The Pi `<synchronize_event …>` envelope (`extensions/pi-synchronize/src/delivery.ts`) is **pure metadata** — no prose — so it needs nothing.

## 6. Live state at handoff (pull fresh; don't trust this snapshot)
- **`master` HEAD** after the handoff commit; directive commits `62413d9`, `8f0cf73`, `38fdd3a`, `b93f000` all pushed; bd findings committed + `bd dolt push`ed.
- **Daemon:** one process on `127.0.0.1:58405`, `SYNCHRONIZE_HOME=~/.synchronize`, running current source. Spawned via the operator-adapter auto-start path (see §4).
- **Panels:** all torn down. **AOE profile `synchronize-82cf6c71` is empty** (13 ghosts pruned). No agent tmux sessions.
- **Groups:** operator has **left** all 6 test groups (discussion-round-table, round-table-v2, round-two-demo, round-four, round-five, round-six). The group rows persist (durable, no delete API) but are operator-less; stale peer rows go offline as their leases lapse (adapters dead).
- **`claude-peers` MCP fully uninstalled** from Claude user config + all 6 of its processes killed (per user). Source dir `~/claude-peers-mcp/` left on disk.
- Remaining `synchronize-mcp` adapters are legitimate: operator's own + 2 Codex.app + 1 Claude bg-spare.

## 7. Immediate next step
The prompt layer is in a good state and validated. The remaining work is **structural**, because round-6 proved instruction-alone can't close the last gaps:
1. **`sync-ajkz`** — post-turn guard: warn/raise when a channel event was handled with no outbound `bridge_*` call (the tool-or-nothing backstop for text).
2. **`sync-eix6`** — add the explicit "don't narrate non-action to host; liveness lives on the bus" rule **and** the daemon `host_observed` flag (gate host status on it; default silent/terminal).
3. **`sync-9fzx`** — adapter reaper / self-exit on host death.
4. Group archival/deletion (the filed gap) + `sync-jf75` presence-by-decay + the `claude-code` `bridge_stop` resolution.

---
*Written per P4: judgment + dead-ends + process, state pulled live. If this doc conflicts with bd / the DB / the bus, those win.*
