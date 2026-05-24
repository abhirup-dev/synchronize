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

### Design docs

| File | Lines | Topic |
|---|---|---|
| `web/DESIGN.md` | 427 | Web UI design — DataSource interface, ChatView/MessageRow/Sidebar component layout, theme tokens. |
| `docs/group-sync-integrity.md` | 455 | End-to-end group registration and sync integrity walkthrough. Long but authoritative on subtle group-membership invariants. |
| `docs/integration-tmux.md` | 216 | AoE/tmux integration harness — how Pi agents under tmux are exercised in integration tests. |

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
| Web UI data flow | `src/web/*` + `web/DESIGN.md` | `web/DESIGN.md` itself is current; load it directly when the question is UI-design |
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
