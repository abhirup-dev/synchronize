# Storybook UI workflow for agents

Storybook is the **component glossary and isolated-development surface** for the
web UI (`web/`). Use it so you reuse existing Synchronize components and patterns
instead of inventing new props, variants, or local themes.

It does **not** replace the live `/web` app or the Bun integration tests. Storybook
verifies component states and composed UI flows; daemon behavior, SSE, route
precedence, `DaemonDataSource` mapping, and archive/resume stay in the Bun tests
and live `/web` smoke checks.

## Running it

```bash
cd web && bun run storybook        # dev server + MCP on http://localhost:6006
cd web && bun run storybook:build  # static build (CI / verification)
```

The catalog, conventions, and DataSource/provider contract are documented inside
Storybook under **Overview → Introduction** and **Overview → Authoring Stories**.

## Test split

Each layer owns a distinct slice of verification — don't duplicate daemon truth
into Storybook:

| Command | Covers |
| --- | --- |
| `bun test` (repo root) | daemon, CLI, data adapter, `/web/state` + `/web/events`, route precedence, `DaemonDataSource` mapping, archive/resume, attachment staging — the API/daemon truth source |
| `cd web && bun run typecheck` | web type safety (incl. story/fixture prop shapes) |
| `cd web && bun run storybook:build` | stories/docs compile |
| `cd web && bun run test:storybook` | every story renders headlessly (Playwright Chromium) + `play` interaction tests; failures point to the story |

Accessibility checks (`@storybook/addon-a11y`) run alongside the story tests and
surface violations in the Storybook **Accessibility** panel; they are
non-blocking by default.

## MCP (preview)

While `bun run storybook` is running, `@storybook/addon-mcp` exposes an MCP
server at `http://localhost:6006/mcp` (dev-time only; not a daemon). For the
authoring loop, the tools you'll use are: **docs** (`list-all-documentation`,
`get-documentation`) to check the real prop contract **before** editing a
component; **dev** (`get-storybook-story-instructions` before writing a story,
`preview-stories` after — share the returned URLs); **test** (`run-story-tests`
after changes).

The **canonical MCP capability catalog** (all six tools, registration via
`.mcp.json` / `mcp-add`, the JSON-RPC fallback, and what the MCP does/doesn't
do) lives in `docs/debugging/storybook.md`. The loop below stays useful through
Storybook Docs and `test:storybook` even if the preview-stage MCP is down.

## The UI-work loop

1. **Understand** — query the glossary (`list-all-documentation` /
   `get-documentation`, or browse Storybook Docs) before touching a component.
2. **Build** — production React components live in `web/src/components/`. Edit
   those; never fork a Storybook-only variant.
3. **Capture state** — add/extend a `*.stories.tsx` for the new or changed state,
   following **Authoring Stories** (real component import, `seed.ts`/`MockDataSource`
   data, the global provider decorator, product-vocabulary `title`). Put composed
   shell journeys under `web/src/flows/*.stories.tsx`. Call
   `get-storybook-story-instructions` first.
4. **Behavior** — for interactive changes, add a `play` test
   (`import { within, userEvent, expect } from "storybook/test"`).
5. **Preview** — `preview-stories` and share the URLs.
6. **Verify integration** — when daemon state, SSE, API mapping, or route behavior
   is involved, verify against the live `/web` app and the Bun tests. Storybook
   alone does not prove daemon integration.

## Claude Design handoff

Claude Design explores product intent and layout variants → the accepted design
becomes production components in `web/src` → Storybook stories preserve the
accepted states → `play` tests capture interactive expectations → live `/web`
checks prove daemon integration. Every meaningful UI feature ships with at least
one story; every interactive UI feature ships with at least one `play` test (or an
explicit note that it is covered by a Bun/integration test instead).
