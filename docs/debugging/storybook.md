# Storybook / UI Component Debugging

Durable reference for diagnosing `web/` UI issues with Storybook and its MCP.
Too detailed for the skill — the skill (`ui-forensics.md`) routes here.

For **building** UI with Storybook (authoring conventions, the work loop), see
`docs/agents/storybook-ui.md`. This file is the **diagnosis + capability** home.

## Integration map (how the codebase is wired)

Storybook is a dev-only layer over the existing `web/` React source. It does
not replace the production build and forks no components.

| Piece | Location | Notes |
|---|---|---|
| Storybook config | `web/.storybook/main.ts` | `@storybook/react-vite` + `@tailwindcss/vite`; addons: docs, mcp, vitest, a11y; telemetry off |
| Preview / decorators | `web/.storybook/preview.tsx` | full production CSS stack; theme/skin toolbar globals → `documentElement.dataset.theme/.skin`; viewport presets (390/412/768/1024/1440); wraps every story in `StorybookProviders` |
| Fonts | `web/.storybook/preview-head.html` | same Google Fonts as `web/index.html` |
| Provider decorator | `web/src/storybook/StorybookProviders.tsx` | App.tsx stack (DataSource → ContextMenu → Toast → ArchiveRecovery) with a **fresh `MockDataSource` per mount** |
| Story data | `web/src/data/seed.ts`, `web/src/data/mock.ts` | `MockDataSource implements DataSource` — same contract as the live `DaemonDataSource`; stories never import the daemon source |
| Stories | `web/src/components/*.stories.tsx` | one per component, by product family |
| Glossary docs | `web/src/storybook/*.mdx` | `Overview/Introduction`, `Overview/Authoring Stories`; global autodocs gives every component a props page |
| Cross-component flow sample | `web/src/components/Flows.stories.tsx` | mounts the **real exported `Shell`** (`web/src/App.tsx`) and drives activity → thread → scroll via `play` + `step()` |
| Test runner | `web/vitest.config.ts` | Vitest browser mode, Playwright Chromium |
| Scripts | `web/package.json` | `storybook`, `storybook:build`, `test:storybook`, `test:storybook:headed`, `test:storybook:ui` |

Invariant: the production `/web` bundle stays on Bun (`web/build.ts` +
`bun-plugin-tailwind`). Storybook's Vite pipeline is dev-only; the production
bundle hash is unaffected by anything here.

## The three verification layers

```text
component render / single state ──> Storybook story (MockDataSource, real browser)
interaction / multi-step flow   ──> Storybook play() + step()  (one mounted tree only)
daemon / SSE / routing / E2E    ──> live /web + Bun tests + the UI probe pipeline (sync-rycd)
```

Storybook proves component states and composed-tree workflows against mocked
data. It is NOT the daemon/API truth source — that stays in `bun test`. Full
real-daemon E2E belongs to sync-rycd, not here.

## MCP capability catalog (canonical)

`@storybook/addon-mcp` exposes `http://localhost:6006/mcp` **only while
`cd web && bun run storybook` is running** (it is not a daemon). Register it
project-scoped via `.mcp.json` or `npx mcp-add --type http --url
"http://localhost:6006/mcp" --scope project`. If unregistered, drive it over
JSON-RPC: `initialize` → `notifications/initialized` → `tools/call` (carry the
`mcp-session-id` response header; `Accept: application/json, text/event-stream`).

| Toolset | Tool | Use it to |
|---|---|---|
| docs | `list-all-documentation` (`withStoryIds`) | list every documented component + story IDs, no grep |
| docs | `get-documentation` (`id`) | fetch one component's props/usage + its story IDs |
| docs | `get-documentation-for-story` (`componentId`, `storyName`) | fetch a single story's doc |
| dev | `get-storybook-story-instructions` | framework-specific story/test patterns — call **before** writing a story |
| dev | `preview-stories` (`storyId` or path; `props`, `globals`) | render a story → returns a **URL, not an image** |
| test | `run-story-tests` (`stories?`, `a11y`) | run render + `play` + a11y for stories (or all); the verification surface |

Boundaries: the MCP **locates and verifies** (find the component, render a
state, run tests) — it does **not** root-cause. There is **no screenshot tool**:
take the `preview-stories` URL and drive a browser to it for pixels. `a11y` in
`run-story-tests` surfaces real WCAG violations as a side effect — log them,
don't scope-creep.

## The debug loop

```text
1. reproduce in isolation     find/create the smallest story for the failing STATE
2. locate (MCP/docs)          get-documentation → component, story IDs, preview URL
3. read JSX + CSS together    UI bugs are usually a render-condition ↔ CSS-rule mismatch
4. fix to match intent        follow the existing precedent, don't invent layout
5. regression story           add the missing-state story + a play assertion
6. verify x3                  run-story-tests (DOM) + screenshot (pixels) + full suite (no regressions)
7. log adjacent finds         a11y/other violations the tools surfaced
```

The most durable output is step 5: the new story that makes the bug
uncatchable next time. A bug that shipped usually means **no story exercised
that state** — close that gap, not just the symptom.

## Common traps

| Trap | Reality |
|---|---|
| Portal content (dialog, menu, toast, thread) not found | query with `screen`, not `canvas` — it renders outside the story root |
| State leaks between stories | `MockDataSource` is stateful (localStorage + mutable snapshots); the decorator mounts a fresh one per story |
| Theme/skin toolbar doesn't drive a story | `Shell` self-manages `data-theme`/`data-skin`, overriding the toolbar in the `Flows` story |
| Bug shows in `ChatView` but not `MessageRow` | the failing state had no isolated story; add one |
| "It compiled, so it's fine" | `storybook:build` does not execute every render; use `test:storybook` for the render gate |
| Short content "won't scroll" | assert at-bottom as `scrollHeight - clientHeight - scrollTop <= n`, not `scrollTop > 0` |

## See also

- `docs/agents/storybook-ui.md` — building UI / the authoring work loop.
- `docs/plans/storybook-integration.md` — design rationale + as-built decisions.
- `.claude/skills/synchronize-debugging/glossary.md` — code map.
