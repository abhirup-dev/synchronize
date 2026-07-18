# Parity-ready template — conventions

**Why this exists:** your template gets compared, screenshot-to-screenshot,
against the real app implementation by an automated parity harness. The
comparison is only honest if both sides show the SAME WORLD (same agents,
rooms, message text) and the harness can reach and crop each view. These
conventions guarantee that. They constrain content and reachability only —
layout, composition, and visual exploration remain yours, exercised within the
project's design language and directives (fonts, tokens, styling rules — see
the other docs in `guidelines/`), which these conventions add to rather than
replace.

## 1. Data — render the provided world

`fixtures/` at the project root (read-only, synced from the app repo):

- `fixtures/base.js` → `window.FIXTURES_BASE` — the app's demo world
- `fixtures/merge.js` → builds `window.FIXTURES` = base + your overlay

Load them in your template page, then render **from `window.FIXTURES`**:

```html
<script src="../../fixtures/base.js"></script>
<script src="fixtures.active.js"></script><!-- yours, optional — see §2 -->
<script src="../../fixtures/merge.js"></script>
```

### The one rule that matters

**Every piece of content on screen — names, message text, counts, previews,
board cards, artifacts — must exist in `window.FIXTURES`, character-for-
character.** Paraphrasing a message, renaming an agent, or hardcoding a
board card inline in the HTML all count as inventing the world, and each one
becomes a false "bug" in the parity report.

- Subsetting is fine (show fewer rooms/messages).
- Restyling is fine — new layouts and presentation of the same content, within
  the project's design directives.

### Two modes — declare which one your template uses

- **`extend` (default):** you render the base world; your overlay holds only
  genuine additions/changes. Base records must actually render — don't copy
  base content under new ids or filter the render to overlay-only records.
- **`own-world`:** your demo depicts its own curated world. Keep it — but
  declare ALL of it as fixture-schema data in your overlay (it may replace
  base wholesale). The implementation will adopt your world as a seed and
  render the very same data on its side — that adoption is mechanical only if
  your overlay uses the fixture schema, which is why the schema discipline
  below is non-negotiable.

Declare the mode in your overlay: `window.FIXTURES_ACTIVE = { meta: { mode:
"own-world" }, … }`. In both modes the rule above holds: every on-screen
string comes from `window.FIXTURES`, verbatim — never inline in the HTML.

### Your data has a different shape than mine? Write an adapter.

The fixtures use the app's domain schema (below). If your template's render
code wants its own view-model shape, the blessed pattern is a small **adapter
in your template code** that maps fixture records → your view models at load
time. Adapt the shape; never fork the content:

```js
// adapter: fixture schema -> your view model. Text/values pass through verbatim.
const msgs = window.FIXTURES.MESSAGES[roomId].map((m) => ({
  who: m.authorId, at: m.createdAt, text: m.body, replies: m.threadReplyCount,
}));
```

Schema reference (collections in `window.FIXTURES`):

| Collection | Shape |
|---|---|
| `AGENTS` | `{id, name, handle, color, role, status, statusNote, runtimeDetails, …}` |
| `GROUPS` / `DMS` | rooms: `{id, kind, name, emoji, members, lastPreview, unread, pinned, …}` |
| `MESSAGES` | by room id: `{id, roomId, authorId, createdAt, body, mentions, reactions, attachments, threadReplyCount, …}` |
| `THREAD_REPLIES` | by room id: `{id, roomId, authorId, createdAt, parentId, body, …}` |
| `TASKS` | by room id: `{id, title, status, assigneeId, priority, progress, …}` |
| `ARTIFACTS` | by room id: `{id, kind, title, byAgentId, createdAt}` |
| `THREAD_SUMMARIES` | by room id: markdown string |

(Open `fixtures/base.js` for the full self-describing shapes.)

## 2. Need content that doesn't exist? Overlay it.

Create `fixtures.active.js` **in your template folder** (your writable
surface) with a PARTIAL overlay — only genuine additions or changes:

```js
window.FIXTURES_ACTIVE = {
  MESSAGES: { "checkout-revamp": [
    { id: "poll-1", roomId: "checkout-revamp", authorId: "vega",
      createdAt: "2026-01-01T11:40:00.000Z", body: "…", mentions: [], reactions: [] },
  ]},
};
```

- Use the **fixture schema** (§1 table), not your view-model shape — the
  overlay is data, your adapter will map it like everything else.
- To MODIFY a base record, reuse its exact `id` (merge upserts by id) and
  change only the fields you need. New records get new ids.
- If a whole collection you need is missing/empty in base, your overlay may
  define it — same schema discipline.

## 3. Views — reachable by URL

Honor query/hash params on load: `view=` (one value per major view, e.g.
`chat | activity | board | agents`), `mode=dark|light`, and `embed=1` (hides
any review chrome you add — tweak panels, pills). Sub-states (thread open,
menu open) should be reachable by clicking stable data-attributed controls,
e.g. `[data-thread="open"]`.

## 4. Containers — labeled

Tag the root element of **every** major view/panel with a stable
`data-screen-label` — including persistent chrome like the sidebar:
`chat | activity | thread | sidebar | board | artifacts | agents | …`
(reuse your `view=` vocabulary where it coincides). These are the harness's
screenshot selectors.

## Self-check before you call it done

1. `extend` mode: fresh load with your overlay's `<script>` tag commented out
   → the page still renders the base world; if it goes empty, base isn't
   actually rendering. `own-world` mode: remove one message from your overlay
   → it disappears from the page; if it doesn't, that content is inline, not
   data.
2. Pick 3 random visible messages / room names → find each, verbatim, in
   `fixtures/base.js` or your `fixtures.active.js`.
3. `?view=…&mode=light&embed=1` (and each other view) work from a cold load.
4. Every major panel, sidebar included, has a `data-screen-label`.
5. `window.FIXTURES.meta.hash` is defined in the console.

Pass all five and the parity harness can consume your template with zero
extra wiring.
