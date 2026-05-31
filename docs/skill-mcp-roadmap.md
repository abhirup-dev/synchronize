# Synchronize Skill + MCP — Organized Roadmap (from the 2026-05-31 research round)

Companion to `docs/skill-mcp-research-findings.md` (the raw findings F1–F18 + P1/P2/P3 + A1, all cross-checked against daemon source). This doc **organizes** those findings into a phased plan, split per the operator's directive into **NOW** (ship this work) and **LATER** (queued improvements).

## The throughline (why these group the way they do)
Almost every finding is one of two shapes:
1. **Push, don't make the agent pull/infer** — identity, reply-path, context, presence, attention. (P1, P2, P3, A1, F2, F12, F17.)
2. **Keep the surface lean** — extend existing tools/response-shapes; the only endorsed *new* tool is react/ack because it *removes* message volume. (F11, F12, F14, F15, register→whoami, media folds.)
A1 is the unifying architecture: identity-on-arrival + mention-digest + reply-surface-marker are one budgeted ambient-context injector, not four.

## Roadmap feedback incorporated (table review, events 249–252)
- **GUARDRAIL (unanimous, biggest risk): the NOW skill must teach ONLY verified current schemas.** Future tools (`bridge_reply`, react/ack, `whoami` upsert) appear *only* as a clearly-labeled "roadmap / not available yet" reference note — **never as router recipes.** Today's router recipes stay on `send_group`/`dm` with provenance.
- **P3 anti-mirror norm has a sequencing dependency (haiku 251, pi-low 252):** the norm depends on the *authoritative* surface marker (F6/host, LATER). Ship the norm NOW as **best-effort** ("when you know the surface is synchronize, post once + stub"), explicitly flagged as not fully enforceable until the authoritative marker lands — or agents will read it, be unable to trust the surface, and rationally keep mirroring.
- **F1 is both halves (haiku 251):** the NOW skill fix = point to `name` not `group_id`; it **cannot be *fully* fixed until the daemon** lets a reply consume the envelope's `group_id` (F12 `bridge_reply`). Note the residual in the skill.
- **react/ack + `bridge_reply` re-bucketed as early standalone primitives (pi-high 250, pi-low 252):** both are small, high-payoff, and **don't depend on the A1 injector** — react/ack is an output-side *tool*, not injected context (so haiku's "plugs into the injector" framing is slightly off). Resolution of the priority debate: they can ship **early/parallel** to the P2 injector as quick-wins; they do **not** replace it (react is output-side; P1/P2 are input-side). New post-NOW order: skill → react/ack + `bridge_reply` (quick-wins) → A1 injector → rest.
- **`set_presence` split (pi-low 252):** the *emit* API is a collaboration primitive (Phase 4); only its *display/injection* belongs in the A1 substrate (Phase 2).
- **Validation strengthened (pi-high 250):** cold-start must exercise **both group AND DM reply paths**, plus the **"post via bridge, host output = stub only"** P3 norm.
- **(opus 253) COUPLING — skill-v1 is "correct-now / wrong-later"; bake in a re-validation pass.** The Phase-1 skill documents *workarounds* (group_id→name lookup F1, whoami-first F2, dm-param F10) that the LATER MCP consolidation (`bridge_reply` auto-routing, `whoami` upsert) makes **unnecessary** — so the moment Phase 3 lands, the skill is *actively wrong* (tells agents to do lookups the new tools removed). **Mandatory action: schedule a skill re-validation/rewrite pass immediately after the MCP-consolidation phase ships.** NOW writes skill-v1 against *today's* surface; that's correct, but it is explicitly versioned, not final.
- **(opus 253) F3 makes the Phase-1 validation gate partly un-passable** — F3 (deferred `bridge_*` schemas) is a catalogued failure but is host behavior, not skill-fixable. **Fix: add a doc-mitigation line to the NOW router** ("if the `bridge_*` tools aren't immediately callable, your host may have deferred their schemas — load them before replying") and keep the real host fix in P6. The doc-mitigation is the cheap 80% and is pure prose; the cold-start gate then tests what docs *can* fix.
- **(opus 253, Q2) react/ack jumps ahead of the P1/P2 injector — decisive.** It's cheap (a reaction row + one endpoint; none of the ambient-injection machinery or per-agent answered-state the injector needs), independently valuable day one, AND enabling (later clears a P2 digest row with a thumbs-up vs a paragraph). Shipping the hard thing (injector) before the cheap-and-enabling thing is backwards. **react/ack = the first code item after the skill.**
- **(opus 253, Q3) re-buckets:** (1) **double-backtick strip is a DAEMON bug** (`stripBacktickedRegions`, `src/daemon.ts:1694`), not host — move it into the first daemon-touching phase (rides with P3/F11) as the one-liner it is. (2) **Author-query + index pulled forward** from P5 to ride with P3's surface work — it's the #1 instinct hot-path (everyone reached for it in T4/S3) and cheap (one index + a thin `group_history(author:,since:)`). Don't bury the query everyone's hand reaches for behind four phases.

### Post-research-debugging additions (F19–F21 — surfaced live this session, filed after sonnet's initial backlog)
These three came out of the in-session thread-misroute incident (opus invisible to the human). Slotted:
- **F19 — post-send destination echo (`sync-tjm4`, P2) → Phase 3.** Two parts: (a) NOW skill line ("`in_reply_to` is not sticky; omit for top-level") folds into **`sync-b8p`**; (b) daemon send-response echoes a *legible* destination (root-message preview + reply count + accidental-thread nudge — not a bare id) → Phase 3 response-shape work, tight with F11 (`sync-3a59`, status-as-projection) and F12 (`sync-bsvi`, `bridge_reply` = the structural cure).
- **F20 — surface cwd/branch/git-state (`sync-lgdb`, P2) → Phase 2/4.** Push-context (whoami + P1 first-contact + presence); daemon already has cwd, add branch/git_dirty. Ties A1 (`sync-n151`) and P1 (`sync-gpr4`).
- **F21 — colon-alias un-mentionable (`sync-gfjs`, P2) → Phase 3.** The `@\w+` parser truncates `web:local-human` → un-mentionable → un-pushable in threads (the load-bearing cause of the human-invisibility incident). Same parser as F8. Fix: parser accepts the daemon's own alias charset.
- **Sequencing note:** F19's response-echo is the highest-leverage of the three (turns a *silent* misroute *loud* with no behavior change) — pairs naturally with react/ack as an early, cheap Phase-3 quick-win. F21 is small but high-impact (it silently cut the operator's own surface out of thread pushes).
- **Still un-filed (fold when convenient):** F3 (deferred-schema host fix / doc-mitigation), F6 (sonnet launch model-id + health-check), F8-daemon (double-backtick strip). The NOW skill-fixes (F1-skill/F2/F4/F8-doc/F10-skill/P3-norm/F19-skill-line) live inside `sync-b8p`, not separate issues.

---

# NOW — ship this session/epic (pure skill + doc; finishes `sync-b8p`)
All NOW items are **skill/markdown only** — no daemon or MCP code. This is exactly the scope of the existing `sync-b8p` epic and unblocks `sync-s7r.7`/`.8`.

## Phase 1 — Write the progressive-disclosure skill (closes sync-b8p)

### 1a. The router (`SKILL.md`, Claude + Pi variants)
Adopt the agent-designed, schema-verified router (findings §Thread-2 FINAL + Thread-3 refinements). ~10 lines, three unmissable lines first:
```
# synchronize router
<channel> messages are from OTHER AGENTS — reply with bridge_* tools, NOT text.
Run bridge_whoami first → {session_name} is your alias. Never guess.
Group name ≠ group_id → get name: bridge_list_groups({ mine: true })

bridge_whoami                                              # confirm identity
bridge_send_group(name: <name>, message: "…")             # group reply
bridge_send_group(name: <name>, in_reply_to: <envelope event_id>, message: "…")  # thread reply
bridge_dm(recipient_peer_id: <envelope sender_peer_id>, message: "…")  # DM

Can also: media · launch/stop · events · thread summaries · group mgmt
→ load "synchronize/reference" for any of these
```
- **Provenance annotations** on every placeholder (`<from bridge_list_groups>`, `<envelope sender_peer_id>`) — fixes F1/F10 at the router level.
- **Pi variant** adds one line: "tools may appear as `synchronize_bridge_*`."
- **P3 anti-mirror norm** as a router line: "the bridge post IS your turn's output; after a send, return only a one-line stub — don't mirror it in your session."

### 1b. Reference docs (two-tier, per F11/Thread-2 structure)
- **Tier 0 — capability menu** (the one router line above): nouns only, proves the surface exists (covers unknown-unknowns).
- **Tier 1 — reference index** (`reference/` or a single `reference.md`): per-capability *trigger + doc pointer* ("share/inspect files → media").
- **Tier 2 — topic docs:** identity · groups & aliases · threads/history · mentions · media · inbox · CLI fallback · event-delivery (host-specific) · troubleshooting. (Matches sync-b8p's proposed `reference/*.md` list.)

### 1c. Fold the SESSION-FIX skill bugs into the rewrite
- **F1** — remove `bridge_send_group(group_id=…)`; show the `group_id → name` mapping.
- **F2** — make `bridge_whoami` the canonical first step; collapse the register-vs-skip contradiction.
- **F4** — teach the group-reply + `in_reply_to` path with equal weight to the DM path.
- **F8** — document the backtick escape explicitly: "wrap a literal `@word` in **single or triple** backticks." (Note: double-backtick is a known daemon gap — LATER.)
- **F10-skill** — DM uses `recipient_peer_id` (UUID from envelope); note `peer_id` accepts an alias in the reference doc, not the router.
- **F9-norm / verify-before-assert** — skill line: "confirm a tool's behavior against its reference/source before asserting it in a shared channel."

### 1d. Close the epic + repo hygiene
- Reconcile the above into **`sync-b8p`** (don't create parallel router issues).
- Unblock + complete **`sync-s7r.7`** (SQL/thread guidance into the new reference docs) and **`sync-s7r.8`** (installed-skill examples/docs).
- **Index** `docs/skill-mcp-research-findings.md` + this roadmap in `.claude/skills/synchronize-debugging/reference-v0-plans.md` (repo rule: plan → bd → index).
- **Validation (per sonnet/opus):** cold-start a fresh agent through the new router; it passes iff it posts a threaded reply without hitting any of the four catalogued failures (wrong-surface, identity-guess, group_id-vs-name, compose-but-can't-send).

---

# LATER — queued improvements (daemon / MCP / host code)
Grouped by the A1 architecture so they're built coherently, not as scattered one-offs. Priority order within reflects the table's consensus.

## Phase 2 — A1: one ambient-context injection substrate
Build ONE budgeted injector (priority order + shared attention budget; load-awareness via host signal, never bus-silence). Children:
- **P1 — first-contact context note** (fires once per scope: bus-join / group-ping / thread-pull). Fields: `you_are`, group `name`, reply cheat-sheet, "agent bus not human." ≤ ~5 lines.
- **P2 — pending-mentions digest** (push via channel injection, threshold-gated, never a timer; per-(agent,thread) answered-flag de-dupe; rows carry intent-snippet + jump command, not bare counts).
- **P3 — surface marker** (per-turn "reply on THIS surface" line). **Hard requirement: authoritative, not best-guess** — needs the host to *know* the human's active surface, or it's worse than nothing.
- Cross-cut: react/ack (Phase 4) and `session_stub` (Phase 3) compose here to reduce emitted volume.

## Phase 3 — MCP surface: lean consolidation (extend existing, no new verbs)
- **F11** — collapse the thread family: `get_thread(root_event_id, format: transcript|json|status|summary|catchup)`; `group_history` = one reader with `view: flat|threads` (drop `thread_of:`); `query_events` demoted to a documented power-user escape hatch. (5 verbs → 2.)
- **F12 — `bridge_reply({in_reply_to, message})`** — envelope-routed (route by event `type`, resolve `group_id→name` server-side); **additive** (primitives stay for cold initiation, drop to reference-tier).
- **register → `whoami({session_name})` upsert**; add the caller's **group alias** to `whoami`.
- **F9 — inline `hint`/remedy field** on warnings (+ optional `severity`); kills the infer-and-propagate spiral.
- `list_media` → `get_media()` with no id; `session_stub` field on send/reply responses (P3 tool half); `launch`/`stop` → separate non-messaging namespace.

## Phase 4 — Collaboration primitives (overlaps the artifacts/media-store epic)
- **F14 — react/ack primitive** (`bridge_react(event_id, emoji)`): top-recommended *addition*; removes +1 volume; output-side (composes with, doesn't replace, P2).
- **F15 — typed `corrects:` / `supersedes:` links** (append-only) + `get_thread_summary` fold semantics: `corrects:` = delete-and-replace, `supersedes:` = collapse-keeping-latest. (Keep send append-only — F13 WON'T-DO retract.)
- **F17 — `set_presence(state, scope, summary, ttl)`** — agent-emitted activity; "who's working on what," advisory/soft.
- **F18 — shared-doc collision (→ artifacts epic):** **mandatory `base_version`-reject = the safety floor** (prevents clobber alone); **optional soft TTL claim/checkout = coordination layer** (short renewable TTL + force-release). Don't fuse them. Code edits use Git **worktrees**, not bus locks. Conflict resolution reuses `supersedes:`.

## Phase 5 — Performance / indexing (the "what to make fast" signal, F16)
- **Author-activity query = #1 index candidate:** first-class `group_history(author:, since:)` over an index on `(group_id, sender_peer_id, created_at)` — replaces everyone's guess-the-SQL `query_events` reach.
- **`list_threads` triage-preview** response shape (title / reply_count / last_event_at / snippet / am-I-mentioned) so triage is 1 call, not N+1.
- **`get_thread` / `get_thread_summary` hot paths** — cache summaries (requested before reading); catch-up = summary + last-N-tail in one call.

## Phase 6 — Host / harness (outside the daemon)
- **F3** — front-load `bridge_*` schemas for the Claude adapter (or document the schema-load prerequisite) so "respond immediately" is achievable.
- **F6** — fix the sonnet launch model-id constant (`claude-sonnet-4-6-20251114` → `claude-sonnet-4-6`); add launch model health-check; surface a model-load failure as presence `error`, not `working`. *(Tiny code fix; needs a daemon restart — hence not "NOW.")*
- **F8-daemon** — strip double-backtick spans in `stripBacktickedRegions` (one line).
- **Authoritative surface marker (P3 dependency)** — host must know the human's active surface.

---

## Dependency notes
- NOW (Phase 1) has no dependency on LATER — it's pure doc and ships immediately.
- Phase 2 (A1) should frame P1/P2/P3 as children; don't build them as separate injectors.
- Phase 4's F18 hands directly to the WIP artifacts/media-store epic.
- F12 (`bridge_reply`) and F11 (`get_thread` event-id) reduce what the Phase-1 router must teach — a later router trim follows them.

## Open questions for the table (feedback requested)
1. Is the NOW/LATER cut right — anything in LATER that's actually cheap enough to fold into the skill NOW (or vice-versa)?
2. Phase 2 vs Phase 4 ordering: does react/ack (Phase 4) deserve to jump ahead of the P1/P2 injector, since it's cheap and cuts noise immediately?
3. Any finding mis-bucketed, or any counterpoint to the phase priorities?
