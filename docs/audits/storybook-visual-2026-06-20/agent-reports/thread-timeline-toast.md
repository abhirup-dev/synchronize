# Thread / Timeline / Toast Storybook Visual Audit

Date: 2026-06-20
Scope: brutal-theme desktop only, 1280x720 viewport.
Capture method: isolated headless Playwright only against `http://localhost:6007/iframe.html?id=<story-id>&viewMode=story`. Static captures used a dedicated Playwright process with an explicit settle wait. Toast interaction-preview stories used isolated Playwright clicks in the same headless-only mode. The shared Codex in-app browser was not used.

## Audited Stories

- `surfaces-threadpane--with-replies` - pass
- `surfaces-threadsummarypanel--populated` - pass
- `surfaces-threadsummarypanel--single-thread` - pass
- `surfaces-threadsummarypanel--empty` - fail
- `surfaces-timelinerail--populated` - pass
- `surfaces-timelinerail--empty` - pass
- `surfaces-toast--all-kinds` - pass after isolated button clicks
- `surfaces-toast--fires-success` - pass after Storybook play interaction
- `surfaces-toast--fires-error` - pass after Storybook play interaction
- `surfaces-toast--sticky-with-dismiss` - pass after isolated sticky-toast click

## Confirmed Issues

### `surfaces-threadsummarypanel--empty`

Severity: 3
Likely cause: story fixture/source mismatch.

Screenshot: `docs/audits/storybook-visual-2026-06-20/screenshots/thread-timeline-toast--threadsummarypanel-empty.png`

Expected from source: `ThreadSummaryPanel.stories.tsx` says `ml-ranking` has no threaded messages and should exercise the empty "no threads" state.

Observed: the stable render shows a real Pulse thread summary with `14 replies`, participant badge, and last-reply metadata. DOM evidence also shows the same `PULSE · 14 replies` content. The current seed fixture for `ml-ranking` includes `ml-deepdive` with `threadReplyCount: 14`, so the story no longer demonstrates its intended empty state.

## Deferred

None. No story in this bucket was explicitly glass theme, compact, medium, mobile, or responsive-only, and none required the parent/shared browser for interaction.
