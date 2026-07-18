# Handoff: Sigil UI Full Visual-System Migration

## Session Metadata
- Created: 2026-07-13 01:51:30
- Project: `/Users/abhirupdas/Codes/Personal/synchronize-worktrees/abhirup-ui-revamp-sigil-codex`
- Branch: `abhirup/ui-revamp-sigil-codex`
- Session duration: long, across multiple context compactions

### Recent Commits (for context)
- `6227897 feat(web): unify glass UI and typography system`
- `bb509aa chore: add local design skills`
- `bf2d045 feat(web): glass-skin revamp + design-system sync + agent model picker`
- `e016f35 chore(beads): close web multi-tab popout epic sync-ah0u (all phases shipped)`
- `3a14991 docs(plan): web multi-tab popout + cross-tab sync v0 (sync-ah0u)`

## Handoff Chain

- **Continues from**: [2026-07-04-182205-unified-glass-banner-parity.md](./2026-07-04-182205-unified-glass-banner-parity.md)
  - Previous title: Unified transparent glass banner + glass-as-default (parity-driven redesign)
  - That handoff explains the pre-Sigil UI and parity infrastructure. This handoff supersedes its visual direction, not its maintainability/accessibility conventions.
- **Supersedes**: the glass visual direction for new implementation work. Do not revive multiple selectable skins/themes.

## Current State Summary

A complete aesthetic replacement of the Synchronize web UI with the Claude Design **Sigil** reference is in progress. The user explicitly wants one design system, not Sigil coexisting with glass/brutal/Kanagawa/Rose Pine. Product behavior, data flow, responsive shell capabilities, compact-width UX, accessibility, virtualization, and Storybook production-parity mounting must remain intact. The theme registry and shared identity primitives have been migrated; the conversation shell is partially ported. Work paused while fixing focused Storybook/a11y findings. There are 18 tracked file changes plus the new `web/src/skin-sigil.css`; nothing is committed.

## User Intent and Constraints

1. The supplied Claude Design project is the aesthetic source of truth:
   - Project: `https://claude.ai/design/p/41739566-4de3-4dda-90bc-a7777d50b42d?file=sigil%2Fdesign.md`
   - Project UUID: `41739566-4de3-4dda-90bc-a7777d50b42d`
2. Revamp the **entire live UI end to end**, especially chat and activity. Every real flow should speak Sigil even if the bundle does not show that exact state; infer from the design philosophy rather than leaving two systems.
3. Do not carelessly alter UX. The design bundle is primarily an aesthetic reference.
4. “Android” reference screens map to the existing **compact-width shell**, not a separate Android implementation. Preserve `shellLayout()` and `useShellNavigation()` behavior.
5. Prototype-only tweak controls, fake data, alternate accent/logo/composer/name modes, and illustrative-only screens must not enter production.
6. Additive ideas are allowed only when they map cleanly to real product behavior.
7. If a surface is truly ambiguous, finish unambiguous work and defer that surface rather than guessing destructively.
8. Preserve the repository’s world-class contracts: generated theme registry, semantic CSS tokens, layered typography, Tailwind v4 semantic bridge, Base UI behavior, Lucide icons, Storybook shell frames/providers, strict static checks, keyboard/focus semantics, and current data/API behavior.
9. The user asked that design interpretation remain in the main session; do not delegate core frontend/aesthetic judgment to subagents.

## Reference Design Understanding

The Sigil reference was personally inspected in light/dark desktop and compact states, including chat with thread, activity, board, artifacts, compact rooms, and compact chat. Its production-relevant grammar is:

- Near-black/white neutral surfaces: dark `#121316 / #17181c / #1e2025`, light `#fafafa / #f2f2f1 / #e9e9e7`.
- Ember accent: dark `#e8825a`, light `#c2571f`.
- Instrument Sans for UI/body/heading; JetBrains Mono for metadata, timestamps, code, labels, and status text.
- Dense, editorial/utilitarian hierarchy; hairline rules; minimal shadows; disciplined spacing.
- Desktop messages are grouped unboxed rows, not speech bubbles. Only group starts show identity/name metadata; continuations align quietly. Self/operator messages get a subtle full-row tint.
- Compact messages use tonal asymmetric bubbles while preserving the current compact UX/navigation.
- Agent identity is a rounded-square harness-mark sigil with stable hue, bottom-right status, and top-left Lucide role glyph. Operator is a simple accent monogram.
- Sidebar uses a 272px desktop target, neutral surface, inset ember active bar, compact mono labels.
- Header/tabs are flat segmented controls. Composer is docked and restrained. Thread remains a right split on desktop.
- Activity uses grouped bare containers and row separators, not glass cards.
- Board/other card surfaces use quiet neutral cards, fine borders, accent hover, and mono tags.

Authoritative design files previously inspected:
- `sigil/design.md`
- `sigil/implementationdetails.md`
- `templates/aesthetic-rerun-r3/v2.html`
- `templates/aesthetic-rerun-r3/shared/content.js`
- `templates/aesthetic-rerun-r3/shared/extras.js`
- `templates/aesthetic-rerun-r3/shared/mobile.js`

## Codebase Understanding

## Architecture Overview

- `web/src/App.tsx` owns app shell composition, route/surface state, thread width, responsive shell mode, theme state, and compact overlays.
- `web/src/shell-mode.tsx` is the authoritative responsive capability contract:
  - compact `<780px`
  - medium `<1180px`
  - desktop otherwise
  - desktop-only split thread; compact bottom nav/overlays/settings.
- `web/src/shell-layout.tsx` contains shared production/Storybook shell cells.
- `web/src/components/ChatView.tsx` retains TanStack virtualization and renders `MessageRow`, timeline, thread summary, scroll controls, and composer.
- `web/src/components/MessageRow.tsx` already receives `groupedWithPrev`; do not replace virtualization or duplicate grouping logic.
- `web/src/components/primitives.tsx` is the shared identity/chip primitive layer.
- `web/src/data/context.tsx` and daemon/mock data sources are behavior contracts and should not be redesigned for this work.
- `web/src/styles/tokens.css` owns runtime visual values; `theme-registry.json` owns typed theme/skin identities; `tw.css` maps semantic utilities through `@theme inline`.
- `web/src/styles/css.ts` is the single app + Storybook CSS import manifest.
- Base UI powers dialogs/menu/toasts/sheets. Lucide React is the only ordinary icon system.

### Storybook Contract

Before editing components, continue following `docs/agents/storybook-ui.md`:
- Shell-resident stories mount through production shell frames from `web/src/storybook/shellFrames.tsx`.
- Behavior differences use `shellLayout()` / `themeTraits()`, not ad hoc theme/mode branches.
- Theme and skin are global toolbar traits, not duplicate story axes.
- Update args, callbacks, visible states, `play` tests, and composed flows when contracts change.
- If an unrelated stale story/flow appears, surface it rather than silently expanding scope.

## Critical Files

| File | Purpose | Relevance |
|---|---|---|
| `web/src/theme/theme-registry.json` | Theme/skin identity metadata | Now defines only Sigil light/dark + Sigil skin and legacy theme normalizations |
| `web/src/theme/registry.generated.ts` | Generated typed theme contract | Regenerated; never hand-edit |
| `web/src/styles/tokens.css` | Semantic/value token contract | Contains appended Sigil light/dark/skin overrides; still contains legacy blocks to remove later |
| `web/src/skin-sigil.css` | Sigil-only cross-cutting behavior | New and intentionally modified; do not revert or overwrite with old glass rules |
| `web/src/styles/css.ts` | Shared CSS import order | Imports `skin-sigil.css`; chat background and glass imports removed |
| `web/src/hooks/usePersistentTheme.ts` | Persisted theme application | Normalizes old themes and removes stored chat backgrounds |
| `web/src/components/primitives.tsx` | Identity system | Sigil chip/harness mark/role/status implementation added |
| `web/src/components/MessageRow.tsx` | Grouped transcript rendering | Metadata and continuation treatment partially ported |
| `web/src/App.tsx` | Shell + display settings | Skin/background controls removed; compact settings simplified to light/dark |
| `web/src/components/Sidebar.tsx` | Room navigation/settings | Settings reduced to light/dark; Sigil classes/tokens apply |
| `web/src/components/RoomHeader.tsx` | Header and room tabs | Old theme/skin/background props removed |
| `web/src/styles/code-light.css` | Light syntax highlighting | Selectors migrated to `sigil-light`; changed immediately before pause, not reverified |
| `web/src/components/Composer.tsx` | Composer semantics | Next fix: add `role="combobox"` to textarea or otherwise remove invalid `aria-expanded` usage |
| `web/src/components/activity.css` | Legacy activity visuals | Still heavily contains old direct font/literal rules; must be ported/cleaned |
| `web/src/styles.css`, `web/src/components/extra.css` | Legacy/base structural CSS | Still contain old theme/skin assumptions and must be retired carefully |

## Key Patterns Discovered

- Theme = palette, skin = visual grammar. Sigil retains the typed axes but only one skin and one matched light/dark pair.
- Legacy stored theme IDs normalize through registry metadata; unknown old skin IDs fall back to `INITIAL_SKIN`.
- Dynamic identity custom hex is a supported exception; normal identities use deterministic token slots.
- `skin-sigil.css` should contain selector behavior only. Values belong in `tokens.css`.
- Android reference aesthetics map onto compact shell traits; platform and viewport remain orthogonal.
- Keep existing accessible wrappers (`IconButton`, `Sheet`, `ResizeHandle`, Base UI Menu/Toast/Dialog) and restyle rather than replace.

## Work Completed

## Tasks Finished

- [x] **Task 1 — Migrate theme registry to Sigil**
  - Registry now exposes `sigil-light`, `sigil-dark`, and `sigil` only.
  - Old light/Rose Pine and dark/Kanagawa aliases normalize safely.
  - Generated registry updated.
  - Production and Storybook fonts switched to Instrument Sans + JetBrains Mono.
  - Chat-background control and CSS removed from live imports; `web/src/chat-bg.css` deleted.
- [x] **Task 2 — Build Sigil identity primitives**
  - Added harness-mark rendering and role/status decoration in shared primitives.
  - Uses existing identity tokens and Lucide role icons.
  - No new UI dependency added.
- [ ] **Task 3 — Revamp conversation shell** — in progress
- [ ] **Task 4 — Restyle supporting product surfaces** — pending
- [ ] **Task 5 — Verify visual and contract parity** — pending
- [ ] **Task 6 — Remove legacy design systems** — pending

## Files Modified

| File | Changes | Rationale |
|---|---|---|
| `web/.storybook/preview-head.html` | Loads Instrument Sans + JetBrains Mono | Storybook typography must match production |
| `web/index.html` | Loads Instrument Sans + JetBrains Mono | Sigil typography |
| `web/src/App.tsx` | Removed skin/background/cycle controls; compact settings now appearance-only | One Sigil system, light/dark only |
| `web/src/chat-bg.css` | Deleted | Old background/skin system must not coexist |
| `web/src/components/CompactSettingsSheet.stories.tsx` | Updated to new appearance-only contract | Story contract parity |
| `web/src/components/MessageRow.tsx` | Added Sigil metadata hooks/group continuation treatment | Desktop grouped transcript |
| `web/src/components/RoomHeader.stories.tsx` | Removed obsolete theme/skin/background args; adjusted Sigil expectations | Story contract parity |
| `web/src/components/RoomHeader.tsx` | Removed obsolete display-system props/menu; retained compact settings entry | Preserve UX, remove old system controls |
| `web/src/components/Sidebar.stories.tsx` | Updated settings menu expectations to Light/Dark only | Story contract parity |
| `web/src/components/Sidebar.tsx` | Settings menu now only chooses Sigil Light/Dark | One design system |
| `web/src/components/primitives.tsx` | Added Sigil harness marks, role glyphs, status/identity chip structure | Shared identity foundation |
| `web/src/hooks/usePersistentTheme.ts` | Sigil comments/normalization; clears legacy chat-background storage | Safe migration |
| `web/src/styles/code-light.css` | Light syntax scopes now target `sigil-light` | Fix light code contrast; needs rerun |
| `web/src/styles/css.ts` | Replaced glass import with Sigil; removed chat background import | Single CSS manifest/system |
| `web/src/styles/tokens.css` | Added comprehensive Sigil light/dark/skin semantic overrides | Port raw prototype values into current token architecture |
| `web/src/theme/registry.generated.ts` | Generated Sigil theme/skin types/options | Typed contract |
| `web/src/theme/theme-registry.json` | Replaced old user-facing themes/skins with Sigil pair/skin | Single system |
| `web/src/tw.css` | `theme-dark:` now targets `sigil-dark` | Tailwind behavior matches registry |
| `web/src/skin-sigil.css` | New full-shell/message/activity/compact Sigil behavior layer | Sole production visual grammar; intentional changes must be preserved |

Current diff summary when handoff was created: **18 tracked files changed, 538 insertions, 392 deletions**, plus new handoff and new `skin-sigil.css`.

## Decisions Made

| Decision | Options Considered | Rationale |
|---|---|---|
| Only Sigil remains user-facing | Add Sigil beside glass/brutal vs replace | User explicitly rejected two coexisting systems |
| Two themes + one skin | One monolithic theme, additional selectable skin, or matched pair | Preserves typed architecture while accurately modeling palette vs grammar |
| Preserve UX/state/data | Copy prototype DOM/render loop vs restyle current React | Reference is aesthetic; current behavior is production-grade |
| Compact maps to Android reference | Separate Android implementation vs existing compact shell | User explicitly clarified this mapping |
| Shared Sigil identity primitive | Per-surface avatar CSS vs primitive | Prevents drift across chat/activity/roster/sidebar |
| No new component dependency | Add lobe-icons/shadcn/Radix vs existing local SVG/Lucide/Base UI | Existing dependencies cover needs; smallest maintainable diff |
| Remove chat backgrounds | Keep hidden/persisted vs delete | Old visual system must not coexist; Sigil references neutral surfaces |
| Defer truly ambiguous states | Invent from prototype vs derive only where clear | User authorized deferral over careless UX breakage |

## Pending Work

## Immediate Next Steps

1. **Finish the paused focused a11y fixes, then rerun focused Storybook tests.**
   - In `web/src/components/Composer.tsx`, the textarea currently has `aria-expanded`; add `role="combobox"` (and keep the listbox wiring) or remove unsupported ARIA if the focused test shows a better semantic fix.
   - In `web/src/skin-sigil.css`, add/confirm `.room-tabs { overflow-x: auto; }` to satisfy the existing BoardTab overflow contract without altering UX.
   - Use `--ink-soft`, not low-contrast `--ink-faint`, for tiny message metadata. The current handoff snapshot already shows Sigil metadata selectors; verify contrast.
   - Add a Sigil override for `.activity-dock-badge` so it uses a contrast-safe accent/on-accent pair.
   - The light syntax selectors were just changed to `sigil-light`; rerun to confirm github-dark colors no longer leak into light code blocks.
2. **Run focused Storybook/Vitest for changed stories** (`CompactSettingsSheet`, `Sidebar`, `RoomHeader`, `MessageRow`, `ChatView`, shell/board story) and address only real failures.
3. **Continue Task 3:** visually inspect the real app/Storybook at desktop 1440, medium 820, compact 390 in both modes. Tune conversation shell, header, message grouping, composer, thread, and compact bubbles before moving to supporting surfaces.
4. **Task 4:** port Activity end to end, then Board, roster/profile/spawn, menus/toasts/sheets, timeline, polls, attachments, and summaries using the same Sigil grammar.
5. **Task 6:** delete legacy `skin-glass.css`, old token blocks/selectors, old font rules, old theme-specific selectors/stories/docs only after live surfaces no longer depend on them.
6. **Task 5:** complete static, Storybook, build, repository test, browser, a11y, and pixel-comparison verification; then run `/verify` before commit.

### Latest Verification Results

The most recent known checks before pause:

- Theme registry generation/check passed after migration.
- Strict theme contract initially failed because the now-deleted `web/src/chat-bg.css` referenced unknown `--chat-bg-*` variables. The file was deleted afterward; strict check must be rerun.
- Initial TypeScript failures from obsolete story props were fixed by updating CompactSettingsSheet, Sidebar, and RoomHeader stories. Rerun typecheck to confirm current state.
- Focused Storybook work had reached these remaining issues:
  - BoardTab expected horizontal overflow behavior (`auto`) but saw `visible`; preserve overflow in Sigil CSS rather than weakening UX.
  - Light-mode a11y contrast failures included:
    - identity-0 text around `#8e701f` on `#fafafa` at approximately 4.48:1 (barely under threshold)
    - tiny metadata using `#a4a7ac` on `#fafafa` around 2.31:1
    - github-dark syntax colors leaking into light code blocks
    - activity badge pink/dark-text combination around 2.75:1
  - Composer textarea used `aria-expanded` without a supported role.
- `web/src/styles/code-light.css` was changed after those failures, but no verification was run afterward.
- Do not claim green tests until these commands are rerun.

### Recommended Commands

Use context-mode for test/build output to avoid flooding context.

```bash
cd web
bun run check:theme-registry
bun run check:theme-contract:strict
bun run typecheck
bun run build
bun run storybook:build
bun run test-storybook
bun run ast-grep:scan
bun run audit:class-strings
```

Then from repo root:

```bash
make verify-web
bun test
```

Run the `verify` skill before committing because product source changed.

## Blockers/Open Questions

- No external/design-access blocker remains.
- No major product ambiguity currently blocks the unambiguous core surfaces.
- Some real flows have no exact reference screenshot. Infer styling from Sigil primitives while preserving behavior; defer only if a visual decision would force UX restructuring.
- The Storybook component glossary requirement still applies when modifying components. Start Storybook and use its MCP glossary when available.

## Deferred Items

- Prototype-only Artifacts implementation and fake board filters are not goals unless current product behavior already exposes them.
- Larger UX restructuring, navigation changes, or separate mobile implementation are explicitly deferred.
- Plan document exists at `/Users/abhirupdas/.claude/plans/shimmying-questing-rainbow.md`, but the user later said to proceed directly rather than spend more time planning.

## Context for Resuming Agent

## Important Context

- **Do not revert `web/src/skin-sigil.css`.** It was intentionally created and later intentionally expanded. The SessionStart hook may report external/linter changes; treat them as intended unless the user explicitly asks otherwise.
- Do not reintroduce `skin-glass.css` into `styles/css.ts` or add old theme options back to the registry.
- Do not use a second design system as a fallback for unfinished surfaces. Port them to Sigil or explicitly defer genuinely ambiguous visual details.
- Do not copy the reference prototype architecture. Keep React, current hooks, virtualized lists, Base UI, Lucide, shell capabilities, data contracts, and accessibility behavior.
- The user wants the main agent to own visual interpretation. Subagents may locate files but should not decide the design language.
- Existing uncommitted work is user-authorized and must be preserved. Inspect before overwriting.
- The old CSS still physically exists in `tokens.css`, `styles.css`, `extra.css`, `activity.css`, and `skin-glass.css`. Runtime now selects Sigil, but final acceptance requires deleting the legacy system rather than merely making it dormant.

## Assumptions Made

- Light/dark family toggle remains a valid UX affordance; other theme/skin/background toggles do not.
- Legacy theme localStorage values should migrate, not crash.
- Compact-width behavior is authoritative current UX; Android screenshots only guide appearance.
- Existing harness metadata is sufficient for Sigil marks; local minimal SVG/letter fallbacks are acceptable where no mark exists.
- Current identity custom colors remain supported as a deliberate dynamic exception.

## Potential Gotchas

- `tokens.css` still contains old root/brutal/glass/Kanagawa/Rose Pine blocks before the appended Sigil scopes. Removing them too early can expose missing required tokens; flatten/migrate carefully and run strict contract after each deletion.
- `skin-glass.css` is no longer imported but still exists and may still be scanned by static tools. It must eventually be deleted or fully retired.
- `activity.css` contains many raw old font/literal rules and is likely the largest cleanup surface.
- Storybook tests enforce real shell geometry and a11y; do not “fix” them by deleting useful assertions unless behavior is intentionally changed.
- The strict theme checker scans CSS files even when not imported; dead legacy files can still fail validation.
- Tailwind class order matters because `cn()`/tailwind-merge keeps later conflicting utilities.
- Android/Capacitor builds reuse the same web UI. Preserve `WEB_ASSET_BASE=/` for mobile bundle; absolute `/web/` assets cause a white screen.
- Session close in this repo normally requires `git push` succeeding, but the user explicitly requested a handoff and pause now. No commit/push was attempted.

## Environment State

## Tools/Services Used

- Claude Design MCP and browser-use were used to inspect the reference project and capture temporary screenshots.
- Context-mode indexed prior repository/test output; use it for large test/build/diff output.
- Bun dependencies were installed via `make setup` during this worktree session.
- Storybook wiring guide: `docs/agents/storybook-ui.md`.
- Beads/session tasks at pause:
  - Task 1 completed: Migrate theme registry to Sigil
  - Task 2 completed: Build Sigil identity primitives
  - Task 3 in progress: Revamp conversation shell
  - Task 4 pending: Restyle supporting product surfaces
  - Task 5 pending: Verify visual and contract parity
  - Task 6 pending: Remove legacy design systems

## Active Processes

- No process was intentionally started during the final resumed segment. Check ports/processes before assuming an old Storybook/dev server survived compaction.

## Environment Variables

Relevant names only:
- `SYNCHRONIZE_HOME`
- `SYNCHRONIZE_BIND`
- `SYNCHRONIZE_PORT`
- `SYNCHRONIZE_TOKEN`
- `SYNCHRONIZE_MCP_MODE`
- `WEB_ASSET_BASE`
- `WEB_DIST_DIR`

Use a throwaway `SYNCHRONIZE_HOME` for real-app verification.

## Related Resources

- [Implementation plan](/Users/abhirupdas/.claude/plans/shimmying-questing-rainbow.md)
- [Storybook wiring conventions](../../docs/agents/storybook-ui.md)
- [Theme token-system plan](../../docs/plans/web-theme-token-system-v2.md)
- [Previous glass handoff](./2026-07-04-182205-unified-glass-banner-parity.md)
- Claude Design project: `https://claude.ai/design/p/41739566-4de3-4dda-90bc-a7777d50b42d?file=sigil%2Fdesign.md`

---

**First action for the next session:** finish the four focused a11y/overflow fixes under “Immediate Next Steps,” then rerun strict contract, typecheck, and the focused Storybook tests before making additional visual changes.
