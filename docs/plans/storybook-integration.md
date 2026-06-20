# Storybook Integration For Web UI

Status: IMPLEMENTED (2026-06-20). Epic sync-i24s closed; 5/6 children done, the
Android packaging smoke moved to the Android epic (sync-imeu). The sections below
from "## Goal" onward are the original design rationale; the section immediately
following captures what was actually built and the decisions taken on top of it.
Owner: abhirup

## Implementation Outcome & Decisions (2026-06-20)

Delivered on branch `codex/storybook-integration-plan`. This section is the
as-built record and supersedes the original phase plan where they differ.

### What shipped

- **Foundation (sync-4cnw).** `@storybook/react-vite` on its own Vite pipeline;
  production `/web` Bun build untouched (verified: identical bundle hash before/
  after). `web/src/storybook/StorybookProviders.tsx` wraps every story in the
  App.tsx provider stack (DataSource → ContextMenu → Toast → ArchiveRecovery)
  with a **fresh `MockDataSource` per mount**. Full production CSS stack imported
  in `preview.tsx`.
- **Glossary (sync-s7a2).** 87 stories across 20 components, organized by product
  family. `@storybook/addon-docs` with **global autodocs** (every component gets
  a props/preview Docs page). MDX overview pages: `Overview/Introduction` and
  `Overview/Authoring Stories` (DataSource contract, provider rules, conventions).
  Web fonts loaded via `.storybook/preview-head.html` for type fidelity.
- **Theme/skin + responsive matrix (sync-i24s.4).** Toolbar globals for Theme
  (light, rose-pine-dawn, dark, kanagawa-wave, catppuccin-mocha) and Skin
  (brutal, glass), mapped onto `documentElement.dataset.theme/.skin`. Viewport
  presets incl. Android-class 390/412. `Layouts/Chat Surface` stories verified
  no horizontal overflow at mobile widths.
- **Test runner (sync-i24s.3).** `@storybook/addon-vitest` (Vitest browser mode,
  Playwright Chromium) + `@storybook/addon-a11y`. Scripts: `test:storybook`
  (headless/CI), `test:storybook:headed` (visible browser, watch), and
  `test:storybook:ui` (`@vitest/ui` live dashboard). 94 tests passing. Play tests
  on Composer, MessageRow (reaction picker), Toast, ScrollControls.
- **MCP + agent workflow (sync-i24s.1).** `@storybook/addon-mcp` (preview) exposes
  `/mcp` on :6006; verified end-to-end — `tools/list` returns docs + dev + test
  toolsets incl. `run-story-tests`, and `list-all-documentation` returns the full
  glossary. Agent loop documented in `docs/agents/storybook-ui.md` (CLAUDE.md
  points to it).
- **Cross-component flow suite.** `Flows/Synchronize UI` mounts the real app
  `Shell` and drives multi-component journeys such as Activity → thread →
  scroll, chat thread traversal, and spawn-agent entrypoint discovery via
  `play` functions with `step()` phases.
- **Install hardening (repo hygiene).** `make check-install` + guarded `make test`
  + `bun install --frozen-lockfile` in `make setup`; worktrunk `.config/wt.toml`
  `post-create = "make setup"` so new worktrees self-provision. Fixes the cryptic
  "daemon did not become healthy" failure caused by a worktree missing root deps.

### Decisions taken on top of the original plan

- **Tailwind-via-Vite is mandatory, not a fallback.** `tw.css` (Tailwind v4
  `@import "tailwindcss/..."`) does not compile through Storybook's Vite without
  `@tailwindcss/vite`, so it is wired from the start. Bun's `bun-plugin-tailwind`
  still owns the production path.
- **No `fixtures.ts` extraction.** Phase 2 proposed shared fixture builders;
  stories already reuse `seed.ts`/`MockDataSource` with no duplication, so there
  was nothing to extract. Skipped to avoid churn.
- **One production change: `export function Shell()`** in `App.tsx`, so the flow
  sample can mount the real shell. Caveat: `Shell` self-manages `data-theme`/
  `data-skin`, so it overrides the Theme/Skin toolbar in that one story.
- **Visual tooling = test widget + `@vitest/ui`, not Chromatic.** "See tests as
  they run" is served by addon-vitest's sidebar Test widget (+ Interactions
  panel) and the optional `@vitest/ui` dashboard. Visual-regression (Chromatic)
  stays deferred per the original "prove the catalog first" guidance.
- **No prod/dev install split.** Dev vs release deps are already correctly
  declared (Storybook/Vite/Vitest/Playwright are `web` devDependencies; the
  production bundle and daemon pull only runtime deps) and there is no release/
  deploy pipeline, so a `--production` install mode would be solving a non-problem.
- **Android packaging smoke (sync-i24s.2) moved to the Android epic (sync-imeu).**
  It validates the real Capacitor bundle path, not Storybook.

### Deferred / not done

- **CI.** No CI pipeline exists yet, so the Vitest plugin `storybookScript`/
  `storybookUrl` (failure→story links) were skipped. When CI lands it will also
  need `bunx playwright install chromium` before `test:storybook`.
- **Parallel full-app E2E flow tooling.** Removed as a UI-flow framework.
  Component-composition flows live in Storybook. Live daemon/`/web` checks should
  stay narrow: production bundle boots, daemon data maps correctly, routing works,
  and SSE updates arrive. They should not duplicate Storybook's curated UI flow
  contracts.

### Extending with complex cross-component flows

Multi-step journeys that cross components (open a view → click → navigate →
assert) are **interaction tests over a composed mount**, not isolated component
stories. `web/src/flows/SynchronizeFlows.stories.tsx` is the current template.

**Where they live:** `web/src/flows/*.stories.tsx` under the `Flows/*` title
family. One file per flow area is fine; group related journeys in the same file
when they share fixtures/helpers.

**How to add one:**

1. **Mount the real composed surface.** Use the exported `Shell`
   (`web/src/App.tsx`) so the flow runs through the actual navigation glue, not
   a hand-wired harness. `parameters: { layout: "fullscreen" }`.
2. **Drive it in a `play` function with `step()`.** One labeled `step()` per
   phase so the Interactions panel and failures read as discrete stages.
3. **Target deterministically.** Match a distinctive, unique string (not "the
   first row"); query portals (thread, dialog, menu, toast) via `screen` /
   `document`, in-tree content via `within(canvasElement)`. Scope assertions to
   the relevant pane to avoid matching the same text elsewhere (e.g. a feed row
   and the thread parent).
4. **Make each assertion meaningful.** Assert the *transition*, not a tautology:
   e.g. a virtualized item absent-before / visible-after a scroll, `scrollTop`
   moving off 0. Avoid checks that pass without the action happening.
5. **Add fixtures to `seed.ts`, never fork `MockDataSource`.** Append data in a
   room no story indexes positionally (so existing index-based stories don't
   shift). Mind component behavior that depends on the data — e.g. `ThreadPane`
   auto-scrolls to the bottom only when the last reply is `you`, so a
   top-opening thread needs a non-`you` last reply.
6. **Optional watchable demo.** Add a paced twin (`pauseMs` + smooth scroll)
   that shares one flow helper with the real test, tagged `tags: ['!test']` so
   it is excluded from `test:storybook` (no CI slowdown/flake). See the `*Demo`
   stories in `web/src/flows/SynchronizeFlows.stories.tsx`.
7. **Verify:** `cd web && bun run test:storybook` (or the MCP `run-story-tests`)
   + screenshot the end state.

**Stay inside the boundary.** These run against `MockDataSource` in a real
browser. They are the canonical home for UI flow contracts. If a check needs
real daemon state, SSE, or routing, keep it as a narrow Bun/live `/web`
integration smoke instead of a second flow framework. Debugging detail and the
MCP catalog: `docs/debugging/storybook.md`.


## Goal

Add Storybook as the Synchronize web UI's component glossary, isolated
development surface, browser component-test harness, and agent-readable UI
context provider.

This is intentionally a `web/` development and verification layer. It must not
replace the production Bun build, create a second UI runtime, or fork mobile
components. The production app remains the daemon-served React bundle under
`/web`; Storybook renders the same source components with controlled fixtures.

## Research Basis

The plan follows current Storybook and Tailwind guidance:

- Storybook's MCP server is an official preview feature for React projects. It
  connects Storybook to agents so they can inspect component documentation,
  generate stories, preview stories, run story tests, and use documented
  component usage instead of guessing props or patterns.
  Reference: `https://storybook.js.org/docs/ai/mcp/overview`.
- The Storybook MCP API exposes three toolsets:
  - `dev`: `get-changed-stories`, `get-storybook-story-instructions`,
    `preview-stories`
  - `docs`: `get-documentation`, `get-documentation-for-story`,
    `list-all-documentation`
  - `test`: `run-story-tests`
  Reference: `https://storybook.js.org/docs/ai/mcp/api`.
- Storybook's Vitest addon transforms stories into component tests in a real
  browser environment using Vite and Playwright Chromium. It can run in the
  Storybook UI, editor, CLI, and CI.
  Reference:
  `https://storybook.js.org/docs/writing-tests/integrations/vitest-addon/index`.
- Interaction tests live in story `play` functions. A story provides the
  initial render state; the `play` function performs user interactions and
  assertions against the canvas.
  Reference:
  `https://storybook.js.org/docs/writing-tests/interaction-testing`.
- Storybook supports toolbar globals, backgrounds, viewport controls, themes,
  docs, MDX, and doc blocks such as `ColorPalette`.
  References:
  `https://storybook.js.org/docs/essentials/toolbars-and-globals`,
  `https://storybook.js.org/docs/essentials/backgrounds`,
  `https://storybook.js.org/docs/essentials/themes`,
  `https://storybook.js.org/docs/api/doc-blocks/doc-block-colorpalette`.
- Storybook's Tailwind recipe is to import the Tailwind entry CSS in the
  Storybook preview. Tailwind v4's first-party Vite integration is
  `@tailwindcss/vite`.
  References: `https://storybook.js.org/recipes/tailwindcss`,
  `https://tailwindcss.com/docs/installation/using-vite`.

## Local Architecture Fit

The current Synchronize web UI already has the right seams for Storybook:

- `web/src/main.tsx` imports the app-wide CSS stack:
  - `tw.css`
  - `styles.css`
  - `components/extra.css`
  - `components/activity.css`
  - `chat-bg.css`
  - `skin-glass.css`
  - `highlight.js/styles/github-dark.css`
- `web/src/data/context.tsx` exposes a typed `DataSourceProvider` and hooks.
  Components read snapshots and commands through hooks instead of importing a
  concrete backend.
- `web/src/data/types.ts` defines the UI contract for agents, rooms, messages,
  reactions, attachments, thread summaries, activity rows, archive previews, and
  launch/tool state.
- `web/src/data/mock.ts` already implements an in-memory `MockDataSource`.
- `web/src/data/seed.ts` already contains representative Claude Design-derived
  UI data: agents, groups, DMs, messages, thread replies, polls, tasks,
  artifacts, timeline events, and thread summaries.
- `web/src/data/daemon.ts` remains the live adapter for `/web/session`,
  `/web/state`, `/web/events`, attachments, activity, archive/resume, reactions,
  and sends.

The Storybook integration should exploit those seams instead of adding a
parallel state model.

## Non-Goals

- Do not migrate the production web build from Bun to Vite.
- Do not make stories depend on a live daemon by default.
- Do not duplicate the mock dataset into story files.
- Do not introduce a separate Android/mobile component tree.
- Do not make Storybook the source of truth for daemon API behavior.
- Do not require Chromatic or hosted visual regression in the first pass.

## Design Principles

1. **Stories are product states, not screenshots.** A story should capture a
   meaningful Synchronize state: busy agents, missing historical author,
   archived seat, pending launch, attachment draft, compact room navigation,
   thread replies, or daemon connection failure.
2. **The DataSource contract is the boundary.** Component stories use
   `MockDataSource` or purpose-built story data sources. Daemon behavior stays
   in Bun integration tests and live `/web` smoke checks.
3. **One source UI for desktop and mobile.** Mobile stories validate responsive
   states. Android/Capacitor packaging stays a separate build/runtime check.
4. **Every new UI feature gets a story.** Interactive features also get a
   `play` test.
5. **Agents must be able to query the glossary.** Storybook docs and MCP should
   provide enough usage guidance that Claude/Codex do not invent component
   props, themes, or local patterns.

## Phase 1: Storybook Foundation

Goal: boot Storybook against the existing web source without changing
production `/web`.

Implementation:

- Add Storybook config under `web/.storybook/`:
  - `main.ts`
  - `preview.tsx`
  - optional `manager.ts`
- Use `@storybook/react-vite` for Storybook only.
- Add scripts to `web/package.json`:
  - `storybook`
  - `storybook:build`
  - `test:storybook` once the Vitest addon lands
- Add Vite CSS support for Storybook:
  - prefer `@tailwindcss/vite` for Tailwind v4 if the current `tw.css` does not
    compile through Storybook's default Vite pipeline;
  - keep `bun-plugin-tailwind` confined to `web/build.ts`.
- Import the same CSS stack as `web/src/main.tsx` from `.storybook/preview.tsx`.
- Add `web/src/storybook/StorybookProviders.tsx`:
  - `DataSourceProvider`
  - `ContextMenuProvider`
  - `ToastProvider`
  - `ArchiveRecoveryProvider`
- Add a helper to create a fresh `MockDataSource` per story so localStorage and
  mutable snapshot state do not leak between stories.
- Add initial smoke stories for:
  - `IdentityBadge`
  - `StatusDot`
  - `Avatar`
  - one `MessageRow` state
  - one shell/layout story backed by `MockDataSource`

Acceptance criteria:

- `cd web && bun run storybook` starts a local Storybook.
- `cd web && bun run storybook:build` produces a static Storybook build.
- `cd web && bun run typecheck` passes.
- `cd web && bun run build` still produces daemon `/web` assets.
- Initial stories render with production CSS, not unstyled HTML.

Tests and verification:

- Run `cd web && bun run typecheck`.
- Run `cd web && bun run build`.
- Run Storybook locally and open at least one primitive story and one data-backed
  story.

Risks:

- Tailwind v4 + Storybook's Vite pipeline may not compile the current `tw.css`
  exactly like Bun. If so, add a Storybook-local Vite config rather than
  changing production `web/build.ts`.
- Base UI portals need the provider/decorator layer loaded before portal-heavy
  stories such as context menus, dialogs, and toasts are useful.

## Phase 2: Component Glossary And Fixture System

Goal: make Storybook a durable UI glossary for humans and agents.

Implementation:

- Add story-support files under `web/src/storybook/`:
  - `fixtures.ts` for scenario builders on top of `seed.ts`
  - `decorators.tsx` for provider, theme, and viewport helpers
  - `storyDataSource.ts` if a scenario needs a controlled `DataSource` beyond
    the stock `MockDataSource`
- Keep fixtures as transformations over `AGENTS`, `GROUPS`, `DMS`, `MESSAGES`,
  `THREAD_REPLIES`, `TASKS`, `ARTIFACTS`, and `TIMELINE`. Do not paste the
  seed arrays into story files.
- Organize stories by product vocabulary:
  - `Tokens/*`
  - `Primitives/*`
  - `Messages/*`
  - `Composer/*`
  - `Navigation/*`
  - `Surfaces/*`
  - `Layouts/*`
  - `Mobile/*`
  - `Agent States/*`
- Add MDX docs for:
  - token contract from `web/DESIGN.md`
  - `data-theme` and `data-skin`
  - `DataSource` contract
  - provider requirements for story authors
  - story naming and test expectations
- Add initial glossary coverage:
  - `IdentityBadge`
  - `IdentityText`
  - `Avatar`
  - `StatusDot`
  - `MentionChip`
  - `CountChip`
  - `AttachmentPreview`
  - `MessageRow`
  - `Composer`
  - `Sidebar`
  - `RoomHeader`
  - `AgentRoster`
  - `ThreadPane`
  - `ActivityItem`
  - `ActivityView`
  - `ArchiveRecovery`
  - `SpawnAgentDialog`
- Add scenario fixtures for:
  - empty room
  - long room names
  - missing/offline historical author
  - many reactions
  - markdown/code/table message
  - image and file attachments
  - poll message
  - archived session
  - launch unavailable/failing
  - unread/awaiting activity

Acceptance criteria:

- Storybook answers "what UI pieces exist?" without reading source files.
- Docs explain when to use each component family and what providers it needs.
- Storybook MCP documentation manifests contain meaningful entries once MCP is
  added in Phase 5.
- No story imports `DaemonDataSource` by default.

Tests and verification:

- Storybook renders all glossary stories.
- `cd web && bun run typecheck` catches fixture/type drift.
- Spot-check stories in Storybook Docs mode, not only Canvas mode.

Risks:

- Some current components are app-shell-oriented rather than pure prop-driven
  components. The preferred fix is a thin story wrapper and fixture data, not
  premature component rewrites.

## Phase 3: Theme, Skin, And Responsive Matrix

Goal: turn Storybook into the visual matrix for desktop, compact web, and
Android-class responsive work.

Implementation:

- Add Storybook toolbar globals:
  - `theme`: `light`, `rose-pine-dawn`, `dark`, `kanagawa-wave`,
    `catppuccin-mocha`
  - `skin`: `brutal`, `glass`
  - `density` or `scenario` only if needed after the first story batch
- In the preview decorator, map globals onto:
  - `document.documentElement.dataset.theme`
  - `document.documentElement.dataset.skin`
- Configure Storybook backgrounds for the main palette backgrounds:
  - light paper
  - dark paper
  - Kanagawa
  - transparent/checker if useful for overlays
- Configure viewport presets:
  - desktop wide
  - desktop
  - medium shell
  - tablet
  - Pixel/Android width
  - narrow mobile
- Add layout stories tied to the existing responsive compact shell plan:
  - desktop three-column shell
  - medium shell with roster hidden behind panel
  - compact chat-first shell
  - compact community panel
  - compact agent panel
- Add touch/readability stories:
  - compact composer with toolbar wrapping or scrolling
  - long title in compact header
  - thread pane in narrow viewport
  - archive recovery on narrow viewport

Acceptance criteria:

- Core stories are viewable across all product themes and both skins.
- Mobile viewport stories have no horizontal overflow at 390 px and 412 px.
- The theme/skin toolbar reflects the actual app token model, not a separate
  Storybook-only theme.
- Storybook validates responsive UI states, while Android packaging remains a
  separate `WEB_ASSET_BASE=/` build concern.

Tests and verification:

- Manual Storybook check across the theme/skin matrix for key stories.
- Optional visual-regression smoke against Storybook URLs for:
  - desktop shell
  - compact shell
  - message row dark mode
  - composer compact

Risks:

- Large theme matrix can become expensive. Keep automatic screenshots to the
  highest-risk stories; rely on manual toolbar checks for the full matrix until
  visual regression is introduced.

## Phase 4: Story Tests And Browser Quality Gates

Goal: turn high-value stories into executable browser component tests while
preserving existing daemon/integration tests.

Implementation:

- Add `@storybook/addon-vitest`.
- Let the addon configure Vitest browser mode using Playwright Chromium.
- Add `@storybook/addon-a11y` after the first stable interaction tests land.
- Add story `play` tests for:
  - composer typing and send callback
  - mention autocomplete keyboard path
  - reaction picker open/select/close
  - context menu open/close
  - archive preview/cancel/confirm
  - spawn-agent dialog validation state
  - thread pane close
  - roster focus
  - activity item jump
  - compact community panel open/select/close
- Keep daemon/API truth in current Bun tests:
  - `/web/state`
  - `/web/events`
  - route precedence
  - `DaemonDataSource` mapping
  - archive/resume API behavior
  - attachment staging
- Add a test split:
  - `bun test`: daemon, CLI, data adapter, pure logic
  - `cd web && bun run typecheck`: web type safety
  - `cd web && bun run build`: production web bundle
  - `cd web && bun run test:storybook`: browser component tests
  - optional later: screenshot visual regression

Acceptance criteria:

- Story tests run headlessly from the command line.
- A failing interaction points to a specific story URL and Interaction panel
  repro.
- Browser-level checks should target Storybook URLs for isolated component states
  instead of driving the full daemon app into every state.
- At least one tested story exists for each high-risk surface:
  - composer
  - message row
  - archive recovery
  - responsive shell

Tests and verification:

- Run `cd web && bun run test:storybook`.
- Run `cd web && bun run typecheck`.
- Run `cd web && bun run build`.
- Run the existing targeted Bun tests that cover `DaemonDataSource` if web data
  contracts changed.

Risks:

- Storybook's Vitest addon requires a Vite-based Storybook framework. This is
  acceptable because it is isolated to Storybook, but it means Storybook tests
  are not a byte-for-byte test of the Bun production bundle.
- Do not over-apply `play` tests. Static visual components can be covered by
  render smoke and docs; interaction tests should target real behavior.

## Phase 5: MCP And Agent-Native UI Workflow

Goal: make Storybook the UI context provider for Claude/Codex while keeping
final behavior grounded in local tests and live `/web` checks.

Implementation:

- Add `@storybook/addon-mcp`.
- Verify the MCP endpoint while Storybook is running:
  - `http://localhost:6006/mcp`
- Register the MCP server locally for Codex/Claude using the project-level
  pattern chosen by the maintainer. Storybook's documented generic command is:
  - `npx mcp-add --type http --url "http://localhost:6006/mcp" --scope project`
- Add repo instructions for UI work:
  - query Storybook docs before creating or changing UI components;
  - use `get-storybook-story-instructions` before writing stories;
  - use `list-all-documentation` and `get-documentation` instead of guessing
    component props or visual variants;
  - run `run-story-tests` after UI changes;
  - still run live `/web` verification when daemon state, SSE, API mapping, or
    route behavior changes.
- Document the Claude Design handoff loop:
  - Claude Design explores product intent and layout variants;
  - production React components live in `web/src`;
  - Storybook stories preserve the accepted states;
  - `play` tests capture interactive expectations;
  - live `/web` checks prove daemon integration.
- Add a convention to `web/DESIGN.md` or a new `docs/agents/storybook-ui.md`:
  - every meaningful UI feature ships with at least one story;
  - every interactive UI feature ships with at least one `play` test or an
    explicit reason it is covered elsewhere;
  - new tokens/themes must update token docs and relevant stories.

Acceptance criteria:

- An agent can list documented components through MCP.
- An agent can fetch component docs through MCP.
- An agent can run Storybook story tests through MCP.
- The MCP workflow is documented clearly enough that future UI agents reuse
  existing components instead of inventing local variants.

Tests and verification:

- Start Storybook and visit `/mcp`.
- From an agent with the MCP registered, ask it to list documented components.
- Run Storybook's MCP `run-story-tests` tool against the current story set.

Risks:

- Storybook AI/MCP support is preview-stage. Pin versions conservatively and
  keep the workflow useful even if MCP is temporarily unavailable: Storybook
  Docs plus CLI tests should still work.

## Mobile And Letta Boundary

Mobile and Letta matter, but they should not distort the Storybook integration.

For mobile:

- Storybook validates responsive and touch-sized UI states.
- The current local memory says the Android/Capacitor direction reuses the web
  UI bundle with `WEB_ASSET_BASE=/` and `WEB_DIST_DIR=dist-mobile`.
- That packaging path needs its own build/install smoke test. Storybook does not
  replace it.
- The plan should reinforce a single source component model: adapt responsive
  web components before considering any mobile-specific fork.

For Letta:

- Storybook should model Letta-facing UI as data projected through the
  Synchronize UI contract: agents, rooms, messages, activity, launch state, and
  backend labels.
- Stories may include "Letta-like remote agent" and "remote channel agent"
  scenarios, but should not depend on a running Letta server.
- Live Letta channel/backend behavior belongs in daemon/harness integration
  tests, not component stories.

## Implementation Order

1. Land Phase 1 alone and verify Storybook can compile the existing CSS and
   provider stack.
2. Land Phase 2 with enough stories to make Docs/MCP useful.
3. Land Phase 3 before large responsive/mobile UI work resumes, so future
   mobile states have a visual matrix.
4. Land Phase 4 once the first story taxonomy is stable enough that tests will
   not churn every day.
5. Land Phase 5 after docs and test coverage are non-trivial; MCP is weak if the
   component glossary is empty.

## Proposed Beads

Create these after the plan is accepted:

1. **Epic: Add Storybook as Synchronize's UI glossary, test harness, and agent
   context provider**
   - Owns the full integration.
2. **Foundation: Storybook React/Vite setup for `web/`**
   - Phase 1.
3. **Glossary: Story taxonomy, fixtures, and initial component docs**
   - Phase 2.
4. **Visual matrix: themes, skins, backgrounds, and responsive viewports**
   - Phase 3.
5. **Testing: Storybook Vitest/a11y integration and interaction tests**
   - Phase 4.
6. **Agent workflow: Storybook MCP and UI-work instructions**
   - Phase 5.
7. **Follow-up: Android/Capacitor packaging smoke for Storybook-covered mobile
   states**
   - Separate from Storybook; proves the real mobile bundle path.

## Final Verification Checklist

Before this plan is considered implemented:

- `cd web && bun run storybook` works.
- `cd web && bun run storybook:build` works.
- `cd web && bun run test:storybook` works.
- `cd web && bun run typecheck` works.
- `cd web && bun run build` works.
- Existing targeted Bun tests for web data contracts still pass.
- Storybook MCP `/mcp` endpoint is reachable when Storybook is running.
- Agent instructions explain how to use Storybook docs and tests before editing
  UI.
- At least one compact/mobile story exists and is checked at Android-class
  widths.
