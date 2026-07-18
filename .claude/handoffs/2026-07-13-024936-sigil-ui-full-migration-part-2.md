# Handoff: Sigil UI Full Visual-System Migration — Part 2

## Session Metadata
- Created: 2026-07-13 02:49:36
- Project: /Users/abhirupdas/Codes/Personal/synchronize-worktrees/abhirup-ui-revamp-sigil-codex
- Branch: abhirup/ui-revamp-sigil-codex
- Session duration: approximately 1 hour after resuming the previous handoff

### Recent Commits (for context)
- 6227897 feat(web): unify glass UI and typography system
- bb509aa chore: add local design skills
- bf2d045 feat(web): glass-skin revamp + design-system sync + agent model picker
- e016f35 chore(beads): close web multi-tab popout epic sync-ah0u (all phases shipped)
- 3a14991 docs(plan): web multi-tab popout + cross-tab sync v0 (sync-ah0u)

## Handoff Chain

- **Continues from**: [2026-07-13-015130-sigil-ui-full-migration.md](./2026-07-13-015130-sigil-ui-full-migration.md)
  - Previous title: Sigil UI Full Visual-System Migration
- **Supersedes**: None. Read the previous handoff first for the full Claude Design reference analysis, user intent, original migration map, and the first implementation slice.

## Current State Summary

The Sigil aesthetic migration is substantially further along but remains uncommitted and incomplete. The focused accessibility/overflow failures from the previous handoff were fixed and verified, the conversation shell was tightened toward the supplied Sigil reference, Storybook theme parity was repaired, and the retired glass/brutal/theme-specific files and duplicate stories were physically removed. The token system was consolidated so Sigil light is the default `:root` palette and Sigil dark is its only alternate. Strict theme validation, typecheck, builds, and the focused regression tests pass. A full Storybook run after the large cleanup found four genuine stale-contract failures; all four were fixed and the focused rerun passes, but the full Storybook suite must be rerun once more. Supporting-surface screenshots were captured immediately before the user requested this handoff; they have not yet received a complete visual review. No commit or push has been made.

Persistent tracking now exists as **`sync-ewwp` — Migrate web UI to Sigil visual system**, P1 and in progress.

## Codebase Understanding

## Architecture Overview

- The production frontend remains one React/Bun web application. Compact/mobile behavior is the same component tree selected through `shellLayout()` / `useShellLayout()`, not a separate Android implementation.
- Visual values belong in `web/src/styles/tokens.css`; cross-cutting Sigil geometry and selector behavior belong in `web/src/skin-sigil.css`.
- The typed registry remains authoritative:
  - themes: `sigil-light`, `sigil-dark`
  - skin: `sigil`
  - legacy stored theme values normalize into the Sigil pair
- `web/src/styles/css.ts` is still the single app/Storybook CSS manifest.
- Storybook shell stories must mount the real production shell and use global theme/skin traits. The App Shell story now mirrors production persistence by setting localStorage from Storybook globals before mounting `Shell`.
- Message virtualization remains TanStack Virtual. The migration changes message geometry/presentation, not the data or virtualization architecture.
- Desktop/medium messages are grouped unboxed transcript rows. Compact messages use tonal asymmetric bubbles. Real reactions, attachments, polls, threads, menus, mentions, skills, and composer behavior remain intact.
- The retired design systems are no longer selectable and their dedicated styles/stories are being removed rather than left dormant.

## Critical Files

| File | Purpose | Relevance |
|------|---------|-----------|
| `.claude/handoffs/2026-07-13-015130-sigil-ui-full-migration.md` | Previous handoff | Full design-bundle analysis, user constraints, and initial implementation state |
| `.claude/handoffs/2026-07-13-024936-sigil-ui-full-migration-part-2.md` | This handoff | Exact continuation state after accessibility fixes, visual tuning, and legacy cleanup |
| `web/src/theme/theme-registry.json` | Theme/skin metadata | Sigil-only user-facing registry and legacy preference normalization |
| `web/src/theme/registry.generated.ts` | Generated typed contract | Do not hand-edit; generated from the JSON registry |
| `web/src/styles/tokens.css` | Semantic visual values | Now contains shared roles plus Sigil light default and Sigil dark override; legacy theme/skin rules were removed |
| `web/src/skin-sigil.css` | Sigil selector behavior | Intentional new file; contains shell, identity, transcript, composer, thread, Activity, overlay, board, and compact behavior |
| `web/src/styles/css.ts` | CSS load order | Imports tokens/base component CSS/Sigil skin/code palettes for app and Storybook |
| `web/src/components/MessageRow.tsx` | Message presentation | Grouped metadata, action-only footer marker, identity and continuation treatment |
| `web/src/components/Composer.tsx` | Composer | Valid combobox ARIA, reduced Sigil default height, preserved desktop resize behavior |
| `web/src/components/RoomHeader.tsx` | Header/tabs | Real production header; room-surface rail is positioned through Sigil CSS |
| `web/src/components/Shell.stories.tsx` | Production shell parity | Persists Storybook globals before mounting the real Shell so light/dark toolbar state is truthful |
| `web/src/components/activity.css` | Activity structure | Legacy Kanagawa-specific selectors were removed; Sigil behavior overrides live in `skin-sigil.css` |
| `web/src/components/extra.css` | Complex shared feature CSS | Legacy theme-specific selectors removed; still owns rich content and feature structure |
| `web/scripts/theme-contract-policy.mjs` | Static token policy | Retired file exceptions removed |
| `.claude/skills/synchronize-debugging/reference-v0-plans.md` | Historical discovery index | Previous handoff indexed under `sync-ewwp`; this continuation must also be indexed |

## Key Patterns Discovered

- `skin-sigil.css` must constrain `.message-stack` to `width/max-width: 100%`. Without this, `width: fit-content` and max-content markdown cause compact and medium messages to render wider than their grid column and be visibly clipped.
- Desktop reaction-add affordances should not reserve a full footer row. `MessageRow` now adds `message-footer is-action-only`; Sigil positions that footer as a hover/focus action on non-compact shells while compact keeps the existing touch affordance.
- The room-surface rail must remain centered over the chat column when a thread is open. Sigil positions the room-surface rail absolutely and shifts it with `--thread-pane-width`; this restores the existing flow contract.
- A shell Storybook decorator alone cannot control `Shell` theme because `usePersistentTheme()` writes its persisted value after mount. `Shell.stories.tsx` therefore seeds localStorage from Storybook globals and remounts on theme/skin changes.
- Theme and skin are global Storybook toolbar traits. Dedicated `*Dark.stories.tsx` and `*Glass.stories.tsx` files were stale duplicates and have been deleted.
- The old glass rule contained expanding-rail geometry tokens used by the real `rail.css`. When removing the glass token block, those neutral geometry/motion values had to be moved into shared root tokens. Strict theme validation caught the omission.
- The project script is `bun run test:storybook`, not `test-storybook`.
- `bun run ast-grep:scan` is a repository-root command, not a `web/` package script.

## Work Completed

### Tasks Finished

- [x] Resumed and checked the previous handoff for staleness; worktree matched materially.
- [x] Ran `bd dolt pull` and created/claimed `sync-ewwp` for the multi-session Sigil migration.
- [x] Indexed the previous Sigil handoff in the debugging skill plan index.
- [x] Added valid `role="combobox"` semantics to the composer textarea while preserving listbox wiring.
- [x] Restored horizontal overflow on `.room-tabs`.
- [x] Switched tiny message metadata from `--ink-faint` to contrast-safe `--ink-soft`.
- [x] Added a contrast-safe Sigil `.activity-dock-badge` override using accent/on-accent.
- [x] Darkened Sigil light identity slots 0 and 12 to pass contrast on their tinted backgrounds.
- [x] Verified `code-light.css` is scoped to `sigil-light`; focused Storybook tests pass.
- [x] Fixed compact/medium message clipping by constraining Sigil message stacks to their grid columns.
- [x] Converted desktop action-only reaction footers to hover/focus controls so they no longer create empty vertical rows.
- [x] Reduced the default desktop composer from three to two rows while preserving desktop resize-y behavior; compact remains non-resizable.
- [x] Repaired App Shell Storybook light/dark toolbar parity.
- [x] Re-centered the room-surface rail over the chat column when a thread is open.
- [x] Removed `web/src/skin-glass.css`, `web/src/chat-bg.css`, and `web/src/data/chatBackgrounds.ts`.
- [x] Removed all dedicated Glass/Dark duplicate Storybook files.
- [x] Removed retired Kanagawa/Rose Pine/brutal/glass selector rules from tokens, base CSS, Activity CSS, and extra CSS.
- [x] Made Sigil light the default `:root` palette and retained only the Sigil dark palette override.
- [x] Moved live expanding-rail geometry/motion variables into shared tokens after strict validation identified them.
- [x] Updated stale Storybook contracts for Instrument Sans, Sigil code colors, Sigil rails, and thread composers.
- [x] Simplified `usePersistentTheme()` to return only theme state while applying the sole Sigil skin and clearing the retired chat-background preference.
- [x] Captured light/dark desktop, medium, compact, Activity, Board, and supporting-surface screenshots for visual review.

## Files Modified

The current diff is **51 files changed, 607 insertions, 2917 deletions**. Major groups:

| File / group | Changes | Rationale |
|------|---------|-----------|
| `web/src/styles/tokens.css` | Removed legacy palette/skin blocks, consolidated shared roles, made Sigil light default, retained Sigil dark, restored shared rail tokens | One production visual system without losing semantic architecture |
| `web/src/skin-sigil.css` | Added full Sigil shell/identity/message/composer/thread/Activity/board/overlay/compact behavior plus focused accessibility/layout fixes | Sole cross-cutting Sigil behavior layer; do not revert |
| `web/src/components/MessageRow.tsx` | Grouped transcript hooks and action-only footer state | Dense Sigil transcript without changing message data/features |
| `web/src/components/Composer.tsx` | Combobox role, two-row desktop default, stale comment cleanup | Accessibility and closer Sigil composer density while retaining resize behavior |
| `web/src/components/RoomHeader.tsx` and stories | Simplified old display props; retained real tabs/actions; story contract updated | Preserve production behavior under Sigil styling |
| `web/src/components/Shell.stories.tsx` | Seed localStorage from Storybook globals and remount Shell by theme/skin key | Real shell now obeys global palette controls |
| `web/src/hooks/usePersistentTheme.ts` | Sigil-only skin application and theme return contract; removed dead chat background state | Delete retired visual preferences without weakening typed theme handling |
| `web/src/components/activity.css`, `extra.css`, `styles.css` | Removed old theme-specific rules and updated structural comments | Eliminate dormant legacy visual systems |
| `web/scripts/theme-contract-policy.mjs` | Removed deleted file exceptions | Static policy now reflects the actual Sigil source set |
| `web/src/components/*Dark.stories.tsx`, `*Glass.stories.tsx` | Deleted 15 duplicate theme/skin stories | Theme and skin are global toolbar traits, never duplicated stories |
| `web/src/skin-glass.css`, `web/src/chat-bg.css`, `web/src/data/chatBackgrounds.ts` | Deleted | User explicitly requested no second design system or chat-background variant |
| `web/src/components/Typography.stories.tsx`, `Iconography.stories.tsx`, `Rail.stories.tsx`, `ThreadPane.stories.tsx`, `CompactAppBar.stories.tsx`, `AgentRoster.stories.tsx` | Updated stale palette/font/skin assertions and removed pinned legacy globals | Story contracts now describe Sigil rather than deleted variants |
| `web/src/theme/ThemeTokenEditor.tsx`, `web/src/storybook/typographyFontSwitch.tsx` | Sigil registry defaults instead of brutal/light literals | Dev tooling follows the same registry contract |
| `.claude/skills/synchronize-debugging/reference-v0-plans.md` | Added previous Sigil handoff under `sync-ewwp` | Required plan → bd → index discovery chain |

Deleted story files include ActivityViewDark, AgentRosterGlass, BoardViewDark/Glass, ChatViewDark/Glass, ComposerGlass, ContextMenuGlass, RoomHeaderGlass, SidebarDark/Glass, ThreadPaneGlass, ThreadSummaryPanelGlass, and TimelineRailGlass.

## Decisions Made

| Decision | Options Considered | Rationale |
|----------|-------------------|-----------|
| Keep Sigil as one skin plus light/dark themes | Collapse everything into one theme axis; keep old skins | Preserves the repository’s typed semantic architecture while eliminating user-facing visual variants |
| Delete legacy files and duplicate stories now | Leave them dormant until the end | Core chat, Activity, Board, overlays, and supporting surfaces already consume shared tokens/Sigil overrides; user explicitly rejected coexistence |
| Make Sigil light the default `:root` palette | Retain brutal root defaults underneath Sigil selectors | Prevents old-system flash/fallback and removes a hidden second visual system |
| Keep desktop composer resize-y | Force a fixed low composer | This is an aesthetic-only migration; default density changed, but existing manual resize behavior remains |
| Hide action-only message footer only on non-compact shells | Hide everywhere | Desktop reference uses hover actions; compact must preserve touch access |
| Keep legacy theme names only in registry normalization | Remove all legacy strings | Stored preferences must migrate safely; normalization aliases are data migration, not selectable visual systems |
| Use global Storybook theme/skin traits only | Keep dedicated dark/glass stories | Repository wiring contract forbids duplicate stories per theme |

## Pending Work

## Immediate Next Steps

1. **Index this continuation handoff** in `.claude/skills/synchronize-debugging/reference-v0-plans.md` after the handoff is written, citing the previous handoff and `sync-ewwp`.
2. **Rerun the full verification loop after the final fixes made immediately before handoff**:
   - repository root: `bun run ast-grep:scan`
   - `cd web && bun run check:theme-registry`
   - `cd web && bun run check:theme-contract:strict`
   - `cd web && bun run audit:class-strings`
   - `cd web && bun run typecheck`
   - `cd web && bun run build`
   - `cd web && bun run storybook:build`
   - `cd web && bun run test:storybook`
3. **Review the newly captured supporting-surface screenshots** in `/tmp` in both modes and tune only genuine Sigil mismatches:
   - `/tmp/sigil-roster-sigil-{light,dark}.png`
   - `/tmp/sigil-spawn-sigil-{light,dark}.png` (capture reported zero body height; verify whether the portal rendered or recapture through an interaction story)
   - `/tmp/sigil-thread-sigil-{light,dark}.png`
   - `/tmp/sigil-summary-sigil-{light,dark}.png`
   - `/tmp/sigil-poll-sigil-{light,dark}.png`
   - `/tmp/sigil-toast-sigil-{light,dark}.png`
   - `/tmp/sigil-menu-sigil-{light,dark}.png`
4. **Perform real shell visual verification** at desktop 1440, medium 820/1024, compact 390/412, both palettes. Confirm room selection, chat grouping, thread open/resize/close, composer paths, Activity navigation, Board, roster/profile/spawn, sheets, menus, toasts, polls, attachments, and theme toggle.
5. **Run app integration verification** with a throwaway `SYNCHRONIZE_HOME`, then `make verify-web`, repository `bun test`, and the project `/verify` skill before committing.
6. **Clean remaining obsolete comments/text only where misleading**. Functional legacy selectors/files are gone; preference-normalization names in the registry must stay.

### Blockers/Open Questions

- [ ] No hard blocker.
- [ ] The full Storybook suite must be rerun after the last focused fixes. The most recent full run after legacy deletion had four failures; all four were corrected and the focused rerun passed 17/17.
- [ ] Supporting-surface screenshots were captured but not fully reviewed because the user requested this handoff immediately.
- [ ] The `ast-grep:scan` attempt was made from `web/` and failed because that script exists only at repository root; no AST scan has run in this continuation yet.

### Deferred Items

- Real daemon-backed smoke testing and pixel comparison are deferred to the next session.
- Repository-wide tests and `make verify-web` are deferred until the visual/supporting-surface review is complete.
- No commit/push was made. Keep `sync-ewwp` in progress until all acceptance criteria pass.

## Context for Resuming Agent

## Important Context

- This remains an **aesthetic-only migration**. Do not reorganize product UX, replace data flows, remove accessibility behavior, replace virtualization, fork a separate mobile implementation, or add prototype-only fake screens/toggles.
- Treat the Claude Design bundle as visual truth, not implementation architecture. The previous handoff contains the detailed design analysis and reference screenshots.
- **Do not revert `web/src/skin-sigil.css`.** It is intentional and now contains additional fixes beyond the previous handoff: room-tab overflow, metadata contrast, Activity badge contrast, message-stack width constraints, hover-only desktop actions, composer sizing, and thread-aware rail centering.
- The removed files/stories are intentional. Do not restore glass, brutal, Kanagawa, Rose Pine, Catppuccin, chat backgrounds, or per-theme duplicate stories.
- Legacy strings in `theme-registry.json` / `registry.generated.ts` are migration aliases only; they normalize old localStorage values into Sigil.
- `styles/tokens.css` now has two `:root` rules by design: one for shared scales/roles and one where Sigil light/default palette values begin. Sigil dark follows as the only palette override.
- The rail geometry tokens were formerly hidden in the glass block. They now live in shared root tokens and are required by `web/src/components/rail.css`.
- App Shell Storybook stories intentionally write theme/skin globals to localStorage before mounting the real `Shell`. Removing this causes the hook’s persisted default to override the Storybook toolbar.
- The user asked for main-session visual judgment. Use agents only for mechanical navigation/audits, not final aesthetic decisions.
- Claude Design preview `serve_url` values are secret-bearing and must never appear in handoffs, user output, logs, or persisted files.
- Use a throwaway `SYNCHRONIZE_HOME` for live verification so the user’s real daemon state is not touched.

### Verification State

Passed after the latest relevant fixes:

- `bd dolt pull`
- `git diff --check`
- `cd web && bun run check:theme-registry`
- `cd web && bun run check:theme-contract:strict`
  - latest: `Theme contract check passed (113 source files, 470 CSS variables, 135 required tokens)`
- `cd web && bun run audit:class-strings`
- `cd web && bun run typecheck`
- `cd web && bun run build`
- `cd web && bun run storybook:build`
- focused Storybook regression rerun:
  - Typography
  - CompactAppBar
  - RoomHeader
  - SynchronizeFlows
  - result: 4 files, 17 tests passed
- earlier focused Sigil set:
  - 9 files, 50 tests passed
  - MessageRow/Composer/ChatView/Shell set: 4 files, 29 tests passed

Needs rerun:

- Full `cd web && bun run test:storybook` after the last corrections.
  - Previous full result after the cleanup: 39 files; 166 passed, 4 failed.
  - The four failures were stale Instrument Sans expectations, a one-pixel composer tolerance, and room-rail centering with an open thread.
  - All four are now fixed and their focused rerun passes.
- Root `bun run ast-grep:scan`.
- `make verify-web`.
- Repository `bun test`.
- Live daemon/browser checks and `/verify`.

## Assumptions Made

- Sigil light remains the default fallback palette; generated registry initial theme remains Sigil dark as previously configured.
- Existing sidebar information architecture remains product UX even though the reference sidebar is simpler.
- Existing compact bottom navigation and composer actions remain functional product UX even where the prototype is visually simpler.
- Existing Base UI dialogs/menus/toasts and current callbacks remain authoritative; only their visual grammar changes.
- The old dedicated theme stories were redundant, not unique behavior coverage; their base stories remain and global toolbar traits exercise both palettes.

## Potential Gotchas

- The current branch has a large uncommitted diff: **51 files, +607/-2917**, plus both handoffs and `web/src/skin-sigil.css` untracked.
- The prior handoff and this continuation are both untracked. Include them intentionally when the user eventually asks to commit.
- Do not hand-edit `web/src/theme/registry.generated.ts`; regenerate from `theme-registry.json`.
- If strict theme validation reports unknown `--rail-*` variables, ensure the shared rail geometry block in `tokens.css` remains intact.
- Compact/medium clipping returns if `.message-stack` loses `width: 100%; max-width: 100%` under Sigil.
- The room rail flow test depends on `--thread-pane-width`; do not replace thread-aware positioning with generic `left: 50%` only.
- Desktop reaction-add interaction tests now hover the row before clicking. Preserve focus-within visibility for keyboard access.
- Full Storybook logs contain existing non-failing React `flushSync` console warnings.
- Capacitor/mobile builds reuse the web UI but require root-relative assets. Never introduce absolute `/web/` asset paths into the mobile bundle.

## Environment State

### Tools/Services Used

- Beads: `sync-ewwp` created and claimed; `bd dolt pull` completed.
- Storybook 10.4.6 and Vitest browser project.
- Playwright Chromium for screenshots and geometry checks.
- Context-mode for test/build/log summarization.
- Serena for targeted symbol/code navigation.
- A temporary Python Storybook static server on port 6009 was started and stopped before this handoff.

### Active Processes

- None intentionally left running.
- The Storybook dev/static servers used for screenshots were stopped.

### Environment Variables

- `SYNCHRONIZE_HOME` — use a throwaway value for live verification.
- `WEB_ASSET_BASE` / `WEB_DIST_DIR` — relevant when checking desktop/mobile asset builds.
- No secret values are recorded here.

## Related Resources

- Previous handoff: `.claude/handoffs/2026-07-13-015130-sigil-ui-full-migration.md`
- Current Beads feature: `sync-ewwp`
- Design reference project: `https://claude.ai/design/p/41739566-4de3-4dda-90bc-a7777d50b42d?file=sigil%2Fdesign.md`
- Storybook wiring rules: `docs/agents/storybook-ui.md`
- Theme registry: `web/src/theme/theme-registry.json`
- Sigil tokens: `web/src/styles/tokens.css`
- Sigil behavior: `web/src/skin-sigil.css`
- Reference index: `.claude/skills/synchronize-debugging/reference-v0-plans.md`
- Original planning artifact: `/Users/abhirupdas/.claude/plans/shimmying-questing-rainbow.md` (historical; implementation is governed by current code and the handoff chain)

---

**Security Reminder**: Validate this document before finalizing. No preview tokens, credentials, or private environment values should appear.
