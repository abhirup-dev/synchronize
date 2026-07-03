# reference-v0-plans.md

> ## ⚠️ Read-on-demand only
>
> **Reading any document indexed below WILL consume substantial context.**
> The files range from ~50 to ~500 lines each. Loading several of them
> blindly can burn a large fraction of your conversation budget.
>
> Load a document only when:
> 1. The user **explicitly** asks you to read it, **or**
> 2. You need a **hard reference to a previous implementation session** to
>    answer a question that cannot be answered from current code state.
>
> Default behavior: cite the document by name and continue working without
> reading it. Reach for the current code (and the other skill detail files)
> first — those reflect what was actually shipped, not just what was
> planned.

---

## Index

### Top-level platform plan & overview

| File | Lines | Topic |
|---|---|---|
| `PLAN.md` | 372 | Original synchronize platform plan — daemon model, REST API, MCP adapter, peer/group/event semantics. Authoritative source for v0 design intent. |
| `README.md` | 482 | User-facing project README — feature surface, install instructions. Read for current state, not history. |
| `CLAUDE.md` | 77 | Project conventions for AI agents (build, tests, branch/merge policy). Always loaded — listed for completeness. |
| `AGENTS.md` | 89 | Operator workflow conventions (session-close protocol, non-interactive shell flags). |
| `AUTO_REGISTRATION.md` | 63 | How auto-registration works (Claude Code SessionStart hook ↔ daemon ↔ MCP peer). |

### Goals-tracker plans (v0 scope and verification)

| File | Lines | Topic |
|---|---|---|
| `goals/synchronize/brief.md` | 63 | One-page goal statement for the platform. |
| `goals/synchronize/plan.md` | 256 | Implementation plan with phase breakdown. Mostly historical now. |
| `goals/synchronize/blockers.md` | 31 | Outstanding blockers at v0 cut. |
| `goals/synchronize/goal-prompt.md` | 28 | The original prompt that kicked off the project. |
| `goals/synchronize/verification.md` | 48 | v0 acceptance verification. |

### Session-tracker plans (multi-session feature designs)

| File | Lines | Topic | Authoritative for |
|---|---|---|---|
| `session-tracker/plan-advanced-synchronize-registering-hooks.md` | 482 | Detailed design for Claude Code session hook registration, host_session_id binding, launch-id correlation. | `agent_sessions` table, `bridge_register` semantics, SessionStart hook flow |
| `session-tracker/plan-group-policy-v0.md` | 385 | Group policy v0: durable vs ephemeral, member alias semantics, soft-delete (sync-dmc), MCP adapter pass, dx2 TUI. | Group lifecycle, alias-vs-session_name split, soft-delete migration v2 |
| `session-tracker/plan-agent-ttl-presence-v0.md` | 116 | Agent TTL + 3-state presence. Two-knob model: short liveness lease (60s, `SYNCHRONIZE_LEASE_MS`) as the only offline detector + 24h retention sweeper; `activity_state` (initializing/working/idle) fed by Pi `agent_start`/`agent_end` and Claude hooks + MCP-adapter channel-delivery push. Footgun removal (no client `deletePeer`). | `sync-6mz` (Unit 1) + `sync-ztr` epic (Unit 2), lease/offline semantics, `peers.activity_state` grain, resume identity via `findPeerByHostSession` |
| `session-tracker/plan-unified-session-annotation-v0.md` | 319 | Unified session annotation v0: one TS-in-daemon parser turns Claude/Pi (later Codex) transcripts into a uniform annotation record set, as the bus's own RAG/search baseline. Decisions: NO CASS fork (synchronize owns the layer, reusing CASS's SQLite-catalog+Tantivy discipline not its code); architecture = **data lake** (immutable `session_annotations` corpus, system-of-record) **+ reverse indexes** over it (metadata=SQLite B-trees now; content=FTS5/Tantivy later; vector/graph+RRF K=60 later); **v0 scope = tables+schema+query layer, SQLite-backed basic search only** (exact-facet filters, LIKE body, ±N window). The two prototype branches converged on the same schema (extraction not a build); daemon already stores identity `(host_tool,host_session_id)` + locator `host_session_file` in `agent_sessions`. v0 query layer = engine-neutral `AnnotationQuery` spec (allowlisted fields, eq/like ops, window, limit) → SQLite executor incl. the window CTE; later only the hits-CTE swaps to an index lookup. Catalog `session_annotation_state` row carries project SLUG (distinct from cwd path), parser/schema version, rollups. Prior art studied (CASS/Tantivy/Hindsight/Supermemory-MemPalace/AgentMemory) all in §Design influences. Beads epic `sync-nxqo` (`sync-214a` schema, `sync-1wtw` parser core, `sync-cjo7` query layer, `sync-wdmk` golden+query tests). | lake-vs-reverse-index model, `session_annotations`+`session_annotation_state` schema, per-agent decoder contract, engine-neutral query spec + window CTE, two-tier recall/smart_search roadmap, slug-vs-cwd scoping, cross-machine identity-vs-location, Pi/Claude transcript locator + fallback globs |
| `docs/plans/archive-resume-daemon-refactor-merge-map.md` | 1220 | Archive/resume daemon-refactor integration handoff. Keeps `codex/resumable-archives-plan` as raw v1 behavior oracle and `codex/archive-resume-refactor-integration` as the staged merge branch; maps monolithic archive/resume `daemon.ts` responsibilities into refactored daemon route/repo/service modules; includes parent/current worktree coordinates, config resolver constraints, handoff doc report, merge risks, test gates, and Beads stack `sync-0vpq`, `sync-x7ch`, `sync-456r`. | Refactor merge strategy for archive/resume into `codex/daemon-refactor-expanded-scope`; daemon module destinations for archive/resume helpers; RuntimeConfig/env classification for archive tests; staged issue graph for gradual integration |

### Research findings

| File | Lines | Topic |
|---|---|---|
| `docs/skill-mcp-research-findings.md` | ~600 | 2026-05-31 live customer research — six agents (opus/sonnet/haiku/pi-high/pi-medium/pi-low) interviewed on skill + MCP surface friction. F1–F18 + P1/P2/P3 + A1 findings, all cross-checked against daemon schema. Authoritative spec for skill progressive-disclosure rewrite (sync-b8p) and MCP lean consolidation issues (sync-bsvi, sync-ever, sync-89g3, sync-3a59, sync-n151, sync-gpr4, sync-gjj6). |
| `docs/skill-mcp-roadmap.md` | ~80 | NOW/LATER phased roadmap from the 2026-05-31 research session. Phase 1 = skill rewrite (pure doc, closes sync-b8p). LATER phases = injection layer (A1), MCP consolidation, collaboration primitives, perf/index, host/harness. Carries the ASCII phase map + v0 cut (phases 0–4 = v0 P0/P1; 5–7 deferred P2). |
| `docs/progressive-discovery-skill-refactor-plan.md` | 772 | Reviewed implementation plan for the canonical shared workflow/reference skill layout plus thin Claude/Pi routers and synchronize-debugging reply-target SQL update (sync-b8p, sync-s7r.7, sync-s7r.8, sync-702a). |
| `.claude/handoffs/2026-05-31-skill-mcp-research-round-orchestration.md` | ~90 | PROCESS handoff for the 2026-05-31 research round — orchestration model, verification discipline (DB/source/tmux checks), the debugging episodes (sonnet dark model-id, haiku compose-but-not-deliver, opus thread-misroute invisibility, colon-alias full-circle), multi-agent + two-checkout coordination gotchas (cwd-persistence trap, sonnet filing to master, daemon-runs-from-master). Judgment/dead-ends layer; does NOT restate findings/roadmap. |
| `.claude/handoffs/2026-06-01-round2-redux-reliability-debugging.md` | ~110 | PROCESS handoff for the "round-2 redux" session that became reliability debugging. Three bugs found+fixed on master (sync-36cq bridge_reply parent derivation; sync-b41h evict-hides-history web-state sender resolution; sync-wgtp pi MCP-cache 0/1 incl. concurrency via per-launch piHome). Centerpiece: the pi-MCP-0/1 false-trail elimination (restart→stale-procs→package→gate→cache→concurrency) + the "what changed = cache miss→hit, daemon restart was a red herring for relaunch failures" reasoning. Operational gotchas: verify own session loaded server:synchronize channel before diagnosing notifications; daemon restart severs pi with no reconnect (sync-xhad); curl/fetch hook-redirected→use ctx_execute; events PK is event_id not id; bridge_stop before evict (zombie adapter revives peer/lease); PI_CODING_AGENT_DIR (config, now per-launch) vs PI_CODING_AGENT_SESSION_DIR (transcripts, shared). Carries the round-2 research state (probes 1–2 + react/reply instinct) for round 3. |
| `.claude/handoffs/2026-06-01-round456-response-directive-engineering.md` | ~130 | PROCESS handoff for the rounds 4→6 response-directive engineering loop (change directive on master → reinstall → launch fresh panel → measure behavior delta → repeat). Shipped + live-validated one coherent response directive across all THREE agent-facing layers synchronize owns (MCP instruction block `src/mcp/lifecycle.ts`, `bridge_reply`/`bridge_dm`/`bridge_send_group` tool descriptions, both `SKILL.md`): lightest-sufficient-means + DM-priority + you-are-live-on-synchronize + human-is-a-peer-on-the-bus + respond-EXCLUSIVELY-via-bridge_* + GUI-mode in-session override + skill pointer. Before/after: instinct noise 5/5-react(primed)→4-react-2-silent-0-reply(directive); 6/6 deliver via bridge_* incl. opus; GUI-mode proven bidirectional toggle; no over-correction. Bugs/findings: sync-2zkb (sonnet dated model snapshot claude-sonnet-4-6-20251114 → undated, fixed+CLOSED), sync-ajkz (silent reply loss: text answers fall back to host output, reactions don't — tool-or-nothing vs free host sink; directive mitigates, structural post-turn guard pending), sync-eix6 (host presence-narration NOT fixed by directive — needs host_observed flag + explicit rule), sync-jf75 (presence=adapter heartbeat not agent health), sync-9fzx (orphaned synchronize-mcp adapter reaping), group-deletion/archival gap. Operational gotchas: daemon auto-restart race (operator adapter wins ensureDaemon — pin SYNCHRONIZE_PORT=58405), parallel user sessions committing to master, GUI-mode confounds mirroring measurements, AOE profile = synchronize-<djb2hash(home)> (aoe -p PROFILE remove <id> prunes ghosts), claude-code tool-tag breaks bridge_stop, the Claude `<channel>` wrapper is harness-owned (not editable) while the only 3 agent-facing layers we own are MCP block + tool descriptions + skills. |

### Design docs

| File | Lines | Topic |
|---|---|---|
| `web/DESIGN.md` | 427 | Web UI design — DataSource interface, ChatView/MessageRow/Sidebar component layout, theme tokens. |
| `docs/plans/web-kanagawa-dark-theme-reference.md` | 76 | Incremental Kanagawa dark-theme visual retune against copied reference screenshots, sliced by chat cards, composer, sidebar, header, roster, board, artifacts, and activity surfaces (sync-a694, sync-4ste, sync-eeas, sync-063f, sync-ntmy, sync-0kj2, sync-nxee, sync-iimf). |
| `docs/plans/web-local-session-store.md` | 134 | Plan for daemon-owned local web session store and future principal identity tracking (sync-z2q, sync-c5t). |
| `docs/plans/web-responsive-compact-shell.md` | 321 | Responsive compact web shell plan for staged roster/sidebar collapse, community and agent takeovers, and compact composer navigation (sync-ogbk). |
| `web/MOBILE-UI-AUDIT.md` | ~150 | Compact (mobile, <780px) UI/UX audit register from the Android-app overhaul — navigation/layout/UX findings across every view (room header, thread, activity, room-switcher sheet, board, bottom nav, composer), scored against mobile chat heuristics and prioritized P0/P1/P2. Records two bugs fixed inline (F1 agents-nav clobber, F2 legacy-MQ empty roster). Drives sync-wlbk (room header A1/A2), sync-6e0l (thread screen B1/B2), sync-frju (activity header C1), sync-1l2s/600e/l47x/mehb/qox3/rybj (P1), sync-tcoo (P2 batch) — all children of epic sync-20du. Compact-only; desktop/medium out of scope. |
| `docs/plans/storybook-integration.md` | 500 | Storybook integration plan for the web UI component glossary, isolated component verification, theme/viewport matrix, browser story tests, and MCP-backed agent workflow (sync-i24s). |
| `docs/plans/multi-machine-support.md` | 137 | Feasibility + phased plan for remote sessions joining one daemon over Tailscale, rendered together in the UI (sync-kp1 epic; sync-2bo, sync-stn, sync-xl3, sync-h9h). **Phase 2 (unified SSE) superseded by `multi-machine-push-v0.md`** — read that for the shipped delivery approach. |
| `docs/plans/multi-machine-push-v0.md` | 200 | Scope-limited revision of `multi-machine-support.md` Phase 2. Remote Claude live push via the existing outbound-polling NotificationBridge, gated on SYNCHRONIZE_REMOTE_URL (local Claude keeps native callback push). Deletes the unified-SSE/EventStreamSubscription design as over-engineered; zero daemon changes. Authoritative for transport selection in `activatePeer` / `useCallbackPush` (sync-kp1 epic; sync-tjrj transport gate DONE, sync-itt1 cross-machine verification). |
| `docs/plans/config-unification.md` | ~150 | Unify ~40 scattered SYNCHRONIZE_* env reads behind one typed RuntimeConfig resolver (defaults < config.toml < env). Key decision: Category A (operator config → resolver) vs Category B (per-process IPC/correlation → stays env, bounded+documented). Covers the test-harness strategy (writeTestConfig/testConfig, drop config.toml in per-test HOME) so env soup leaves test invocations. Pure structural refactor, env override preserved. (epic sync-tw0e; sync-1w0q resolver → sync-x7ep daemon/tunables, sync-11gp summary/llm/skills, sync-wbav test harness; builds on sync-7mcv connection section). |
| `docs/plans/multi-machine-cli-devex.md` | ~270 | Operator/customer CLI DevEx for multi-machine: a new client-side `~/.synchronize/config.toml` profile layer (named `[remote.*]` targets that feed the existing SYNCHRONIZE_REMOTE_URL env contract, env still wins) + a `synchronize remote` command family (add/use/ls/show, provision, sync, upgrade, status) + `doctor`. ASCII use-case diagrams for D1–D7 (operator) and C1–C2 (customer). Decisions: TOML profiles, bidirectional skills/MCP sync (3-way reconcile + manifest, downgradable to one-way), build profiles-first. (sync-kp1 epic; sync-7mcv profiles → sync-nxyp provision → sync-qqw8 parity, sync-i01i ops). |
| `docs/plans/launch-lifecycle-kernel.md` | 386 | Durable launch lifecycle kernel for local AOE launches and future remote executors — continues `docs/plans/aoe-agent-launch.md` and `sync-6wlv` (epic sync-txpj). |
| `docs/plans/agent-launch-profiles.md` | 457 | Generic agent launch profiles for treating `[agent.<name>]` as self-contained launch/spawn targets with runtime identity preserved, secret-source env redaction, durable profile persistence, and archive/resume continuity (sync-c84i, sync-c84i.1). |
| `docs/group-sync-integrity.md` | 455 | End-to-end group registration and sync integrity walkthrough. Long but authoritative on subtle group-membership invariants. |
| `docs/integration-tmux.md` | 216 | AoE/tmux integration harness — how Pi agents under tmux are exercised in integration tests. |
| `docs/plans/aoe-agent-launch.md` | 161 | Daemon-managed AOE-backed launch of persistent Claude/Pi sessions with server-side group auto-join; REST+CLI+MCP, no UI (v0). Decisions: in-memory launch map (no table), pin peer_id at launch, swappable SessionBackend, rely on global install (epic sync-gsx; slices sync-lb1/62d/0g9/0at/32k/tm4/rh5/1c2/ewj/2xt/qkl/7u4). |
| `docs/plans/global-skill-picker.md` | 188 | Global web composer skill picker. Supersedes the old per-peer `@Alice::` draft; daemon owns a startup-loaded Claude/Pi skill catalog, web sends selected `skill_directives`, and only mentioned recipients receive the directive prefix (epic sync-yamq; slices sync-tyne/p40h/wewu/3dmv/7kof). |
| `docs/plans/web-attachment-preview-ui.md` | 241 | Web attachment preview UI for pasted/picked images and files, runtime staging cleanup, path-shaped daemon bridge text, and local sent-message preview metadata (sync-q181, sync-q181.2, sync-ntiv, sync-ldo7). |
| `docs/plans/web-activity-view.md` | ~150 | Web Activity view — global cross-room feed above Groups (Digest + Row + Grouped/Timeline). Derives from real data; awaiting-you is server-authoritative via `inbox.acked_at` (react/reply/mark-all clear it); dedicated `GET /activity/:peerId` over `inbox⋈events` (one indexed scan, not per-room fan-out) + inbox `(recipient_peer_id, event_id)` index; SSE-driven incremental refresh; memoized rows + virtualized Timeline; single generic item type now, forward-compatible for future work-event categories (epic sync-njd5; slices sync-xokt/riqh/gzwj/t31i/cbq3/kljk/pep6/4ofn). |
| `docs/plans/web-archive-recovery-console.md` | 427 | Web archive recovery console plan for contextual archive/resume preview-confirm flows plus a bottom-left archived sessions recovery console, derived from backend lifecycle state and scoped by epic sync-4trr. |
| `docs/plans/cli-completion-carapace-v0.md` | 555 | CLI completion Carapace V0 plan for schema-first command metadata, generated Carapace specs, daemon-safe dynamic candidates, and raw zsh forward compatibility (sync-x7q1). |
| `docs/plans/daemon-modularization-v2.md` | 1322 | Current master daemon modularization plan for a strictly structural, phase-wise refactor with pre-refactor route precedence, validation, and response-shape snapshot tests first (sync-mkj, sync-mkj.12, sync-mkj.13). |
| `docs/plans/web-url-deep-links.md` | 407 | Web URL deep-link plan for derivable instance-local `/web/e/:eventId` links, bounded target hydration, app-shell focus routing, Storybook flow coverage, and live `/web` verification (sync-vbd6). |
| `docs/agentmemory-scope-repair.md` | 101 | Local AgentMemory project-scope repair and repeatable restore process for preserving sessions, observations, memories, lessons, crystals, and summaries while clearing polluted derived scopes (sync-815x). |

### Per-extension READMEs

| File | Lines | Topic |
|---|---|---|
| `extensions/pi-synchronize/README.md` | 77 | Pi extension overview — what it does, env vars it consumes. |
| `scripts/README.md` | 190 | Index of helper scripts (`seed-demo.ts`, hooks config, doctor, integration runners). |

### Agent-process docs (always-loaded category)

| File | Lines | Topic |
|---|---|---|
| `docs/agents/domain.md` | small | Single-context-repo agent guidance. |
| `docs/agents/issue-tracker.md` | small | Beads usage in this repo. |
| `docs/agents/triage-labels.md` | small | Matt Pocock triage label conventions. |

---

## Authoritative-for cross-reference

When you need ground truth on a topic, the table below tells you which
document to load (or whether the answer is in current code instead):

| Topic | First check (current code) | Historical reference (load only if code is unclear) |
|---|---|---|
| Peer lifecycle and ownership | `src/daemon/routes/peers.ts`, `src/daemon/repo/peers.ts`, `src/mcp/lifecycle.ts`, `extensions/pi-synchronize/src/index.ts`, plus `peer-lifecycle.md` | `session-tracker/plan-group-policy-v0.md` (soft-delete section) |
| Group + alias semantics | `src/daemon/routes/groups.ts`, `src/daemon/repo/groups.ts`, `src/db.ts`, plus `delivery-forensics.md` | `docs/group-sync-integrity.md` |
| Mention resolution | `src/daemon/server.ts` (`MENTION_TOKEN_RE`) plus `src/daemon/routes/{groups,messaging}.ts` | `session-tracker/plan-group-policy-v0.md` (mentions section) |
| Thread normalization | `src/daemon/server.ts`, `src/daemon/routes/{groups,messaging,threads}.ts`, `src/daemon/repo/threads.ts` | `session-tracker/plan-group-policy-v0.md` (threads section) |
| SessionStart hook & launch-id correlation | `src/cli/commands/hook.ts`, `scripts/claude-hooks-config.ts` | `session-tracker/plan-advanced-synchronize-registering-hooks.md` |
| agent_sessions table | `src/db.ts`, `src/daemon/routes/agent-sessions.ts`, `src/daemon/repo/agent-sessions.ts`, `src/api/agent-sessions.ts` | `session-tracker/plan-advanced-synchronize-registering-hooks.md` |
| Durable launch lifecycle and remote-executor seam | `src/launch/*`, `src/daemon/repo/launch.ts`, `src/db.ts` | `docs/plans/launch-lifecycle-kernel.md` |
| Web archive recovery UI | `web/src/*`, `src/daemon/routes/archive.ts`, `src/daemon/services/archive.ts` | `docs/plans/web-archive-recovery-console.md` |
| CLI completion architecture | `src/cli/*` | `docs/plans/cli-completion-carapace-v0.md` |
| Runtime/remote configuration | `src/config.ts`, `src/cli/commands/remote.ts`, `docs/configuration/README.md` | `docs/plans/config-unification.md`, `docs/plans/multi-machine-cli-devex.md` |
| Web UI data flow | `src/daemon/routes/web.ts`, `src/daemon/services/web-events.ts`, `web/src/*`, `web/DESIGN.md` | `web/DESIGN.md` itself is current; load it directly when the question is UI-design |
| Local web session identity | `src/daemon/routes/web.ts`, `src/daemon/repo/peers.ts`, `web/src/data/daemon.ts`, plus `glossary.md` | `docs/plans/web-local-session-store.md` |
| tmux integration harness | `scripts/integration-*.py`, `scripts/integration-aoe/` | `docs/integration-tmux.md` |

---

## Adding new plans to this index

This index is the only gated entry point through which the rest of the
skill points at historical plans and handoffs. **A plan that exists on
disk but is not indexed here is invisible to future sessions** — the
other detail files deliberately do not link directly to plan files, so
agents who never read this index never see the plan.

### When to add an entry

Add a plan to this index when **all** of the following are true:
1. You authored a new plan, handoff, design doc, or ADR.
2. You created bd issues that scope the implementation work derived from
   that plan.
3. The bd issues have been filed (not merely drafted).

That ordering matters. A plan without bd issues isn't yet a unit of work
this index should advertise. Adding the entry is the final step that
makes the plan discoverable.

### Where to add it

Pick the matching section in the index:

| Section | Use when the plan is… |
|---|---|
| Top-level platform plan & overview | Platform-wide scope; cross-cuts most subsystems |
| Goals-tracker plans | Tracked in `goals/<feature>/`; scoped to a single goal with brief/plan/blockers/verification |
| Session-tracker plans | A multi-session implementation plan with phase breakdown; lives in `session-tracker/` |
| Design docs | Subsystem-level design (`web/DESIGN.md`-style); not phase-driven |
| Per-extension READMEs | Documents a single extension's surface |

If no section fits, add a new one — but only if you have at least two
plans that would live there. Single-plan sections create noise.

### Entry format

One table row, columns matching the section's existing schema:

| Column | Content |
|---|---|
| `File` | Relative path, in backticks |
| `Lines` | `wc -l` count at write time (rounded is fine) |
| `Topic` | **One sentence**. Describe what the plan is *for*, not what it *says*. No quotes, no excerpts. |
| `Authoritative for` (in cross-reference table) | The specific topics this plan is the ground-truth source for. Used by future readers to decide whether they actually need to load it. |

Also cite related bd issue IDs in the Topic column when the relationship
is non-obvious — e.g. `Group policy v0: durable vs ephemeral... (sync-dmc,
sync-2sr)`. This lets readers trace skill → plan → bd in one hop.

**Chain citations.** When a plan is part of a series of handoffs or rounds
(e.g. "round 2 continues round 1", "v1 supersedes v0"), cite the
predecessor (and successor, if known) in the Topic column:
`Round 2 of soft-delete shipping — continues round-1.md; followed by
round-3.md (sync-dmc)`. This makes the chain discoverable without
loading any of the linked files. Do NOT create a separate chronology
index — the citation pattern is the index.

### Deriving chronology when it's not annotated

For plans that predate this convention or where chain citations are
missing, derive order from git:

```bash
# Creation order of all plans under a directory
git log --diff-filter=A --reverse --format='%ai %H %s' -- session-tracker/

# Or: when did THIS file first appear, and what referenced it after?
git log --diff-filter=A --format='%ai' -- session-tracker/plan-group-policy-v0.md
git log -S 'plan-group-policy-v0' --format='%ai %s'
```

File-name conventions (`round-N`, `v0`/`v1`, dated prefixes) usually
carry logical order even when git history is ambiguous (rebases, file
moves). Trust the conventions; fall back to `git log --follow` if a
file was renamed.

### Ambiguity — ask, don't assume

If you can't confidently fill in a field (which section the plan belongs
to, what its predecessor in a chain is, which bd IDs are related, whether
it supersedes an existing entry), **ask the user**. A wrong entry is
worse than a missing entry — it leads future sessions astray.

The exception: if the answer is discoverable from the codebase, git
history, or bd issues, do the discovery yourself first. Don't ask the
user about things you can `grep`, `git log`, or `bd show` your way to.
Ask only after that path is exhausted.

### Forbidden in entries

- ❌ Quoting or summarizing the plan's contents (defeats the gating purpose
  — agents will read the summary and skip the warning).
- ❌ Multi-sentence topics.
- ❌ Linking to the plan from any other skill file (only this index links
  to plans; other detail files cite the index by name).
- ❌ Adding the entry before bd issues exist (the index advertises work
  that has been scoped, not ideas that have been jotted down).

### Maintenance

When a plan becomes obsolete (superseded by a newer plan, or fully
implemented and the implementation now diverges from the plan's intent),
mark it `(superseded by <new-file>)` or `(historical — code is canonical)`
in the Topic column rather than removing the row. Removing rows breaks
the audit trail; annotating them preserves it while warning readers.

---

## How to load (when you do)

```bash
# Targeted: a section, not the whole file
sed -n '100,200p' session-tracker/plan-group-policy-v0.md

# Or via the Read tool with explicit offset/limit
# Always prefer reading a slice over the whole file
```

If the user asks "what did we plan for X?", point them at the file by name
first. Read it only if they confirm or if the current code genuinely
doesn't answer the question.

### Integration plans

| File | Topic |
|---|---|
| `docs/plans/letta-native-integration.md` | Letta ↔ synchronize native channel integration — decision log: topology, tool-access model, the three PoCs (remote/agent/channel) and why the channel won, problems solved (crypto-over-HTTP, turn-stuck, version pins), polling-vs-push tradeoff, assumptions. Forward work under bd epic `sync-fi9l`. |

## See also

- `glossary.md` — current code locations for every concept these plans
  describe. **Almost always start here instead.**
- `.serena/memories/*.md` — narrative architecture summaries derived from
  the plans above. Lighter-weight than the plans themselves; load specific
  entries on demand.
