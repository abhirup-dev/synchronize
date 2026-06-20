# Storybook Audit — Triage & Scoping

Date: 2026-06-20
Branch: `fix/storybook-visual-audit` (worktree `fix-storybook-audit`)

Every captured finding from [NOTES.md](./NOTES.md) classified into three buckets,
per the agreed pipeline:

- **(A) Storybook *configuration / architecture*** — the harness mounts components
  unlike the real app (missing shell-mode context, `layout: fullscreen` instead of
  the real layout slot, viewport width not mapped to shell mode). Affects many
  stories. **Fixed by the Storybook setup rework**, not per-story.
- **(B) Storybook *wiring* bug** — one story is wired wrong (under-passed props,
  stale fixture, bad play timing/coords). Genuine; **fix the story now.**
- **(C) Real bug, not Storybook** — reproduces in the actual app. Genuine;
  **fix the component/CSS now.**

Baseline: the Vitest story gate (render + play) is **green — 129/129**. So every
finding below is visual/layout/a11y, not a crash or play failure.

---

## (C) Real bugs — not Storybook  → fix now

| Finding | Root cause | Status |
|---|---|---|
| `primitives-iconbutton--active` | `active` classes placed before `variantClass`; twMerge let solid's `bg-paper-2` override the active `bg-yellow`. | ✅ fixed (reorder) |
| `navigation-agentroster--focused-agent` (contrast) | Focused card `bg-ink` harsh black + role line `text-ink-soft` unreadable on it. | ✅ fixed (paper-3 cream surface, normal ink text) |
| `navigation-roomheader--group` / `--long-title-and-description` / `--with-thread-banner` (AGENTS pill) | `.icon-btn` hardcodes 32px square + `padding:0`, beating the labeled button's `w-auto`; "AGENTS 5" clipped. | ✅ fixed (`.icon-btn.room-agents-btn` sizing modifier) |
| `layouts-chat-surface--android-compact` (inline code) | `.markdown code` had no `overflow-wrap`; long tokens overflow the bubble at Android widths. | ✅ fixed (wrap inline, keep block code scrolling) |
| Timeline rail visible in compact (user-reported) | `ChatView` rendered `TimelineRail` regardless of the `layout.timeline` capability (relied only on a `.shell-compact` CSS hide). | ✅ fixed (gate on `layout.timeline`) |

## (B) Storybook wiring bugs — fix the story now

| Finding | Root cause | Fix |
|---|---|---|
| `messages-messagerow--rich-with-reactions` | Story omits `onReact`/`onOpenThread`; the footer is gated `hasThreadBadge || onReact` (`MessageRow.tsx:188`, `hasThreadBadge` needs `onOpenThread`). App always passes both → reactions+reply badge vanish only in the story. | Pass `onReact`/`onOpenThread` (the real props). |
| `surfaces-threadsummarypanel--empty` | Story targets a room that actually has threads (seed `ml-deepdive` `threadReplyCount:14`); "empty" state never shown. | Point at a genuinely empty room or add an empty fixture. |
| `surfaces-contextmenu--message-actions` | Play opens the menu at viewport origin (0,0) instead of anchoring at the target. | Fix play to use the target's real coordinates. |
| `surfaces-scrollcontrols--scrolling-down` | Story forces `.is-scrolling` but the visible-pill condition isn't met in the harness. | Drive the real scroll state the component reads. |
| `flows-activity-to-thread--open-thread-from-activity` (+`-demo`) | Play scrolls before the virtualized thread pane finishes measuring → stops short of the last reply. | Await measurement/settle before asserting scroll bottom. |
| `activity-activityview--wide-thread-pane` | Story renders identical to `--grouped`; never opens the wide thread pane (no `.thread-pane`). | Drive the wide-thread state the prop/source intends. |

## (A) Storybook configuration / architecture — fix in the rework

All share one root cause: **the story harness does not mount the component the way
the app does** (no `ShellModeProvider`, `layout: fullscreen` instead of the real
grid slot, viewport width not mapped to shell mode).

| Finding(s) | Drift axis |
|---|---|
| `navigation-sidebar--group-selected` / `--activity-dock` / `--dm-selected` / `--typing-mode` | No fixed-width sidebar **slot** → Sidebar stretches, sections collapse into strips. |
| `navigation-bottomnav--chats-active` / `--activity-active` / `--agents-active-with-badge` / `--tap-agents` | No bottom-anchored **slot** → nav renders at top of canvas. |
| `layouts-chat-surface--desktop` / `--tablet` | Viewport **height** not pinned as a real shell → chat grows to content, composer falls below fold. |
| `navigation-agentroster--focused-agent` (full-width band) | No fixed-width roster **slot** → focused card spans full width. |
| `primitives-resizehandle--default` / `--at-max-width` / `--at-min-width` / `--narrow-clamp` | Harness renders dark pane labels with dark text (story-harness styling, not the component). |
| `surfaces-placeholder--artifacts` | `.placeholder` is `flex:1; place-items:center`; the app gives it a sized flex chat column, the bare/fullscreen story gives it no height → the stamp clips off the top. Needs the real main-column **slot**. |
| `surfaces-chatview--thread-open` (composer expanded) | Composer collapses only when `shellMode === "compact"` (`ChatView.tsx` `collapsedDefault`); the desktop story can't reach that state — needs real **shell mode** context. Likely a false positive once shell context is correct. |

## Deferred (out of current scope)

| Finding | Reason |
|---|---|
| `navigation-roomheader--glass-skin-board-tab` | Glass-skin propagation — belongs to the deferred glass-theme pass. |
| `layouts-app-shell--medium` | NOTES explicitly says "do not judge medium" — deferred to the responsive pass. |

## Not findings (referenced in NOTES but no defect)

| Id | Why it appears |
|---|---|
| `activity-activityview--grouped` | The comparison **baseline** NOTES cites for `--wide-thread-pane` ("looks identical to grouped"), not a failing story. |

## Coverage check

Cross-checked every story id in NOTES.md against this triage (32 ids). All are
accounted for: real findings classified A/B/C, plus the two deferred and one
non-finding above. Multi-variant findings (sidebar ×4, bottomnav ×4, resizehandle
×4, the two roomheader crowding stories, the two flows stories, layouts
desktop+tablet) are grouped on a single row each.

---

## Plan

1. **Now:** land all (C) [done] + all (B) story fixes.
2. **Then:** the Storybook setup rework addresses every (A) at the architecture
   level (app-derived mount harness + layout slots + seed-driven args), so the
   class of false positives stops recurring.
3. **Validation:** the Vitest gate runs after every change; once the rework lands,
   re-run the full audit against the corrected harness to confirm (A) items are
   genuinely resolved (not just hidden).
