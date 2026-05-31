# Global Skill Picker For Web Messages

Status: implementation plan (2026-05-31)
Owner: abhirup

This plan supersedes the older draft at
`/Users/abhirupdas/Codes/Personal/synchronize-worktrees/feat-web-chat-ui/docs/plans/skill-picker.md`.
The old draft was target-specific (`@Alice::`) and stored per-peer command
snapshots. The current requirement is intentionally simpler: the web composer has
one global skill picker, the daemon owns the available skill catalog, and selected
skills become a delivery-time directive only for agents explicitly mentioned in
the message.

## Goal

Let the web UI sender pick one or more skills before sending a group message.
The selected skills are not part of the canonical message prose. They are stored
as structured event metadata and rendered as a strong prefix only for mentioned
agents that receive a push/inbox event.

The directive should read like:

```text
You must use the following skills for this message: diagnose, code-review.

<original message body>
```

The prefix is sent only to peers in `mentions_json`. Other group members still
get the ordinary inbox event, and thread/root-author push recipients that are not
mentioned do not get the skill directive.

## Product Behavior

### Composer

- Add a `/` toolbar button above the composer textarea.
- Clicking `/` opens a skill picker.
- Typing `/` manually in the composer also opens the same picker.
- The picker is global, not scoped to a mentioned peer.
- The picker can filter by runtime: all, Claude-only, Pi-only.
- The picker supports fuzzy search as the user types.
- Selected skills show as removable chips in the composer.
- Sending clears the selected skills.

### Skill Catalog

- The daemon loads the skill catalog at startup.
- Restarting the daemon refreshes the catalog after skills are added/removed.
- The catalog includes at least Claude and Pi skills.
- Each item has:

```ts
type SkillCatalogEntry = {
  id: string;                 // stable key, e.g. "claude:diagnose"
  name: string;               // visible skill name
  description: string;
  runtimes: Array<"claude" | "pi">;
  source_path?: string;       // debugging only
};
```

The daemon keeps this catalog in memory and exposes it through `/web/state` so
the web UI can render picker options without additional round trips.

### Delivery Rule

Group messages accept optional `skill_directives: string[]` from web/API callers.
The daemon stores the array on the event, but the canonical `events.body` remains
the human-written message.

When a recipient reads or receives the event:

- If recipient peer id is in `mentions_json`, return/deliver `body` prefixed with
  the skill directive.
- If recipient is not in `mentions_json`, return/deliver the unmodified body.
- If `skill_directives` is empty or absent, behavior is unchanged.

This recipient-aware formatting applies to:

- Push callbacks (`notifySubscribers`) for Claude/Pi live delivery.
- Polling event reads (`GET /events/:peer_id`) for Codex/Pi fallback delivery.
- Durable inbox reads (`GET /peers/:peer_id/inbox`).

It should not apply to:

- `/web/state`, group history, thread history, SQL query surfaces, or canonical
  event storage.
- Non-mentioned recipients who are notified by thread-poster rules.

## Backend Design

### Schema

Add nullable `events.skill_directives_json`.

The value is a JSON array of selected skill names. Keep it denormalized on the
event row because it is message-scoped, not peer-scoped.

### Daemon Catalog

Add a small discovery module used by daemon startup:

- Claude:
  - `~/.claude/skills/*/SKILL.md`
  - `~/.claude/commands/*.md`
  - `<repo>/.claude/skills/*/SKILL.md`
  - `<repo>/.claude/commands/*.md`
  - installed Claude plugin skill directories when discoverable
- Pi:
  - `~/.pi/agent/skills/*/SKILL.md`
  - `~/.pi/agent/npm/node_modules/*/skills/*/SKILL.md`
  - common skillshare/agent skill dirs when present

Discovery is best-effort and file-system-only for v0. No headless LLM
introspection is used by default.

### API

- Extend `POST /groups/:name/messages`:
  - accept optional `skill_directives: string[]`
  - validate names as short non-empty strings
  - persist `skill_directives_json`
  - return canonical event with `skill_directives_json`
- Extend `Event` API types with `skill_directives_json`.
- Include `skill_catalog` in `/web/state`.

## Frontend Design

### Data Source

- Add `SkillCatalogEntry` and `skillCatalog(): Snapshot<SkillCatalogEntry[]>` to
  the web DataSource contract.
- `DaemonDataSource` maps `/web/state.skill_catalog`.
- `MockDataSource` exposes a small fixed catalog for local UI tests.
- Extend `SendMessageInput` with `skillDirectives?: string[]`.

### Composer UI

- Add `/` button to `.composer-toolbar`.
- Add picker state to `Composer.tsx`:
  - open/closed
  - filter text
  - runtime filter
  - selected skill names
  - keyboard index
- Reuse the existing mention popup visual language where practical.
- Fuzzy matching is local and deterministic; a simple ordered-subsequence match is
  enough for v0.
- If no skills match, show an empty state inside the picker.

## Tests

### Backend

- API test: sending a group message with selected skills stores the canonical body
  unchanged and persists `skill_directives_json`.
- API test: mentioned recipient push/poll/inbox receives prefixed body; non-mentioned
  durable inbox recipient receives original body.
- Thread push test: a thread participant who is pushed but not mentioned does not
  receive the directive prefix.
- Catalog test: `/web/state` includes a `skill_catalog` array.

### Frontend

- DataSource test: `DaemonDataSource.sendMessage` forwards `skill_directives`.
- DataSource test: `DaemonDataSource` maps `skill_catalog` from `/web/state`.
- Typecheck/build catches picker integration.

## Out Of Scope

- Per-agent skill availability enforcement. The UI can filter by runtime, but it
  does not block sending a Claude skill directive to a Pi mention.
- Runtime headless skill introspection (`claude -p`, `pi -p`).
- Host-level slash commands such as `/clear` or `/config`.
- Authorization for who may direct whom.
- Modifying canonical history to include the prefix.

## Beads

Created from this plan:

- `sync-yamq` — epic: build global web skill picker and mentioned-recipient directives.
- `sync-tyne` — backend: daemon skill catalog and event directive storage.
- `sync-p40h` — backend: recipient-specific directive prefixing.
- `sync-wewu` — frontend data: skill catalog and directive send path.
- `sync-3dmv` — frontend UI: fuzzy global skill picker in Composer.
- `sync-7kof` — docs: plan and skill-index maintenance.
