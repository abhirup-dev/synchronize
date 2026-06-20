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
