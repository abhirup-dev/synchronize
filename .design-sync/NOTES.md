# design-sync NOTES — @synchronize/web (storybook shape)

`web/` is an **application, not a published component library** — no `main`/`module`/`exports`,
no built `.d.ts`, `dist/` is an SPA bundle. The sync is made to work via a few repo-specific
pieces, all captured below so a re-sync replays them.

## Setup gotchas (all [GENERAL])

- **[GENERAL] No library entry → a generated barrel.** `web/.ds-entry.tsx` (gitignored,
  regenerated) `export *`s every component module so esbuild puts them on
  `window.SynchronizeWeb`. Passed as `--entry` (cwd-relative `./web/.ds-entry.tsx`) AND listed
  in `cfg.extraEntries` (package-relative `./.ds-entry.tsx`). The extraEntries listing is what
  populates the build's `exported` gate (path-form extraEntries are source-scanned, following
  `export *` hops) — without it every storybook title is dropped `[TITLE_UNMAPPED]` because the
  empty `.d.ts` surface yields 0 known exports. If components are added/removed, regenerate the
  barrel (scan `src/components/*.tsx` + `src/ui/*.tsx` + `src/shell-mode.tsx` for PascalCase
  exports).
- **[GENERAL] Providers via `cfg.provider`, NOT the storybook decorator.** The components read
  React context (DataSource/ContextMenu/Toast/ArchiveRecovery). The auto-bundled `.storybook`
  decorator (`StorybookProviders`) builds a SEPARATE context instance from the components on the
  global → "Provider missing" on every cell. Fix: `web/.ds-providers.tsx` (gitignored) re-exports
  `DataSourceProvider` + a ready `mockDataSource` onto the global, and `cfg.provider` wraps every
  preview in the SAME global instances: DataSource → ContextMenu → Toast → ArchiveRecovery. The
  providers module also sets `data-theme="light"` / `data-skin="brutal"` at load (mirrors the
  storybook theme decorator, which `cfg.provider` replaces).
- **[GENERAL] `cfg.storyImports.shim` for Provider-suffixed files.** The shim-vs-bundle decision
  matches a module by FILENAME → export name. `Toast.tsx`→`ToastProvider`,
  `ContextMenu.tsx`→`ContextMenuProvider`, `ArchiveRecovery.tsx`→`ArchiveRecoveryProvider` mismatch,
  so their hook imports (`useToast` etc.) get bundled (fresh context) → "Provider missing" on those
  3 components' own previews. Forcing `cfg.storyImports.shim` on those paths routes the imports to
  the global. Any future component whose file name ≠ its exported name needs the same.
- **CSS + fonts:** no `cssEntry` — `[CSS_FROM_STORYBOOK]` scrapes the compiled stylesheet out of the
  reference storybook (the universal catch-all for this Tailwind-v4-via-Vite setup). Fonts are
  Google Fonts loaded by `.storybook/preview-head.html` → `[FONT_REMOTE]` (load at runtime, no ship).
- **buildCmd rebuilds the reference storybook**, not dist (dist isn't the entry). Uses the local
  storybook bin directly (`./node_modules/.bin/storybook build`) — `npx storybook build` collides
  with the `storybook` npm script and silently runs `storybook dev`.

## titleMap

- `ArchiveRecovery`→`ArchiveRecoveryProvider`, `ContextMenu`→`ContextMenuProvider`,
  `Toast`→`ToastProvider` (story titles use the short name; the export is the Provider).
- `Identity`→`IdentityBadge` (the `Primitives/Identity` story showcases the primitives; the other
  primitives — Avatar, StatusDot, Sticker, MentionChip, CountChip, IdentityText — are importable on
  the global but share this one card).
- Excluded (`null`): `ChatSurface` (Layouts/Chat Surface), `AppShell` (Layouts/App Shell),
  `SynchronizeUI` (Flows/Synchronize UI) — pure multi-component composition showcases, not importable
  single-component exports. Intentional, not a miss.

## Known render warns / skips

- **SpawnAgentDialog — floor card (skipped).** Base UI dialog hardcodes `open` and renders to a
  `document.body` portal; the captured canvas root is empty on BOTH the storybook reference and the
  preview (`sb-error` / 0px height). The compare oracle can't see portal content, so all 4 stories
  are `cfg.overrides.SpawnAgentDialog.skip`. Component is still importable; only its card is the
  floor. To upgrade later: author `.design-sync/previews/SpawnAgentDialog.tsx` rendering the dialog
  inline (no portal) — but there's no storybook reference to compare against, so grade it standalone.
- **Markdown `Empty` story — sb-error** (renders no root content in storybook itself), skipped. The
  other 4 Markdown stories render faithfully.
- `AgentColorPicker` is `cardMode:single` — confirmed during grading the picker renders INLINE (no
  portal escape), so it's a real card (not floor); single mode is sufficient. All 4 stories match.
- **`ContextMenuProvider` / `ToastProvider` — partial skips.** Some stories use a `play` function to
  open an IN-CANVAS portal overlay (menu / fired toast); the compiled preview never runs `play`, so
  it shows only the closed trigger → mismatch. Skipped those story ids (`surfaces-contextmenu--message-actions`,
  `surfaces-toast--fires-success`, `surfaces-toast--fires-error`); the remaining stories match.
- **`ScrollControls` — owned preview** (`.design-sync/previews/ScrollControls.tsx`): its `JumpToBottom`
  story reaches its shown state via a `play` scroll; the owned preview inlines the post-play END state
  (`startAtBottom`) to match the reference.
- `ArchiveRecoveryProvider` stories open a `document.body` dialog via `play` — it escapes the canvas on
  BOTH sides, so both show the identical launcher button row → they MATCH (no skip needed).
- **Dark-theme sibling components — real `*Dark.stories.tsx` files.** Themes are a Storybook toolbar
  GLOBAL (not stories), so default cards capture light/brutal. To get BOTH a light and a dark card for
  the hero surfaces, there are 4 dedicated dark stories: `web/src/components/{ChatView,Sidebar,
  ActivityView,BoardView}Dark.stories.tsx`. Each re-exports its base stories under a `… Dark` title with
  a decorator that sets `data-theme="kanagawa-wave"` (+ `globals.theme:"kanagawa-wave"`), so the Storybook
  reference AND the design-sync preview both render dark → a REAL dark-vs-dark compare (not a faked delta).
  **The dark palette is `kanagawa-wave`, the canonical `DEFAULT_DARK_THEME`** the app boots into
  (`web/src/hooks/usePersistentTheme.ts`) — NOT the legacy plain `dark`. Theme families:
  light = {light, rose-pine-dawn}; dark = {kanagawa-wave, dark, catppuccin-mocha}. They surface as separate
  cards (`ChatViewDark`, `SidebarDark`, `ActivityViewDark`, `BoardViewDark`); the base 4 stay light.
  Discovery needs the names on the global — `web/.ds-entry.tsx` aliases them
  (`export { ChatView as ChatViewDark }` …). `ChatViewDark`/`ActivityViewDark` carry `cardMode:column`
  like their bases. To add more dark siblings: add `<Name>Dark.stories.tsx` + the alias in the barrel
  (+ a column override if the base has one). They are the SAME components — encoded in conventions.md.
- **Glass-skin sibling components — real `*Glass.stories.tsx` files (11).** Skin is an ORTHOGONAL axis
  to theme (`data-skin="glass"` layers translucent `backdrop-filter` surfaces; composes with ANY theme).
  The gallery ships glass twins of the surface + navigation + composer components:
  {ChatView,BoardView,ThreadPane,ThreadSummaryPanel,TimelineRail,ContextMenu}Glass (Surfaces),
  {Sidebar,AgentRoster,RoomHeader,CompactAppBar}Glass (Navigation), `ComposerGlass` (Composer). Each
  `<Name>Glass.stories.tsx` re-exports its base stories under a `… Glass` title with a decorator that
  sets `data-skin="glass"` (+ `globals.skin:"glass"`); `Sidebar`/`RoomHeader` also override
  `args.skin:"glass"` (they take skin as a prop → the settings-toggle label agrees with the surface).
  Discovery needs the names on the global — `web/.ds-entry.tsx` aliases them
  (`export { ChatView as ChatViewGlass }` …; `ContextMenuProvider as ContextMenuGlass`).
  `ContextMenuGlass` is special: the base menu opens only via a `play()` (static capture doesn't run
  it), so the glass sibling authors an `AutoOpenTarget` that dispatches `contextmenu` in a `useEffect`
  → the menu is open at capture on BOTH sides. To add more: `<Name>Glass.stories.tsx` + barrel alias
  (+ column override if the base has one). SAME components — encoded in conventions.md.
- **Glass capture artifacts (rubric-exempt — do NOT "fix" the components).** Glass = translucency over
  content. On the fixed 900×700 WHITE canvas a glass surface reads PALER vs the tight storybook
  reference crop → canvas artifact (rubric teaches this), graded `match`. Two more classes (2026-06-26),
  both `close`: (a) tall glass (ThreadPaneGlass 908px) loses the bottom composer to the 700px capture
  FOLD — DOM-verified present (`.render-check.json`), same class as base ThreadPane; (b) the shrunken
  480px compare SHEET cell is too small to resolve fine detail — Gemini mis-flagged ChatViewGlass's
  right-hand timeline rail as "missing"; the RAW full-res `_screenshots/compare/raw/*__ds.png`
  confirmed it present on BOTH sides. Lesson: a sheet-grade "missing X" on a glass card → verify
  against the raw full-res + render-check texts before believing it. (CompactAppBarGlass/Controls
  `close` = close-button focus border is an interactive state, not captured statically.) All glass
  cards are DOM-faithful.
- **`Iconography` + `Typography` storybook titles — dropped `[TITLE_UNMAPPED]` (intentional).** Added
  on master 2026-06-26 (iconography/typography polish). They are showcase galleries (icon/font
  specimens), not reusable single-component exports with APIs — correctly excluded. Re-adopt only if
  they become real components (add a `titleMap` entry + barrel export).
- **2026-06-26 re-sync.** Merged `origin/master` (iconography/typography polish + agent-profile menus;
  8 components changed: ActivityItem, ActivityView, AgentRoster, ArchiveRecoveryProvider, MessageRow,
  RoomHeader, Sidebar, SpawnAgentDialog) and added the 11 glass twins above. Final vision grade
  (Gemini, raw-verified): 146 match / 5 close / 0 mismatch across 43 components.
- **`Iconography` card — real showcase component (`web/src/components/Iconography.tsx`).** The master
  story `Design/Iconography` is a gallery (identity tiles + message-kind markers), render-only with no
  export → `[TITLE_UNMAPPED]`. Promoted to a real showcase component (parallel to `Identity`→
  `IdentityBadge`): `Iconography.tsx` exports the gallery, the story renders `<Iconography />`, and the
  barrel re-exports it so the title maps. `Typography` stays dropped (font specimen gallery, no API) —
  re-adopt only if it becomes a real component.
- **`AgentPreview` — container-query fix for narrow-width collapse (2026-06-27).** At narrow display
  widths the card's default 2-column section grid collapsed each `Detail` value column to ~1 char
  (vertical text): the fixed `72px` label + `18px` copy button left no room. Fix is a CSS container
  query on the card itself — `@container` on the `<article>`, section grid `grid-cols-1 @[360px]:grid-cols-2`
  — so it is single-column under 360px and two-column above, driven by the CARD's own width (no JS, no
  shell-context dependency; works in the design-sync card, the dialog, and mobile). TWO gotchas pinned:
  (1) the card width MUST be definite (`w-[660px] max-w-full`), NOT `w-[min(660px,100%)]` — a percentage
  width under `container-type:inline-size` resolves to ~0 in the storybook `layout:centered` parent
  (indefinite width) and collapses the reference to a 36px strip; (2) the design-sync preview grid mounts
  a sibling `AgentProfileDialog` cell (both are PascalCase exports), so the AgentPreview cell is ~416px,
  still ≥360px → two-column (matches the reference). Don't widen the threshold past ~390px or the preview
  half-width cell flips to single-column and diverges from the reference.
- **Theme/skin wiring (post-2026-06-20 master merge).** Theme = palette, skin = aesthetic, both carried on
  `<html data-theme>`/`<html data-skin>`. CSS load order is centralized in `web/src/styles/css.ts`, imported
  by BOTH `main.tsx` and `.storybook/preview.tsx` (never duplicate the list — drift silently dropped
  tokens.css once). The reference-storybook CSS scrape (`[CSS_FROM_STORYBOOK]`) therefore captures the full
  stack (tokens/extra/activity/chat-bg/skin-glass/hljs/code-light) automatically. `preview.tsx` itself maps
  the `theme`/`skin` toolbar globals → documentElement dataset, identical to the app — so a story renders
  what the app renders. No converter change needed for any of this.
- **Compact/mobile chrome components live in `App.tsx`.** `CompactAppBar`, `CompactSettingsSheet`,
  `SettingsRow`, `Placeholder`, `ConnectionError` are exported FROM `App.tsx` (which also exports the
  self-mounting `App`/`Shell` roots — those are excluded). The barrel NAMED-re-exports the 5 standalone
  ones so they reach the global without surfacing App/Shell as cards. App.tsx has NO top-level mount side
  effect (mounting is in main.tsx), so importing it in the barrel is safe.
- **`Sheet` + `CompactSettingsSheet` — floor cards (skipped), confirmed after capture.** Both are built on
  the `Sheet` primitive, which renders its open state to a `document.body` portal. The captured canvas root
  is empty on BOTH the storybook reference AND the preview → every story is `sb-error`
  ("no storybook root content"), including the would-be `primaryStory` (`Open` / `Dark Glass`). The compare
  oracle can't see portal content, so both are `cfg.overrides.<Name>.skip = true` — same pattern as
  SpawnAgentDialog. Components stay fully importable (`.d.ts` / `.prompt.md` ship); only their preview cards
  are the floor. To upgrade later: author `.design-sync/previews/<Name>.tsx` rendering the sheet inline
  (no portal) — but there's no storybook reference to compare against, so grade standalone.
- **Card chrome background is `var(--paper)`, not `#fff` (LOCAL HARNESS MOD — `.ds-sync/lib/emit.mjs`).**
  The generated card HTML hardcodes `<style>body{margin:0;padding:24px;background:#fff}</style>` (two spots,
  lines ~133 + ~210), which OVERRIDES the bundle's `body{background:var(--paper)}` (styles.css:14). That
  hardcoded `#fff` is an ad-hoc non-theme value: components whose root is `background:transparent`
  (SettingsRow, `.compact-settings-row`) render on white in the preview while the storybook reference
  renders on paper → a false "missing background" mismatch. Fixed by editing emit.mjs so both card-chrome
  spots use `background:var(--paper)` (theme-driven, one source — the token; the review-index page at
  ~516 stays `#fff` as a neutral dev helper). Full-surface components (ChatView, the `*Dark` cards) fill
  the card so the chrome is never visible — unchanged. ⚠ If `.ds-sync/` is ever regenerated from the
  skill, re-apply this edit or transparent components regress to white. (Found via Gemini vision grading
  2026-06-23.) NB: do NOT "fix" this by setting `document.body.style.background` in `.ds-providers.tsx`
  (tried first — that's the same ad-hoc-JS-theme-setting anti-pattern; the CSS/card-chrome is the one place).
- **Compact-chrome stories declare `globals:{viewport:mobileNarrow}` → set `cfg.overrides.<Name>.viewport`.**
  `BottomNav` and `SettingsRow` stories pin a narrow viewport. The shell reads `shellModeForWidth(window.
  innerWidth)` (single source, `web/src/shell-mode.tsx`: compact <780px) and `BottomNav` is compact-only
  chrome (renders fully only when mode==="compact"). The capture defaults to 900px (desktop) → BottomNav
  degrades (labels + active-tab fill absent) and SettingsRow renders at the wrong scale. Fix is config-only,
  no code/flag: `cfg.overrides.<Name>.viewport = "375x700"` — `emit.mjs` writes `viewport="375x700"` into the
  card HTML and `compare.mjs` sizes BOTH the reference and preview pages to it (line ~431), so both render
  compact and match. The earlier guess that the `inBottomNavRow` *decorator* was the cause was wrong —
  `preview-gen-storybook.mjs` DOES apply story+meta decorators (line ~60); the gap was the viewport global.
- **Play-driven stories — skipped (recurring).** A story whose displayed state is produced by a Storybook
  `play` click (open a pane / scroll / open a profile dialog) is NOT reproduced by the compiled preview.
  Skipped story ids so far: `ActivityView`/`ActivityViewDark` `WideThreadPane`, `ScrollControls`
  `ScrollingDown`, and the agent-profile `View Profile Flow` stories (`AgentRoster`, `ActivityView`,
  `Sidebar` `Dm View Profile Flow` — they open `AgentProfileDialog` via `play`). `cfg.overrides.<Name>.skip`
  is a **story-id array** (NOT `true` — `new Set(opts.skip)` throws on a boolean). Cards still show their
  non-play stories.
- **`BottomNav` — floor card (all stories skipped).** Its preview screenshot paints ~38% less content than
  the storybook reference (ds 4.2KB vs sb 6.7KB at identical 375×700) even though `render-check.json` shows
  the labels ARE in the DOM (`texts:["ChatsActivityAgents"]`, `errs:0`, not blank/thin) — i.e. the component
  mounts correctly with all labels, but something in the capture doesn't paint them visibly. `compare.mjs`
  waits for `document.fonts.ready`, and external fonts fail equally on both panels, so it's not a font-FOIT
  issue. Vision grading (Gemini) consistently flags it; the root cause wasn't pinned without vision. Tried
  `viewport:"375x700"` (compact via `shellModeForWidth`) and `cardMode:"single"` (full-bleed) — neither fixed
  the paint. The COMPONENT is correct (verified in-app + storybook + render-check); only its card screenshot
  is off, so all 4 stories are `cfg.overrides.BottomNav.skip` → floor card. Component still ships its
  `.d.ts`/`.prompt.md`. Revisit: capture the ds preview in an interactive browser and diff painted vs DOM.
- **Shell composition showcases.** `Shell.stories` (`Layouts/App Shell`) and `SynchronizeFlows.stories`
  (`Flows/Synchronize UI`) both use `component: Shell` — pure multi-component composition, not single-
  component cards. Their titles derive to `AppShell`/`SynchronizeUI`, already `null` in `titleMap`. The old
  `Flows.stories.tsx` was deleted on master and replaced by `flows/SynchronizeFlows.stories.tsx`.

## [GENERAL] Play-driven story states (the recurring fan-out lesson)

Stories whose displayed state is produced by a Storybook `play` interaction (post-click / post-scroll /
post-open) are NOT reproduced by the compiled preview — previews compose the story render but never run
`play`, so they show the PRE-play initial state. Two sub-cases:
- Overlay portals **within the captured canvas** (context menu, in-canvas toast) → preview shows the
  closed trigger while the reference shows it open → visible mismatch → `cfg.overrides.<Name>.skip` the
  play-driven story id.
- Overlay portals to **`document.body`** (full dialogs) → invisible on BOTH sides → they match as-is
  (the visible part — the launcher/trigger — is identical), no skip needed.
- When the post-play state is reproducible by a prop (scroll position, pre-selected), **own the preview**
  and inline that END state (what `ScrollControls` does). Forcing open state in the `.tsx` to fake an
  overlay is forbidden — that destroys the fidelity being verified.

## Re-sync risks (watch-list for the next run)

- `web/.ds-entry.tsx` and `web/.ds-providers.tsx` are GENERATED scaffolding but **committed** (not
  gitignored) so they survive a fresh clone and re-sync is reproducible without hand-recreating them.
  They are NOT auto-regenerated by the converter — if the component set changes, regenerate the barrel
  yourself (scan `src/components/*.tsx` + `src/ui/*.tsx` + `src/shell-mode.tsx` for PascalCase exports)
  or new components won't reach the global. This is the one thing that silently goes stale.
- `mockDataSource` is a live `new MockDataSource()` seeded from `src/data/seed.ts`. If seed shapes
  change, provider-backed previews (ChatView, Sidebar, ActivityView, …) re-render with new data — a
  re-sync re-grades them. That's correct, just expect churn when seed changes.
- Story titles drive discovery. Renaming a story `title` or a component export breaks the `titleMap`
  mapping — re-check `[TITLE_UNMAPPED]` after any story-title or export rename.
- Fonts are remote (Google Fonts). If the app moves to self-hosted fonts, drop `[FONT_REMOTE]`
  expectation and wire `cfg.extraFonts`.
- Solo calibration verified Markdown, ChatView, AttachmentPreview against storybook (all match).
  The remaining components were graded in the fan-out — see their `.grade.json` basis markers.
