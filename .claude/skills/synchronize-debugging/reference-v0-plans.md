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

### Research findings

| File | Lines | Topic |
|---|---|---|
| `docs/skill-mcp-research-findings.md` | ~600 | 2026-05-31 live customer research — six agents (opus/sonnet/haiku/pi-high/pi-medium/pi-low) interviewed on skill + MCP surface friction. F1–F18 + P1/P2/P3 + A1 findings, all cross-checked against daemon schema. Authoritative spec for skill progressive-disclosure rewrite (sync-b8p) and MCP lean consolidation issues (sync-bsvi, sync-ever, sync-89g3, sync-3a59, sync-n151, sync-gpr4, sync-gjj6). |
| `docs/skill-mcp-roadmap.md` | ~80 | NOW/LATER phased roadmap from the 2026-05-31 research session. Phase 1 = skill rewrite (pure doc, closes sync-b8p). LATER phases = injection layer (A1), MCP consolidation, collaboration primitives, perf/index, host/harness. |

### Design docs

| File | Lines | Topic |
|---|---|---|
| `web/DESIGN.md` | 427 | Web UI design — DataSource interface, ChatView/MessageRow/Sidebar component layout, theme tokens. |
| `docs/plans/web-local-session-store.md` | 134 | Plan for daemon-owned local web session store and future principal identity tracking (sync-z2q, sync-c5t). |
| `docs/plans/multi-machine-support.md` | 137 | Feasibility + phased plan for remote sessions joining one daemon over Tailscale, rendered together in the UI (sync-kp1 epic; sync-2bo, sync-stn, sync-xl3, sync-h9h, sync-jeb, sync-8ga). |
| `docs/plans/launch-lifecycle-kernel.md` | 386 | Durable launch lifecycle kernel for local AOE launches and future remote executors — continues `docs/plans/aoe-agent-launch.md` and `sync-6wlv` (epic sync-txpj). |
| `docs/group-sync-integrity.md` | 455 | End-to-end group registration and sync integrity walkthrough. Long but authoritative on subtle group-membership invariants. |
| `docs/integration-tmux.md` | 216 | AoE/tmux integration harness — how Pi agents under tmux are exercised in integration tests. |
| `docs/plans/aoe-agent-launch.md` | 161 | Daemon-managed AOE-backed launch of persistent Claude/Pi sessions with server-side group auto-join; REST+CLI+MCP, no UI (v0). Decisions: in-memory launch map (no table), pin peer_id at launch, swappable SessionBackend, rely on global install (epic sync-gsx; slices sync-lb1/62d/0g9/0at/32k/tm4/rh5/1c2/ewj/2xt/qkl/7u4). |
| `docs/plans/global-skill-picker.md` | 188 | Global web composer skill picker. Supersedes the old per-peer `@Alice::` draft; daemon owns a startup-loaded Claude/Pi skill catalog, web sends selected `skill_directives`, and only mentioned recipients receive the directive prefix (epic sync-yamq; slices sync-tyne/p40h/wewu/3dmv/7kof). |
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
| Peer lifecycle and ownership | `src/api/peers.ts`, `src/mcp/lifecycle.ts`, `extensions/pi-synchronize/src/index.ts`, plus `peer-lifecycle.md` | `session-tracker/plan-group-policy-v0.md` (soft-delete section) |
| Group + alias semantics | `src/api/groups.ts`, `src/db.ts`, plus `delivery-forensics.md` | `docs/group-sync-integrity.md` |
| Mention resolution | `src/daemon.ts` (`MENTION_TOKEN_RE`) | `session-tracker/plan-group-policy-v0.md` (mentions section) |
| Thread normalization | `src/daemon.ts` (`parent_event_id` logic) | `session-tracker/plan-group-policy-v0.md` (threads section) |
| SessionStart hook & launch-id correlation | `src/cli/commands/hook.ts`, `scripts/claude-hooks-config.ts` | `session-tracker/plan-advanced-synchronize-registering-hooks.md` |
| agent_sessions table | `src/db.ts`, `src/api/agent-sessions.ts` | `session-tracker/plan-advanced-synchronize-registering-hooks.md` |
| Durable launch lifecycle and remote-executor seam | `src/launch/*`, `src/daemon.ts`, `src/db.ts` | `docs/plans/launch-lifecycle-kernel.md` |
| Web UI data flow | `src/web/*` + `web/DESIGN.md` | `web/DESIGN.md` itself is current; load it directly when the question is UI-design |
| Local web session identity | `src/daemon.ts`, `web/src/data/daemon.ts`, plus `glossary.md` | `docs/plans/web-local-session-store.md` |
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

## See also

- `glossary.md` — current code locations for every concept these plans
  describe. **Almost always start here instead.**
- `.serena/memories/*.md` — narrative architecture summaries derived from
  the plans above. Lighter-weight than the plans themselves; load specific
  entries on demand.
