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

## Wiring conventions (read before adding/changing a component or its states)

These exist because a story that mounts a component *differently* than the app
produces false positives (a "bug" that isn't real) and, worse, false negatives (a
real bug hidden behind a divergent mount). The rule is one shared mount + one
trait vocabulary, so "passes in Storybook" means "works in the app".

1. **Mount through the shared shell cells — never re-wire per story.** The app
   composes the shell from `web/src/shell-layout.tsx` (`AppShellGrid`,
   `ShellMainColumn`, `ShellMainBody`, `ShellChatColumn`). Shell-resident stories
   mount through the SAME cells via the composable decorators in
   `web/src/storybook/shellFrames.tsx` (`inChatSurface`, `inSidebarColumn`,
   `inRosterColumn`, `inMainColumn`, `inBottomNavRow`). Do **not** drop a
   shell-resident component into a bare `layout: fullscreen` canvas — that is what
   made Sidebar collapse into strips, BottomNav float at the top, and the chat
   surface keep its timeline rail in compact.

2. **Traits/capabilities, never mode/theme if-else in components.** Shell-mode
   behaviour reads the `shellLayout(mode)` capability contract (`shell-mode.tsx`);
   theme behaviour reads `themeTraits(theme)` (`hooks/usePersistentTheme.ts`).
   Never branch on `mode === "compact"` or `themeFamily(t) === "light"` inside a
   component — add/READ a named capability instead (`layout.timeline`,
   `themeTraits(t).toggleGlyph`). New behaviour that varies by mode/theme is a new
   field on the contract, defined once.

3. **Theme & skin are global toolbar traits — do NOT duplicate stories per theme.**
   They are carried on `<html data-theme>` / `<html data-skin>`, set identically by
   the app (`usePersistentTheme` effect) and Storybook (the preview decorator).
   Sweep palettes from the toolbar; the Vitest matrix snapshots across themes.
   Pin a theme on a single story only when the state is theme-specific
   (`globals: { theme: "kanagawa-wave" }`). **Kanagawa Wave is the canonical dark**
   (`DEFAULT_DARK_THEME`) — never hardcode `"dark"` as the dark default.

4. **Stories declare STATE (args), not mounting.** State variants (empty / error /
   long-title / with-reactions) are hand-authored `args` selecting REAL `seed.ts`
   data — not faked props, and not a parallel layout. If a state needs a fixture
   that does not exist, add it to the seed. (ThreadSummaryPanel "empty" silently
   stopped being empty when its room gained a thread; MessageRow reactions vanished
   only because the story under-passed the handlers the app always passes.)

5. **Light-mode surfaces stay warm.** Inverted/elevated surfaces (self bubble, code
   block, roster focus) use `--paper-3` cream + `--ink` text in light/brutal, never
   black; the secondary line on an inverted surface mirrors
   `.room-item.active .room-preview` (on-ink @ ~0.65). Light code blocks use the
   scoped light hljs palette in `styles/code-light.css`; dark themes keep
   github-dark.

6. **Conditional Tailwind variant overrides come AFTER the base variant class.**
   `cn()` is `twMerge(clsx(...))`, which keeps the LAST conflicting utility. Put
   `active && "bg-yellow ..."` after `variantClass`, or the variant wins and the
   state looks inert (the IconButton bug).

7. **Compact widths must not overflow.** Inline code wraps (`overflow-wrap`); block
   code scrolls. Verify shell-resident components at 390/412 through the compact
   shell mode the frame provides, not just a narrow bare canvas.

8. **Validate after every change.** `cd web && bun run test:storybook` runs every
   story (render + `play`) headlessly. It is only trustworthy *because* stories now
   mount like the app — keep it green, and never "fix" a story by diverging its
   mount from production.
