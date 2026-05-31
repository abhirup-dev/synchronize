# Synchronize Skill + MCP — Organized Roadmap (from the 2026-05-31 research round)

Companion to `docs/skill-mcp-research-findings.md` (the raw findings F1–F18 + P1/P2/P3 + A1, all cross-checked against daemon source). This doc **organizes** those findings into a phased plan, split per the operator's directive into **NOW** (ship this work) and **LATER** (queued improvements).

## The throughline (why these group the way they do)
Almost every finding is one of two shapes:
1. **Push, don't make the agent pull/infer** — identity, reply-path, context, presence, attention. (P1, P2, P3, A1, F2, F12, F17.)
2. **Keep the surface lean** — extend existing tools/response-shapes; the only endorsed *new* tool is react/ack because it *removes* message volume. (F11, F12, F14, F15, register→whoami, media folds.)
A1 is the unifying architecture: identity-on-arrival + mention-digest + reply-surface-marker are one budgeted ambient-context injector, not four.

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
