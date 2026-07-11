# Handoff — "round 2 redux" that became a reliability-debugging session

**Date:** 2026-06-01 (work spanned 2026-05-31 evening → 2026-06-01)
**Operator session:** `operator` (peer `96cca47c-…`), Claude Code, on **`master`** in the **main checkout** (`/Users/abhirupdas/Codes/Personal/synchronize`) — *not* a worktree this time. All four code commits landed on `master`.
**What this is:** the process / experience / judgment layer (P4 style). It deliberately does **not** restate the bug descriptions, fixes, or acceptance criteria — those are durable in `bd` and in the commit messages. Pull them live:
- Fixes (closed): `sync-36cq` (bridge_reply threading), `sync-b41h` (evict hides history), `sync-wgtp` (pi MCP cache + concurrency). `git log --oneline 3b9381c..HEAD`.
- Findings (open): `sync-6ipk` (MCP instruction-block doc-drift), `sync-nf8m` (skill discovery + primer idea), `sync-xhad` (daemon restart severs pi), `sym-m7np`→`sync-m7np` (per-launch home duplicates skill/extension assets, P3).
- Research provenance: synchronize groups `round-table-v2` (group_id 6) and `round-three` (group_id 8).

This doc is the "how it actually went and what bit me" layer.

---

## 0. The shape of the session (read this first)
It was framed as "re-run the round-2 research panel," and it **opened** as research (two good probes + a reaction-instinct experiment — see §6). But within ~20 minutes it turned into an **almost-pure reliability/regression debugging session**, because the act of running the panel on the live bus surfaced real bugs, and the user (correctly) re-prioritized to *"reliability of the system"* and *"stress test / try to break it / regression analysis."* By session end I had **found, fixed, tested, committed, pushed, and live-verified three bugs**, filed four findings, and confirmed the launch path is reliable for Claude + pi (single/sequential/concurrent). The research round itself barely advanced past where round-2 reached. **Round 3 is where the research resumes — on a now-healthy panel.**

If you take one thing: *running the research on the live surface is the most effective bug-finder we have, but budget for the research to get hijacked by what it uncovers.* It happened in round 1 (the handoff next to this one) and again here.

## 1. The opening gotcha — verify YOUR OWN session before diagnosing "notifications are broken"
The user first launched me with a **bare `claude --resume`** (no synchronize channel). Symptom: I posted a kickoff, agents replied in-thread, the user `@operator`-tagged me twice — and I **received nothing**. It looked exactly like a P0 daemon notification bug. I spent real effort proving the daemon *was* delivering (DB inbox rows, `delivered_at` set, callback logs) before the user realized they'd launched me wrong and **relaunched me via `synchronize launch … --resume operator-test`** (which loads `--dangerously-load-development-channels server:synchronize`). Then channel pushes worked instantly.

**Lesson, encode it:** before diagnosing any "I'm not getting messages" problem, check your own parent process chain (`ps`/PPID) — confirm you were started through `synchronize launch` with `server:synchronize` loaded. A bare resume gives you working *outbound* `bridge_*` tools but **no inbound channel**, and the daemon will happily log "delivered" into the void. `bridge_whoami` showing `claude_channel_subscription_active: true` is **not** sufficient proof you'll actually receive — that flag was true even when I was deaf.

## 2. The three fixes — how each was *found* (the fixes themselves are in bd/commits)
- **Threading (`sync-36cq`):** found because *our own panel's replies didn't nest* in the GUI. DB showed every agent reply had `reply_to_event_id` set but `parent_event_id = NULL`. The `bridge_reply` group path copied `target.parent_event_id` verbatim instead of deriving the root (`?? target.event_id`) like `bridge_send_group` does. **The existing `mcp-e2e` test had the bug baked in as an assertion** (`expect(parent_event_id).toBeNull()`), so "tests pass" meant nothing — I had to flip the assertion. Watch for tests that encode current-wrong behavior.
- **Evict-hides-history (`sync-b41h`):** found because I evicted a stale duplicate `operator` peer to reclaim the alias, and the **human's GUI went blank** — the kickoff vanished. The event was still in the DB; the web client resolves a message's sender from the `peers` list, which excluded soft-deleted peers, so the message rendered author-less and dropped. Fix re-includes referenced (even deleted) senders in the web-state identity directory. The user's steer *"the UI is fine, the daemon is wrong"* was correct and saved time.
- **pi MCP cache (`sync-wgtp`):** the multi-hour centerpiece — see §3.

## 3. The pi-MCP-0/1 saga — the false trails, in order, and how each died
This is the most valuable process content because the *answer was counter-intuitive* and I burned the most time here. Symptom: auto-launched pi sessions came up **`MCP: 0/1 servers`** — extension/event path working, agent receiving events, but **unable to call any `bridge_*` tool** (silently mute). Trail of elimination:
1. **"Daemon restart severs pi" (`sync-xhad`)** — real, but only explains the *already-running* pi (their live connection died on restart and the codex path doesn't reconnect). Did **not** explain fresh launches.
2. **Stale processes / my manual daemon / churn** — killed everything, restarted clean, launched ONE pi in isolation → **still 0/1**. Ruled out.
3. **`pi-mcp-adapter` not linked** — checked the shared piHome: the npm symlink and `pi-mcp-adapter` were present. Ruled out.
4. **The resilient gate (`synchronize status`) failing** — ran it manually: exit 0, fast, daemon healthy. Ruled out. (Also confirmed launch env doesn't override `SYNCHRONIZE_HOME`.)
5. **The cache (the answer).** `mcp-cache.json` showed `servers.synchronize.tools = [23]` — so it was **not** a discovery failure; pi *had* the tools cached. `0/1` meant the **live connection** wasn't established. Hypothesis (the user reached it in parallel): on a cache **HIT** pi serves cached schemas but does **not** eagerly open the stdio connection; only a cache **MISS** connects eagerly. **Cleared the cache → launched → `1/1`.** Proven.
6. **Concurrency refinement.** Clearing the cache per-provision fixed single/sequential launches but **not** concurrent multi-launch: all pi shared one piHome → one `mcp-cache.json`; the first to boot reconnected and *regenerated* the cache, and the slower siblings hit it → `0/1`. Fix: **per-launch piHome keyed by `peer_id`** (private cache, no race) + keep the per-provision delete for same-key respawn. Verified: 3 concurrent pi → all `1/1`.

**The "what changed since round-2-start" answer** (the user pressed on this, rightly): the **daemon restart was a red herring for the relaunch failures.** At round-2 start the cache had no valid entry for the current config → cache **miss** → all pi connected eagerly (`1/1`) and *wrote* the cache. Every launch after that **hit** it → `0/1`. The restart only severed the running pi (#1 above) and happened to be when I started relaunching. Even with zero restarts, the *second* launch of the session would have hit the same wall. (Residual unknown, stated honestly to the user: *why* the cache was a clean miss at round-2 start when the piHome dir predated it — most likely config-hash-not-yet-cached or a pre-round wipe. The file's been overwritten, so that sub-detail is inference; the mechanism is proven.)

**The user's contributions were load-bearing** and shortened this dramatically: "it's the auto-launch logic, manual trigger works" (killed trails 3–4), "probably the cache staying consistent across multiple relaunches" (named the concurrency cause), "the fix should override the cached MCP logic / force a reload," and the **transcript-scatter** + **time-bomb** concerns that shaped the final design (per-launch *config* dir, **shared** session dir — pi's README confirms `PI_CODING_AGENT_DIR` and `PI_CODING_AGENT_SESSION_DIR` are independent knobs, so the split is safe).

## 4. The daemon-restart hazard (operational — this will bite you again)
I restarted the daemon **~4 times** (to deploy each daemon-side fix; `bun run src/daemon.ts` does **not** hot-reload). Every restart:
- **severs all pi sessions** (they don't reconnect — `sync-xhad`), and
- drops Claude subscriptions until their heartbeat re-subscribes (a few seconds).

So: **do not restart the daemon mid-round unless you're prepared to relaunch the pi panel afterward.** I pinned `SYNCHRONIZE_PORT=58405` on every restart to keep Claude + my own operator MCP reconnecting seamlessly — **do the same** (an unpinned restart picks a new random port and everything has to rediscover `daemon.json`). And **never `make daemon-relaunch`** mid-session — it wipes `~/.synchronize` and destroys all group history/data. Plain `kill` + `nohup … bun run src/daemon.ts` (pinned port, same `SYNCHRONIZE_HOME`) preserves the SQLite.

Note the current daemon was started by me **manually** via `nohup`, not the canonical CLI auto-start. It's healthy and on `f3c8df9`, but it's not how production starts it — worth a clean canonical restart at a calm moment.

## 5. Operational gotchas / the toolbox (things that silently wasted time)
- **`curl`/`fetch` to the daemon are hook-redirected** in this environment ("context-mode: … redirected"). Use `mcp__plugin_context-mode__ctx_execute` (javascript `fetch`) for any HTTP to `127.0.0.1:58405`. This is how I did `DELETE /peers/:id` and read `/web/state`.
- **The events table PK is `event_id`, not `id`.** Early `SELECT … id …` queries failed *silently* (RTK swallowed the error) and gave me garbage/empty results that looked like real data. Always `event_id`.
- **Evicting a peer doesn't stick while its adapter is alive.** A dead-to-the-TUI pi session can still have a live adapter heartbeating the daemon, which re-registers the peer and refreshes its lease (clearing `deleted_at`). You must **`bridge_stop` first** (kills the backend/adapter), *then* the peer/alias frees. I learned this the hard way trying to reclaim pi aliases.
- **Reclaiming an alias** held by a dead peer: `bridge_join_group` returns `alias_collision` while the old membership is active; evict the old peer (`DELETE /peers/:id`) → then join reclaims (`reclaimed_from` in the response).
- **`sleep` in Bash is blocked**; use `run_in_background: true` or a `Monitor`/`until` loop.
- **pi update banners** ("Update Available", "pi-mcp-adapter update") render at boot and are noise — not the cause of `0/1` (I chased this; it was the cache). pi is `0.75.3` (0.78.0 available).

## 6. Research state — where round 2 got to (so round 3 can build, not repeat)
Three probes' worth of *golden* data, already synthesized into bd/notes; the headlines:
- **Probe 1 (what skills/MCP/tools do you see):** the shipped surface **landed** — all six see the expanded `bridge_*` set incl. reply/react/thread/launch; reactions work; mention parser fixed; reply-routing fixed. The one real finding: the **MCP server's own instruction block is a release behind the toolset** (`sync-6ipk`).
- **Probe 2 (does the progressive-disclosure skill bet pay off):** sharp behavioral split — **Pi agents open the router (their skill triggers on `<synchronize_event>`); Claude agents never open it** (passive entry in a ~100-skill index); and **nobody, Pi or Claude, opens the detail `workflows/`/`reference/` docs** — only when blocked, which a well-specified task + self-describing tools rarely triggers. Unanimous fix direction: put pointers on an **always-loaded surface** (the MCP instruction block, *not* the skill index), make doc-opening a **MUST precondition**, and — the user's idea — **inject a synchronize primer on first contact** like the bd/context-mode primers (`sync-nf8m`).
- **React-vs-reply instinct experiment** (the user's design — tag everyone with no real ask, watch): **opus replied (twice, over-engaged), sonnet reacted 👋, the canaries went quiet.** Debrief was unanimous and quotable: the MCP's *"respond immediately"* instruction is a **response-biased prior** that never says when *not* to reply; the panel converged on a **response-tier ladder** (explicit ask→reply; group ask others cover→react/add-only-net-new; no ask→react or stay silent). *(Caveat: in that experiment the pi "silence" was confounded — they were disconnected (0/1) at the time, not exercising restraint. Re-run the instinct probe in round 3 now that pi is healthy.)*

Topics the user explicitly wants in round 3 (from this session + carried over): **the mirroring problem** ("agents talk on the bus but also mirror into the host session" — the user noted I was guilty of it; I shrank host output to stubs mid-session, keep doing that), re-validating the round-1 steered topics (cwd/branch awareness via `bridge_whoami` runtime_context, markdown/GFM awareness, presence honesty, deep-work-mode, handoff mechanism, first-contact context), and the react/reply tier-ladder as a concrete design.

## 7. Live state at handoff (pull fresh; don't trust this snapshot)
- **`master` HEAD** after this handoff commit; the four fix commits are `19c78bf`, `9fce425`, `8f05aec`, `f3c8df9`, all pushed.
- **Daemon:** running on `f3c8df9`, port `58405`, **manually** started (nohup), `SYNCHRONIZE_HOME=~/.synchronize`. Confirm via `~/.synchronize/daemon.json` + `lsof`.
- **`round-three` (group_id 8)** holds the **healthy** panel: `opus`/`sonnet`/`haiku` (claude) + `pi-high`/`pi-medium`/`pi-low` (pi, all `MCP 1/1` after the fix) + `you` (web). **`operator` is NOT yet joined to round-three** — join before driving round 3.
- `round-table-v2` (group_id 6) holds the round-2 transcript (probes 1–2, the instinct experiment); its agents are torn down.
- **Per-launch piHomes** now accumulate under `~/.synchronize/pi-agent/<peer_id>/` (one per pi launch). Harmless; `sync-m7np` tracks de-duping the copied skill/extension assets later.
- **Split to be aware of:** this session's work + the prior research-round handoff are on **`master`**; the round-1 *research docs* (`docs/skill-mcp-research-findings.md`, `docs/skill-mcp-roadmap.md`) live on the **worktree branch** `worktree-skill-progressive-refactor`, not master. If round 3 wants those findings as files, pull from that branch.

## 8. Immediate next step
**Round 3 = resume the research on the healthy panel.** Concretely: (1) `bridge_join_group round-three` as `operator`; (2) re-run the react/reply instinct probe now that pi is healthy (the pi band was confounded last time); (3) run the **mirroring** probe and the re-validation of round-1 steered topics; (4) keep host-session output to stubs (don't mirror). Reliability is in good shape — but if you must touch daemon code again, re-read §4 before restarting.

---
*Written per P4: judgment + dead-ends + process, state pulled live. If this doc conflicts with bd / the DB / the bus, those win.*
