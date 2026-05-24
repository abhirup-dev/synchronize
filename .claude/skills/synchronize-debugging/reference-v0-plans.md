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
