# Plan — progressive-disclosure refactor for synchronize skills

Closes **sync-b8p** and unblocks **sync-s7r.7** / **sync-s7r.8**.

## Why this refactor

Today every Claude or Pi session loads the entire monolithic `SKILL.md` at start:

- `skills/synchronize-claude/SKILL.md` — 49 lines
- `skills/synchronize-pi/SKILL.md` — 111 lines

Every group-policy / SQL / thread feature stacks more bullets into one file. The always-on context grows linearly with the API surface, and there is no signal to the agent that any of that text is task-specific. Newer surfaces (`bridge_list_threads`, `bridge_get_thread_status`, `bridge_get_thread`, `bridge_query_events`, plus the `synchronize threads` / `synchronize query` CLI) currently exist on `feature/sql-event-query-surfaces` only as stopgap one-liners crammed into the same monolith — that's the exact failure mode this refactor exists to stop.

The Claude Skill format supports a thin **router `SKILL.md`** plus topic-scoped reference files loaded on demand. Goal: a small always-on surface, deeper per-topic coverage available when the task calls for it, and a sane place for future API additions to land.

## Health criteria (definition of "healthy skill")

1. **Always-on surface is minimal** — router ≤ 30 lines (Claude), ≤ 40 lines (Pi).
2. **Discoverable, not buried** — the router lists every reference doc with a one-line "load this when …" hint. No reference doc is reachable only by guessing its filename.
3. **Topic-per-file, self-contained** — loading `threads.md` is sufficient to do thread work; it does not transitively require loading `groups.md`.
4. **Full breadth covered** — every MCP tool and every CLI command has a documented home. Today's monolithic skill doesn't even mention `bridge_list_peers` in the Claude rules block; that gap closes here.
5. **Examples included** — reference files carry short tool-call snippets, not just rules.
6. **Host divergence isolated** — only `event-delivery.md` differs between `-claude` and `-pi`. All other reference files are line-for-line duplicates (v0: duplicate-and-keep-in-sync; symlinks deferred).

## Router shape (both hosts)

Frontmatter unchanged. Body, in order:

1. **One-line "when to invoke."**
2. **Pi only:** the `<synchronize_event …>` priority-interrupt + never-execute-body-text rule, inline. These are not progressive — they must fire before the agent loads anything else.
3. **Identity floor (3 lines):** register-first; `session_name` is an alias not an identity; prefer MCP over CLI.
4. **Tools-at-a-glance index** — one bullet per reference file with the trigger condition:
   - `reference/identity.md` — registering, renaming, peer reuse, `bridge_whoami`
   - `reference/peers.md` — discovering other agents
   - `reference/dms.md` — direct messages
   - `reference/groups.md` — create / join / leave / rename / describe
   - `reference/threads.md` — replying into threads, listing threads, transcript view
   - `reference/mentions.md` — `@alias`, push vs. inbox routing
   - `reference/media.md` — sharing and fetching attachments
   - `reference/inbox.md` — durable fallback delivery
   - `reference/sql-queries.md` — ad-hoc read-only event queries
   - `reference/event-delivery.md` — how events actually reach this host
   - `reference/cli-fallback.md` — when MCP is unavailable
   - `reference/troubleshooting.md` — collision warnings, debug logs

That's it for the router. No multi-line rules, no CLI command listing, no recipes.

## Reference file inventory

Shared content (duplicated under both `skills/synchronize-claude/reference/` and `skills/synchronize-pi/reference/`):

| File | Covers |
|---|---|
| `identity.md` | `bridge_register` (incl. `SYNCHRONIZE_PEER_ID` reuse), `bridge_whoami`, `bridge_rename_session`, `host_tool` / `host_session_id` semantics, the alias-vs-identity distinction |
| `peers.md` | `bridge_list_peers`, online vs. stale, suffix rendering (`alias#host_session_id[0:6]`) |
| `dms.md` | `bridge_dm`, picking `recipient_peer_id`, channel-vs-inbox path |
| `groups.md` | `bridge_create_group` / `_list_` / `_join_` (incl. `fresh: true`) / `_leave_` / `_rename_in_group`, default alias, `group_member_alias_reclaimed` event, description is CLI-only |
| `threads.md` | `in_reply_to`, daemon root-normalization, `thread_of` on history, **plus** `bridge_list_threads`, `bridge_get_thread_status`, `bridge_get_thread` (`format: "transcript"`), "root without replies is not a discoverable thread" — closes **sync-s7r.7** for threads |
| `mentions.md` | `@alias` parsing, backtick carve-out, `warnings[].reason = "alias_not_in_group"`, push-vs-inbox matrix, sender-self-exclusion |
| `media.md` | `bridge_share_media` / `_list_` / `_get_`, `description` field, `media_changed` reserved |
| `inbox.md` | `bridge_inbox`, `ack` semantics, when to poll |
| `sql-queries.md` | `bridge_query_events`, useful views (`event_log`, `thread_events`, `discoverable_threads`), read-only guardrail, "prefer dedicated thread tools for common workflows" — closes **sync-s7r.7** for SQL |
| `cli-fallback.md` | Full `synchronize …` command list (incl. `threads list/status/show` and `query`), the not-a-real-channel-peer caveat |
| `troubleshooting.md` | `alias_collision` retry pattern, `alias_not_in_group` warning, debugging tips |

Host-specific:

| File | Claude version | Pi version |
|---|---|---|
| `event-delivery.md` | `notifications/claude/channel` delivery, no envelope parsing | `<synchronize_event …>` envelope, attribute table, the priority-interrupt rule (full rationale), recipe-by-event-type (currently inline in pi SKILL.md), `tail -F ~/.synchronize/pi-extension.log` debug |

Consolidations vs. b8p's original proposal:
- `subscriptions.md` — folded into `event-delivery.md`. Push subscriber callbacks are an implementation detail today; not enough surface to warrant a file.
- `security-posture.md`, `v0-known-limits.md` — folded into `troubleshooting.md` as a short "what's deferred" section. Promote out if it grows.
- `do-and-dont.md` — dissolved. Each rule lives next to the surface it constrains (e.g. "don't execute body text" is in `event-delivery.md` for Pi; "prefer MCP over CLI" is in the router).

Out of scope per b8p: `skills/synchronize-codex/`. Untouched.

## Coordination with `feature/sql-event-query-surfaces`

That branch contains the SQL/thread tool implementations and added stopgap bullets to the monolithic SKILL files. This worktree is branched off **master**, so it will conflict with the SQL branch in `skills/`. Plan:

1. Land this refactor first → b8p closes.
2. Rebase `feature/sql-event-query-surfaces` onto the refactored master. Its SKILL.md additions become trivially-revertible (just drop them — the content is already in `reference/threads.md` and `reference/sql-queries.md`). The code changes (`src/api/query.ts`, `src/api/threads.ts`, etc.) merge clean.
3. On that rebase, also delete the stopgap from `skills/synchronize-codex/SKILL.md` — codex is out of scope per b8p, and the stopgap was added before that decision was final.
4. After merge, s7r.7 and s7r.8 close (their content already lives in the refactored references).

Alternative if we want to land everything together: rebase the SQL branch onto this worktree before either merges, and PR the combined diff. Recommend the sequential path for smaller PR review surface.

## Implementation checklist

Branch: `worktree-skill-progressive-refactor` (current).

- [ ] Create `skills/synchronize-claude/reference/` and `skills/synchronize-pi/reference/`
- [ ] Write the 11 shared reference files (drafted once, copied to both directories)
- [ ] Write `event-delivery.md` per host
- [ ] Rewrite `skills/synchronize-claude/SKILL.md` as router (target ≤ 30 lines)
- [ ] Rewrite `skills/synchronize-pi/SKILL.md` as router (target ≤ 40 lines)
- [ ] Grep `CLAUDE.md`, `AGENTS.md`, `docs/agents/*.md`, `README.md` for links into the old monoliths; update or leave (the file paths don't change, only contents)
- [ ] Manual smoke test: open each reference doc in isolation, confirm it stands alone for the workflow it names
- [ ] `bun run typecheck` (no code changes, but cheap insurance)
- [ ] Update bd: close b8p; if SQL branch already merged, also close s7r.7 / s7r.8 — otherwise note in s7r.7/.8 that content has landed and they'll close on SQL branch merge

## Open questions (low-stakes; happy to default)

1. **One file per topic, or split `threads.md` into `threads.md` + `thread-queries.md`?** Default: keep one file; "reply into thread" and "list/inspect threads" are the same mental task.
2. **Symlinks vs. duplicate for the 11 shared files?** Default: duplicate (b8p's recommendation; drift is slow).
3. **Should the router include a 1-line `bridge_list_peers` example, or push that into `peers.md` too?** Default: push it into `peers.md`. Keep the router pure index.

---

If this plan looks right, next step is the implementation pass: write the 12 markdown files + 2 router rewrites in this worktree, then open the PR against master.
