# Handoff: Sigil Desktop Message, Thread, Activity, and Identity Alignment — Part 4

## Session Metadata
- Created: 2026-07-13 10:38:06
- Project: /Users/abhirupdas/Codes/Personal/synchronize-worktrees/abhirup-ui-revamp-sigil-codex
- Branch: abhirup/ui-revamp-sigil-codex
- Session duration: approximately 2 hours

### Recent Commits (for context)
  - 6227897 feat(web): unify glass UI and typography system
  - bb509aa chore: add local design skills
  - bf2d045 feat(web): glass-skin revamp + design-system sync + agent model picker
  - e016f35 chore(beads): close web multi-tab popout epic sync-ah0u (all phases shipped)
  - 3a14991 docs(plan): web multi-tab popout + cross-tab sync v0 (sync-ah0u)

## Handoff Chain

- **Continues from**: [2026-07-13-093959-sigil-desktop-visual-delta-part-3.md](./2026-07-13-093959-sigil-desktop-visual-delta-part-3.md)
  - Previous title: Sigil Desktop Visual Delta Audit — Part 3
- **Supersedes**: None. This is the fourth chained handoff and records the first implementation slice after the desktop delta audit.

## Current State Summary

The first user-approved desktop delta slice has been implemented and verified. Desktop Chat now uses tighter grouped transcript rows, self messages share the same identity/content columns as agent messages, and the local operator uses a monogram tile with a restrained full-row accent wash instead of a broad right-aligned card. The split Thread pane now owns a compact `Thread · #room · reply-count` header and denser reply spacing. Activity controls and rows are materially quieter and denser, with canonical agent tiles and flat identity-colored names. Harness logos, role glyphs, and status dots are retained because the curated Claude Design reference shows them; only the operator remains a monogram exception. Roster and room-header member identities now show presence consistently. The work is uncommitted, as requested in earlier sessions.

## Codebase Understanding

## Architecture Overview

- `ChatView` owns adjacent-author grouping and TanStack virtualization. No virtualizer or data-contract changes were needed.
- `MessageRow` owns the identity gutter, author metadata, message content, reactions, thread badge, and self-state classes.
- `ThreadPane` reuses `MessageRow` for the parent and replies, with its own virtualizer, resizable split contract, focus/deep-link behavior, and composer.
- `ActivityView` owns controls, grouping/timeline projection, and thread split state. `ActivityItem` owns each row's actor identity and actions.
- `Avatar`, `HarnessMark`, `IdentityBadge`, and `IdentityText` in `primitives.tsx` remain the shared identity system.
- `skin-sigil.css` is the final visual override layer after component CSS. Desktop-only refinements are scoped through `.app-shell:not(.shell-compact)` so compact behavior remains stable.
- Storybook shell residents must mount through `shellFrames.tsx`; this session corrected Activity and Thread stories to use production-parity frames.

## Critical Files

| File | Purpose | Relevance |
|------|---------|-----------|
| `web/src/components/MessageRow.tsx` | Shared chat/thread message renderer | Self identity gutter, flat identity names, grouped transcript geometry |
| `web/src/components/ThreadPane.tsx` | Parent/reply thread surface | Explicit room/reply context header and reply spacing |
| `web/src/components/ActivityItem.tsx` | One Activity event row | Canonical avatar/status/name cluster |
| `web/src/components/ActivityView.tsx` | Activity controls, grouped/timeline feed, split thread | Presence dots on digest/latest identities and flat latest actor label |
| `web/src/components/AgentRoster.tsx` | Agent presence roster | Compact rows and visible status dots |
| `web/src/components/RoomHeader.tsx` | Room chrome and member pile | Member status dots and `threadOpen` layout signal |
| `web/src/App.tsx` | Production shell composition | Thread pane always renders its own header without duplicating the room-header close button |
| `web/src/skin-sigil.css` | Sole Sigil visual skin | Desktop message/self/thread/activity/roster density and styling |
| `web/src/components/activity.css` | Activity structural CSS | New actor identity wrapper and compact preservation rule |
| `web/src/storybook/shellFrames.tsx` | Production-parity Storybook mounting | Reused by corrected Activity and Thread stories |

### Key Patterns Discovered

- `groupedWithPrev` is already authoritative. Visual grouping should be changed through CSS/markup without touching ChatView's row projection or virtualizer.
- `isSelfAgent(author, me)` remains the sole self-identity authority.
- The true curated Sigil reference uses provider/harness logos, small top-left role glyphs, and lower-right presence dots. A comparison subagent inspected older `reference-screenshots/` files and incorrectly recommended replacing them with initials. That recommendation was rejected after direct inspection of `docs/reviews/assets/sigil-visual-delta-2026-07-13/reference/sigil-desktop-light-chat2.png`.
- Flat agent names should use `IdentityText`; tinted surface badges should continue to use `IdentityBadge`.
- `RoomHeader`'s `data-thread-open` state controls tab-rail centering over the remaining chat column. The new `threadOpen` prop preserves that geometry while the close button lives in the Thread pane.
- Compact self messages still hide the newly rendered desktop operator gutter through a Sigil compact override, preserving the existing compact bubble layout.

## Work Completed

### Tasks Finished

- [x] Tightened desktop message-run spacing without changing virtualization.
- [x] Replaced broad self-message cards with a subtle full-row accent treatment.
- [x] Added the operator monogram to desktop self-message group starts.
- [x] Kept provider harness logos, role glyphs, and status dots for agent group starts.
- [x] Converted chat and Activity name treatments to flat identity-colored text where appropriate.
- [x] Added canonical avatar/status identity clusters to Activity rows.
- [x] Added status dots to Activity digest/latest identities, roster identities, and the room-header member pile.
- [x] Added an always-visible split Thread header with room and reply context.
- [x] Tightened Thread parent/reply/divider spacing while retaining the shared composer height.
- [x] Quieted Activity header controls, secondary filters, digest gaps, and event rows.
- [x] Flattened roster cards into compact presence rows.
- [x] Corrected Storybook mounting for Activity and Thread and updated identity/context regressions.
- [x] Rebuilt and visually reviewed desktop light/dark captures.
- [x] Updated Beads issue `sync-ewwp` with scope and verification.

## Files Modified

| File | Changes | Rationale |
|------|---------|-----------|
| `web/src/App.tsx` | ThreadPane always shows its own header; RoomHeader receives `threadOpen` | Match reference hierarchy without breaking centered room tabs |
| `web/src/components/MessageRow.tsx` | Self and agent rows share identity gutter; non-self names use `IdentityText`; 30px tiles | Dense, consistent transcript identity grammar |
| `web/src/components/ActivityItem.tsx` | Added 24px Avatar with status; replaced boxed actor badge with `IdentityText` | Carry canonical identity treatment into Activity rows |
| `web/src/components/ActivityView.tsx` | Status-enabled digest/latest avatars; latest actor uses `IdentityText` | Presence and name consistency |
| `web/src/components/AgentRoster.tsx` | 30px avatars with status | Match reference roster presence language |
| `web/src/components/RoomHeader.tsx` | Status dots in member pile; added `threadOpen` layout-only prop | Preserve thread-open header geometry without duplicate close control |
| `web/src/components/ThreadPane.tsx` | Added compact room/reply context header markup | Make the split rail explicit and contextual |
| `web/src/components/activity.css` | Added actor identity wrapper and compact avatar suppression | Support new desktop row identity without changing compact layout |
| `web/src/skin-sigil.css` | Message/self/thread/activity/roster density and styling refinements | Implement the approved desktop visual delta |
| `web/src/components/MessageRow.stories.tsx` | Self story now asserts operator identity gutter | Updated component contract |
| `web/src/components/ThreadPane.stories.tsx` | Production split-shell frame and header context assertions | Story/app parity |
| `web/src/components/ActivityView.stories.tsx` | `inMainColumn` decorator and row identity assertion | Story/app parity and identity regression |
| `web/src/components/AgentRoster.stories.tsx` | Status-dot assertions | Presence regression coverage |

## Decisions Made

| Decision | Options Considered | Rationale |
|----------|-------------------|-----------|
| Retain harness logos and role glyphs | Replace with initial-only tiles vs keep provider marks | Direct inspection of the curated Claude Design reference shows provider marks, role glyphs, and status dots. Older screenshot bundles were not design truth. |
| Show operator identity on desktop self rows | Keep avatar-less self bubbles vs shared transcript columns | The reference includes an operator tile and the shared geometry removes the remaining feed/card feeling. |
| Keep compact self bubbles avatar-less | Apply desktop operator gutter globally vs desktop-only treatment | Compact behavior is already tuned and explicitly out of this audit scope. |
| Put close action in ThreadPane header | Keep RoomHeader close vs duplicate both vs Thread-only | Matches the reference's contextual rail and avoids duplicate close controls. |
| Keep composer heights matched | Make thread composer shorter vs retain shared height | Existing typography regression expects equal anchored composers; the first shorter override failed and was removed. |
| Use local Sigil Activity overrides | Rewrite control markup vs CSS-only hierarchy | Preserves all filters, ARIA states, callbacks, and responsive behavior. |

## Verification Completed

- `make verify-web` passed:
  - web and root TypeScript checks
  - daemon and mobile web builds
  - 39 Storybook files
  - 171 Storybook tests
- `bun test` passed:
  - 396 passed
  - 8 skipped
  - 0 failed
  - 404 tests across 62 files
- `bun run check:theme-contract:strict` passed:
  - 113 source files
  - 470 CSS variables
  - 135 required tokens
- Root `bun run ast-grep:scan` passed.
- `git diff --check` passed.
- Storybook static build passed.
- Final focused Activity story passed after the last identity-label refinement.
- Fresh desktop screenshots were reviewed in both themes under:
  - `/tmp/sigil-focused-fix-2026-07-13/activity-sigil-light.png`
  - `/tmp/sigil-focused-fix-2026-07-13/activity-sigil-dark.png`
  - `/tmp/sigil-focused-fix-2026-07-13/thread-final-light.png`
  - `/tmp/sigil-focused-fix-2026-07-13/thread-sigil-dark.png`
  - `/tmp/sigil-focused-fix-2026-07-13/roster-light.png`
  - `/tmp/sigil-focused-fix-2026-07-13/message-agent-light.png`

Two failures appeared during intermediate verification and were fixed:

1. `Typography.stories.tsx` detected a 5px chat/thread composer-height mismatch. The thread-only composer-height override was removed.
2. `SynchronizeFlows.stories.tsx` detected the room-surface rail shifted by half the Thread width. `RoomHeader.threadOpen` restored the existing thread-open centering signal while keeping the close control in ThreadPane.

## Pending Work

## Immediate Next Steps

1. Read this handoff and the previous Part 3 handoff, then inspect the fresh `/tmp/sigil-focused-fix-2026-07-13/` captures before changing the completed slice.
2. Ask the user which remaining desktop delta to prioritize next. The previously established order was Board visual grammar first, then room-header/composer compression, followed by remaining supporting-surface polish.
3. If Board is selected, first address or explicitly test the room-surface rail/filter overlap described below before modifying Board visuals.

### Blockers/Open Questions

- No blocker on the completed message/thread/activity slice.
- Code-review finding to carry forward: `skin-sigil.css` absolutely centers the room-surface rail while Board filters remain an in-flow preceding sibling. At medium/narrow desktop widths the two rails may overlap instead of scrolling. This is outside the completed scope and was not changed. Add a medium-width BoardTab story or move both rails back into flow during the Board/header pass.
- The planned prose report `docs/reviews/sigil-visual-delta-2026-07-13.md` was not written because the user explicitly reprioritized implementation after reviewing the summarized deltas.

### Deferred Items

- Board's compact three-column visual grammar remains the largest direct-reference delta.
- Room-header and main composer vertical compression remain pending.
- Spawn dialog, Thread Summary, generic overlay polish, and other inferred supporting-surface deltas remain later work.
- Artifacts remains intentional V2 product scope.
- Android/compact visual-delta work remains deferred.
- The production `/web/events` Bun idle-timeout issue remains tracked separately as `sync-lz45`.

## Context for Resuming Agent

## Important Context

- Do not restore deleted legacy glass/chat-background/theme-specific story files.
- Do not revert `web/src/skin-sigil.css`; it is the intentional sole production skin.
- Do not replace harness logos with initials based on files under the older `reference-screenshots/` directory. The authoritative curated references are under `docs/reviews/assets/sigil-visual-delta-2026-07-13/reference/`.
- The completed slice is aesthetic-only. Data hooks, daemon integration, virtualizers, callbacks, menus, reactions, attachments, polls, deep links, resizable Thread behavior, and compact navigation were intentionally preserved.
- Production-data screenshots can contain private messages. Keep them in `/tmp`; do not copy their contents or images into git without explicit approval.
- The current worktree contains the entire uncommitted Sigil migration, not only this slice. Do not reset, clean, or selectively restore files based on baseline git history.
- `sync-ewwp` remains in progress because the overall migration still includes Board/header/composer work.
- No commit was created. Earlier user direction said not to commit until explicitly requested.

## Assumptions Made

- Desktop and medium can share the denser Sigil transcript rules; compact retains its established bubble geometry.
- The operator monogram is the intentional exception to harness-logo identity.
- Thread reply count is useful room-context metadata and is already available without a data-model change.
- Activity can become visually denser without removing or consolidating functional controls.

## Potential Gotchas

- `MessageRow` now always renders the gutter when `hideAvatar` is false, including self messages. The compact Sigil self rule hides that gutter; do not remove it without revisiting compact grid behavior.
- ThreadPane passes `hideAvatar`, so its self rows must continue to be forced back to a single-column grid by the Thread-specific Sigil selector.
- Room-header rail centering depends on `data-thread-open`; use the new `threadOpen` prop when the Thread split is open even if the close button is rendered elsewhere.
- Activity's direct rows now include an Avatar. Compact CSS hides that tile to preserve prior mobile density.
- `IdentityText` uses `--identity-text`; `IdentityBadge` uses contrast ink intended for a filled background. Use the correct primitive when flattening a name label.
- Full Storybook emits pre-existing React `flushSync` console warnings, but all 171 tests pass.

## Environment State

### Tools/Services Used

- Bun for typecheck, builds, and tests.
- Storybook/Vitest browser tests.
- Playwright with Google Chrome for desktop screenshots.
- Production-data preview proxy serving the rebuilt worktree `web/dist`.
- Beads issue tracker (`sync-ewwp`).

### Active Processes

These were inherited from Part 3 and may still be running; verify before relying on their task IDs:

- Worktree production-data preview: `http://127.0.0.1:4173/web/`
- Storybook static server: `http://127.0.0.1:6010/`
- Visible non-headless Chrome from the previous audit may still be open.
- The user's real production daemon is separate and must not be stopped or replaced.

### Environment Variables

- `SYNCHRONIZE_HOME`
- `SYNCHRONIZE_BIND`
- `SYNCHRONIZE_PORT`
- `SYNCHRONIZE_TOKEN`
- `SYNCHRONIZE_MCP_MODE`
- `WEB_ASSET_BASE`
- `WEB_DIST_DIR`

## Related Resources

- [Part 3 desktop visual-delta handoff](./2026-07-13-093959-sigil-desktop-visual-delta-part-3.md)
- [Part 2 migration handoff](./2026-07-13-024936-sigil-ui-full-migration-part-2.md)
- [Part 1 migration handoff](./2026-07-13-015130-sigil-ui-full-migration.md)
- `docs/agents/storybook-ui.md`
- `docs/reviews/assets/sigil-visual-delta-2026-07-13/reference/`
- `/tmp/sigil-visual-delta-2026-07-13/captures.json`
- `/tmp/sigil-focused-fix-2026-07-13/`
- Beads: `sync-ewwp`
- Separate bug: `sync-lz45`

---

**Security Reminder**: Validated handoffs must not contain secrets or private production message contents.
