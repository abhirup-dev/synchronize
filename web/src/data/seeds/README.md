# Seed versions

`../seed.ts` is the **stable seed** — the canonical demo world every Storybook
story renders by default. It is never edited as part of a design iteration.

This folder holds **design-iteration seeds**: parallel demo worlds used while
actively revamping the UI against a design bundle. Naming convention (names
must say what they're for — no codenames):

    design-<bundle-or-skin-name>.ts     e.g. design-sigil-r4.ts

Rules:

- Same export names as `../seed.ts` (AGENTS, GROUPS, DMS, MESSAGES,
  THREAD_REPLIES, TASKS, THREAD_SUMMARIES, ARTIFACTS). Start by
  re-exporting the stable seed and overriding only what the design needs.
- Export for a design bundle with:
  `bun scripts/export-fixtures.mjs --seed design-<name>` → `ds-bundle/fixtures.{json,js}`
  (no flag = stable seed).
- When a design ships, fold its content additions back into `../seed.ts` and
  delete the iteration seed. Seeds here are working state, not a museum.
- Storybook renders the stable seed only, for now. A `dataset` toolbar global
  (switching MockDataSource's seed) gets wired the first time an iteration
  seed needs story-level review — not before, to keep the stable setup
  untouched.
