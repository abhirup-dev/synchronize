# ui-forensics.md

Use this for `web/` UI bugs: a component renders wrong, a visual/layout state
is broken, a story or `play` interaction test fails, or theme/skin/responsive
behavior is off. Storybook is the isolation + regression surface.

Heavy detail (integration map, MCP catalog, full recipe) lives in
`docs/debugging/storybook.md`. This file routes.

## Mental Model

```text
component render / single state ──> Storybook story  (MockDataSource, real browser)
interaction / multi-step flow   ──> Storybook play() + step()  (one mounted tree)
daemon / SSE / routing          ──> live /web smoke + bun integration tests
```

Storybook proves component states against mocked data; it is not the daemon/API
truth source. `bun test` and targeted live `/web` smoke checks own that.

## First Checks

1. Reproduce in the smallest story. If a bare component story shows it, the bug
   is in that component — not its parent.
2. Does a story exist for the failing **state**? If not, that gap is why it
   shipped. Create it (it becomes the regression guard).
3. `cd web && bun run test:storybook` — render + `play` + a11y, headless.
4. Locate fast via the Storybook MCP (`get-documentation`, `preview-stories`)
   while `bun run storybook` runs. See `docs/debugging/storybook.md`.

Do not edit production components to fit a story. Fix the real bug; match the
existing layout/precedent.

## Visual Audit Sweeps

For qualitative Storybook sweeps across many components, load
`storybook-visual-audit.md`. It contains the repeatable protocol for reading
story intent, judging final stable states, avoiding screenshot false positives,
and saving only confirmed failure screenshots.

Use this route when the task is not just "debug one UI bug", but "inspect all
Storybook components and collect visual failures".

## Decision Tree

```text
UI looks/behaves wrong
  |
  +-- render-only / static state? ----> story render test; read JSX + CSS together
  |
  +-- interaction / workflow? --------> play() + step(); use `screen` for portals
  |
  +-- multi-component journey? -------> Flows.stories.tsx (mounts real Shell)
  |
  +-- needs real daemon/SSE/routing? -> NOT Storybook -> live /web + bun tests
```

## See Also

- `docs/debugging/storybook.md` — integration map, MCP catalog, full debug recipe, traps.
- `docs/agents/storybook-ui.md` — building UI / authoring stories.
- `glossary.md` — Storybook source map and code locations.
