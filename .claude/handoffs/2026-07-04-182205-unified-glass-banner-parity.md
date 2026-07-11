# Handoff: Unified transparent glass banner + glass-as-default (parity-driven redesign)

## Session Metadata
- Created: 2026-07-04 18:22:05
- Project: /Users/abhirupdas/Codes/Personal/synchronize-worktrees/feat-design-sync
- Branch: feat-design-sync
- Session duration: long (multi-phase; ran through one context compaction)

### Recent Commits (for context)
  - d099c89 feat(design-sync): unified transparent glass banner + glass as default  ← THIS SESSION
  - fcb5bb8 fix(thread): group consecutive same-sender replies
  - d9ef7f6 fix(glass): vivid dark identity palette + more author-group spacing
  - 87fc319 fix(glass): revert floating-overlay headers + room-tabs rail (broke layout)
  - 91fc5cf feat(web): agent-profile model picker wired to setAgentModel

## Handoff Chain

- **Continues from**: [2026-07-04-102631-glass-parity-harness.md](./2026-07-04-102631-glass-parity-harness.md)
  - Previous title: Glass-skin Parity Harness (reference-vs-implementation pixel diff)
  - That handoff built the harness + fixed atom-level deltas (identity palette, avatar, composer,
    accents, sidebar gradient, brand tiles). THIS session used the harness to drive a larger
    top-chrome redesign.
- **Supersedes**: None

## Current State Summary

All work is **complete, committed (`d099c89`), and pushed** to `feat-design-sync`. Using the custom
glass parity harness (reference Claude-design bundle vs. the worktree implementation, side by side
with shared mock data), this session redesigned the app's entire top chrome into **one unified,
transparent, floating banner** across the chat, activity, and board surfaces; migrated every
top-of-surface button cluster onto the shared `Rail`/`RailSegment`/`RailChip` components (dedup);
made **glass the default skin** with working light + dark; fixed the roster overlay and a
thread-open regression; and cleaned up the dead tokens the migration orphaned. Every enforced gate is
green: `typecheck`, `check:theme-contract:strict`, and **217/217 storybook tests**.

## Codebase Understanding

## Architecture Overview

- **Two-layer skin model**: `glass` is a *pure CSS re-skin* gated on `<html data-skin="glass">` —
  there are NO separate `*Glass` components. `brutal` is the legacy skin. All glass work lives in
  `web/src/skin-glass.css` + themed blocks in `web/src/styles/tokens.css`.
- **Theme registry**: `web/src/theme/theme-registry.json` (source of truth) →
  `web/scripts/generate-theme-registry.mjs` → `web/src/theme/registry.generated.ts` (do NOT edit the
  generated file; edit the JSON + regenerate). Token *values* still live in `tokens.css` until the
  "value registry migration" lands. `web/scripts/check-theme-contract.mjs` enforces: components
  reference ROLE tokens (no raw hex outside tokens.css), registry current, required tokens present.
- **Shell layout capabilities**: `web/src/shell-mode.tsx` maps a `ShellMode` (desktop/medium/compact,
  by `window.innerWidth`) to named `ShellLayout` booleans. Components read named capabilities
  (`layout.rosterAsOverlay`) instead of re-deriving from mode.
- **The expanding-rail standard**: `web/src/components/rail.tsx` — `Rail` (recessed well) +
  `RailSegment` (icon at rest → active expands to reveal label + optional count) + `RailChip`
  (companion control). Real lucide icons + label spans; NOT the design bundle's `:nth-child`/`::after`
  CSS-content hacks. Styling in `web/src/components/rail.css` (with `--rail-*` fallbacks) + glass
  tokens in tokens.css. **This is the button standard going forward.**
- **Parity harness** (`ds-bundle/parity/`, **gitignored** — local dev tool): symmetric micro-pages
  `ref-atom.html` (frozen `_ds_bundle.js` = the designer's compiled components + frozen glass CSS)
  vs `impl-atom.html` (`impl-bundle.js` esbuilt from current source + `impl.css` from a Storybook
  build). Plus a full-composition scene (reference `app.html` vs the impl Storybook
  `layouts-app-shell--responsive` story). `index.html` is the picker (scene / width / theme / split).

## Critical Files

| File | Purpose | Relevance |
|------|---------|-----------|
| `web/src/skin-glass.css` | All glass CSS (banner float/transparency, rails, roster, board) | Primary file for glass visual work |
| `web/src/styles/tokens.css` | Theme + skin token values (`--rail-*`, identity, accents) | Token defs; raw hex allowed HERE only |
| `web/src/components/rail.tsx` + `rail.css` | Shared Rail/RailSegment/RailChip standard | The unified button component |
| `web/src/components/RoomHeader.tsx` | Chat/board banner (tab rail, AGENTS chip, board filters) | Renders the unified banner |
| `web/src/components/ActivityView.tsx` | Activity banner (filters/segment/chips) | Migrated to Rail components |
| `web/src/shell-mode.tsx` | Shell layout capabilities per mode | Roster-overlay flip lives here |
| `web/src/theme/theme-registry.json` | Skin/theme source of truth (`initialSkin`) | Edit + regenerate for defaults |
| `web/src/App.tsx` | Shell composition; roster overlay render (~L483); tab→view (~L418) | Where banner + panes mount |
| `web/src/styles.css` | `.main-body` grid, `.shell-overlay-*` positioning | Roster panel + grid |
| `ds-bundle/parity/build-impl.sh` | Rebuilds impl.css + impl-bundle.js + compiled atoms | Run after ANY web/ change |
| `ds-bundle/parity/index.html` | Harness picker (font-normalize, desktop stacked split) | The tool UI |

## Key Patterns Discovered

- **Gate glass behavior on `[data-skin="glass"]` in CSS, NOT the React `skin` prop.** The parity
  harness forces `data-skin=glass` on `<html>` for styling but leaves the App's `skin` state as
  `brutal` — so any JSX conditional on the `skin` prop won't fire in the harness. (This bit the board
  filter rail: initially gated on the prop, it didn't render; switched to CSS `data-skin` gating.)
- **`:has()` / `:not(:has())` for DOM-state variants.** The chat banner distinguishes "normal"
  (`:has(.room-activity)`) from "thread open" (`:not(:has(.room-activity))`, since the thread
  "replying to" banner replaces `.room-activity`). Base rules apply to both; only `.room-tabs`
  positioning differs.
- **Floating banner = `position:absolute` over `ShellMainColumn` (already `relative`) + top padding
  on the scroll surface, NO mask** — so text flows *behind* the transparent rails (the user
  explicitly rejected the reference's hard-mask "content cut off" look).
- **Verify layout changes in the FULL-COMPOSITION scene, not the atom.** The atom renders bare
  `S.RoomHeader`/`S.ActivityView`; wrappers like `.floating-controls` (reference) or the shell mount
  only exist in the full app. The atom pixel-diff will mislead for layout/floating changes.
- **Build/verify loop**: edit → `bun run typecheck` → `bun run check:theme-contract` →
  `bash ds-bundle/parity/build-impl.sh` → screenshot via playwright-core (`/tmp/cap-*.mjs`, viewport
  matched to the real column width) → eyeball → `bun run test:storybook`.

## Work Completed

### Tasks Finished

- [x] **Chat banner** → one transparent floating bar: centered tab rail + AGENTS chip; room glyph +
      name dropped; messages/timeline flow behind.
- [x] **Activity banner** → single-axis floating bar; ACTIVITY wordmark dropped; brand glyph kept.
- [x] **Board banner** → in-board `.board-header` hidden; board filters (`All agents / High priority
      / Blocked`) rendered as a banner rail; columns flow behind.
- [x] **Thread-open** keeps the floating banner (fixed the revert-to-old-bar bug); `Thread · replying
      to X ×` rides over the thread pane on the right; pane slides in cleanly.
- [x] **Dedup**: activity filters/segment/chips migrated from CSS-mimicked markup to real
      `Rail`/`RailSegment`/`RailChip` components (added `disabled` to RailChip). Room tabs already on
      them (Phase 1). Removed ~110 lines of CSS mimicry.
- [x] **Roster overlay fix**: desktop flip left the overlay unpositioned (covered the sidebar) — added
      `.shell-overlay-agents.shell-overlay-desktop` right-panel positioning.
- [x] **Glass = default skin**: `theme-registry.json` `initialSkin: "glass"` + regenerated registry;
      verified glass renders in both light and dark (structure is theme-agnostic role tokens).
- [x] **Icons aligned to reference**: `MessageCircle` / `Columns3` / `File` (chat/board/artifacts).
- [x] **Audit cleanup**: removed orphaned `--ico-*` mask tokens + dead `.act-filter`/`.act-view-icon`
      nth-child assignments; regenerated registry.
- [x] **Harness UX**: both panes normalized to 14px body; desktop widths (≥1180) stack panes
      vertically (horizontal split) instead of side-by-side.

## Files Modified (commit d099c89 — 12 files, +373/−313)

| File | Changes | Rationale |
|------|---------|-----------|
| `web/src/shell-mode.tsx` | `rosterColumn:false`, `rosterAsOverlay:true` (all modes) | Roster is an overlay everywhere → full-width chat column → floating banner viable |
| `web/src/styles.css` | `.main-body` single column; add `.shell-overlay-desktop` | No 260px roster gap; roster slides in from the right |
| `web/src/components/RoomHeader.tsx` | icons; `.room-title-block` class; board-filter rail (`tab==="board"`, CSS-gated) | Banner content |
| `web/src/skin-glass.css` | floating/transparent banner (always-on, thread-safe); hide glyph+name; board/roster rules; removed act-* CSS mimicry | Core glass redesign + dedup |
| `web/src/components/ActivityView.tsx` | filters/segment/chips → Rail components; icons Inbox/Target/AtSign | Dedup |
| `web/src/components/rail.tsx` | `disabled` prop on RailChip | mark-all needs disabled |
| `web/src/styles/tokens.css` | removed dead `--ico-*` + nth-child assignments | Cleanup after migration |
| `web/src/theme/theme-registry.json` | `initialSkin: "glass"` | Glass default |
| `web/src/theme/registry.generated.ts` | regenerated (`INITIAL_SKIN="glass"`, −5 vars) | Generated from JSON |
| `web/src/components/ActivityView.stories.tsx` | play tests → `[data-rail-seg]`/`[data-label]`/`aria-checked` | Match new component DOM |
| `web/src/components/RoomHeader.stories.tsx` | play test → `[data-rail-seg]` (Phase 1) | Match new tab rail |
| `web/src/components/Shell.stories.tsx` | added `Responsive` story | Full-composition scene the harness mounts |

## Decisions Made

| Decision | Options Considered | Rationale |
|----------|-------------------|-----------|
| Floating via roster-overlay flip | thread `skin` into layout hook vs flip in shell-mode | Flip is one lever; medium mode already had the overlay path. Accepted brutal gets the structural change (roster toggle); transparent/float stays glass-only CSS |
| Remove glyph + name from banner | keep brand icon vs remove | User explicitly asked to remove both (max vertical real estate; sidebar identifies room) |
| Messages flow behind (no mask) | reference's hard-cut mask vs transparent flow-behind | User rejected the "content cut off" look; wants text visible behind rails |
| Board filters non-functional | wire state vs static demo | They were already visual-demo in BoardView; matches reference; no state to lift |
| Gate on `data-skin` not `skin` prop | prop conditional vs CSS | Harness can force data-skin but not the prop |
| Delta from reference OK | match reference exactly vs user's own direction | User: "It is fine if there is delta with reference — this is the current decision" |

## Pending Work

## Immediate Next Steps

1. Nothing blocking — the feature is done + pushed. A resuming agent should **reload the harness**
   (`open -a "Google Chrome" http://localhost:8080/ds-bundle/parity/index.html`) and confirm the
   current state before any new work.
2. If continuing polish, the highest-value deferred item is likely the **floating composer** (the
   reference floats the composer over the message stream; the impl composer is still docked).

### Blockers/Open Questions

- None open. The top-left-icon question ("thread icon / brand icon with # between") was resolved by
  the user's later instruction to **remove the icon entirely** — done.

### Deferred Items

- **Floating composer** — reference floats it; impl keeps it docked. Not requested this session.
- **Timeline treatment** — the timeline rail is padded below the banner (no collision) but not itself
  restyled/floated; fine for now.
- **Compact/mobile activity + board** — the flatten/floating work is desktop-focused; compact has its
  own filter-sheet path that was NOT deeply re-verified. Re-check at 390/412 widths before shipping
  mobile.
- **Pixel-diff tuning** — the numeric atom pixel-diff was not re-run against these layout changes (it
  can't express the floating/full-app layout anyway; verification was full-composition screenshots).

## Context for Resuming Agent

## Important Context

- **The parity harness is the primary verification tool.** It is served by a plain
  `python3 -m http.server 8080` at the repo root and is **gitignored** (`ds-bundle/parity/*`), so its
  files (incl. the modified `index.html`, `impl.css`, `impl-bundle.js`) are NOT in the commit and
  won't show in `git status`. After ANY `web/` source or CSS change you MUST run
  `bash ds-bundle/parity/build-impl.sh` or the impl side of the harness shows stale output.
- **Glass is now the app default AND the Storybook default.** `initialGlobals` in
  `web/.storybook/preview.tsx` reads `INITIAL_SKIN`, so stories with no explicit skin now render
  **glass + light** (`DEFAULT_LIGHT_THEME`). This is intended.
- **`ds-bundle/_ds_bundle.js` is the FROZEN designer reference** the harness diffs against; the impl
  is `impl-bundle.js`. The designer's readable source for the full-app reference is
  `ds-bundle/templates/glass-skin-revamp-e2e/app.jsx` + `glass-variants.css`/`glass-e2e.css` (the
  reference achieves its single-row banner via a `.floating-controls` wrapper + `display:contents` —
  the impl has no such wrapper, so we float `.room-header` directly instead).

## Assumptions Made

- Brutal skin is legacy and glass-focused work is the priority; brutal only needs to not *break*
  (verified: it keeps its two-row header + in-board board-header; gained only the AGENTS toggle).
- Desktop is the priority viewport; compact/mobile parity is a later pass.
- The board filters staying non-functional (visual demo) is acceptable.

## Potential Gotchas

- **`skin` prop vs `data-skin`** (see Key Patterns) — the #1 trap when adding glass-conditional JSX.
- **`:has(.room-activity)` gating** — `.room-activity` is absent when a thread is open; base banner
  rules must apply to `.room-header` unconditionally, only `.room-tabs` positioning varies. Getting
  this wrong reverts the banner to the old bar on thread open (the exact bug fixed this session).
- **Scoped CSS vars trip the theme contract** — e.g. `--float-clear` defined outside tokens.css warns.
  Inline layout px values or add the var to tokens.css.
- **Atom scene ≠ full app** for layout/floating — verify in full-composition.
- **`grep`/rtk output can look garbled** in this repo's shell; prefer `Read`/dedicated tools.

## Environment State

### Tools/Services Used
- Bun (typecheck, storybook build/test, theme scripts), Storybook 10, Vitest, esbuild, Tailwind v4,
  ast-grep (config `sgconfig.yml` — but `.ast-grep/rules/` is EMPTY, so it enforces nothing today),
  playwright-core (for headless screenshots via `/tmp/cap-*.mjs`).

### Active Processes
- `python3 -m http.server 8080` running at the repo root, serving the parity harness. Local only;
  safe to kill (`lsof -ti:8080 | xargs kill`) — restart with the same command from the repo root.
- A Google Chrome tab open at `http://localhost:8080/ds-bundle/parity/index.html`.

### Environment Variables
- None required for the web/harness work. (Daemon-side vars: `SYNCHRONIZE_HOME`, `SYNCHRONIZE_MCP_MODE`
  etc. — not relevant here.)

## Related Resources

- Predecessor handoff: `.claude/handoffs/2026-07-04-102631-glass-parity-harness.md`
- Storybook UI conventions (MUST read before editing `web/` components): `docs/agents/storybook-ui.md`
- Reference design source: `ds-bundle/templates/glass-skin-revamp-e2e/{app.jsx,glass-variants.css,glass-e2e.css}`
- Full checks: `cd web && bun run typecheck && bun run check:theme-contract:strict && bun run test:storybook`
- Rebuild harness: `bash ds-bundle/parity/build-impl.sh`

---

**Security Reminder**: No secrets in this handoff (verified — only file paths, CSS, and localhost URLs).
