# Storybook UI workflow for agents

Storybook is the **component glossary and isolated-development surface** for the
web UI (`web/`). Use it so you reuse existing Synchronize components and patterns
instead of inventing new props, variants, or local themes.

It does **not** replace the live `/web` app or the Bun integration tests. Storybook
verifies *component states in isolation*; daemon behavior, SSE, route precedence,
`DaemonDataSource` mapping, and archive/resume stay in the Bun tests and live
`/web` smoke checks.

## Running it

```bash
cd web && bun run storybook        # dev server + MCP on http://localhost:6006
cd web && bun run storybook:build  # static build (CI / verification)
```

The catalog, conventions, and DataSource/provider contract are documented inside
Storybook under **Overview → Introduction** and **Overview → Authoring Stories**.

## MCP (preview)

While `bun run storybook` is running, an MCP server is exposed at
`http://localhost:6006/mcp` (`@storybook/addon-mcp`). Available tools:

- **docs** — `list-all-documentation`, `get-documentation`,
  `get-documentation-for-story`: list every documented component and fetch its
  usage/props. Query these **before** editing or creating a component so you use
  the real prop contract instead of guessing.
- **dev** — `get-storybook-story-instructions` (call **before** writing a story —
  it is the source of truth for framework imports and story/test patterns),
  `preview-stories` (call **after** changing a component or story; include every
  returned preview URL in your response so the human can open it).
- **test** — `run-story-tests`: **not available yet.** It activates once the
  Storybook test runner lands (`sync-i24s.3`). Until then, verify interactively
  in the dev server and rely on `bun run typecheck` + `bun run storybook:build`.

Register the server (project scope) for this repo. Either run:

```bash
npx mcp-add --type http --url "http://localhost:6006/mcp" --scope project
```

or add to the project's `.mcp.json`:

```json
{
  "mcpServers": {
    "storybook": { "type": "http", "url": "http://localhost:6006/mcp" }
  }
}
```

The server only responds while `storybook dev` is running — it is a dev-time
convenience, not a daemon. The workflow below stays useful through Storybook Docs
and the CLI even if the preview-stage MCP is unavailable.

## The UI-work loop

1. **Understand** — query the glossary (`list-all-documentation` /
   `get-documentation`, or browse Storybook Docs) before touching a component.
2. **Build** — production React components live in `web/src/components/`. Edit
   those; never fork a Storybook-only variant.
3. **Capture state** — add/extend a `*.stories.tsx` for the new or changed state,
   following **Authoring Stories** (real component import, `seed.ts`/`MockDataSource`
   data, the global provider decorator, product-vocabulary `title`). Call
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
