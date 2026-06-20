# Activity / Chat Desktop Storybook Visual Audit

Date: 2026-06-20
Scope: brutal-theme desktop pass for the assigned ActivityItem, ActivityView, BoardView, and ChatView stories only.

## Capture Method

- Source inspection: read `web/src/components/ActivityItem.stories.tsx`, `ActivityView.stories.tsx`, `BoardView.stories.tsx`, and `ChatView.stories.tsx` before judging.
- Primary capture: isolated headless Playwright CLI, no Codex in-app browser:
  - `bunx playwright screenshot --viewport-size=1280,720 --wait-for-selector '#storybook-root > *' --wait-for-timeout 750 'http://localhost:6006/iframe.html?id=<story-id>&viewMode=story' /tmp/...png`
- Follow-up capture for vertical clipping checks only: isolated headless Playwright at `1280,1300` for ChatView stories whose composer was below the 720px viewport.
- DOM checks: isolated Playwright script from `web/` using the local `playwright` package.

## Confirmed Issues

### `activity-activityview--wide-thread-pane`

Severity: 3
Likely cause: story/harness wiring.

Screenshot: [activity-chat-desktop--activity-activityview--wide-thread-pane.png](../screenshots/activity-chat-desktop--activity-activityview--wide-thread-pane.png)

Expected from source: the story is meant to show the same feed with a wider thread side-panel preference; the comment says `threadWidth` should drive the reserved column width.

Observed: the rendered stable state is visually identical to `activity-activityview--grouped`. DOM inspection confirms there is no `.thread-pane`, and `ActivityView` only applies the split grid/`threadWidth` style once a row has been opened. The story does not demonstrate the intended wide thread-pane state.

### `surfaces-chatview--thread-open`

Severity: 3
Likely cause: component state or story/provider wiring.

Screenshot: [activity-chat-desktop--surfaces-chatview--thread-open.png](../screenshots/activity-chat-desktop--surfaces-chatview--thread-open.png)

Expected from source: thread-open mode should collapse the timeline rail and render the composer in its collapsed-default state.

Observed: the timeline rail is correctly absent, but the composer renders expanded with toolbar, textarea, footer hints, and send button. DOM inspection in a fresh isolated render found `.composer` without `.composer-collapsed`, no `.composer-collapsed-stub`, and a textarea present.

## Passed Stories

- `activity-activityitem--message`
- `activity-activityitem--mention`
- `activity-activityitem--awaiting`
- `activity-activityitem--thread-reply`
- `activity-activityitem--reacted-no-room`
- `activity-activityview--grouped`
- `surfaces-boardview--populated`
- `surfaces-boardview--empty`
- `surfaces-chatview--group-conversation`
- `surfaces-chatview--direct-message`
- `surfaces-chatview--quiet`
- `surfaces-chatview--with-thread-summary`

## Deferred / Follow-Up

No stories in this bucket were deferred for interaction. No assigned story was skipped for glass, compact, medium, mobile, or responsive-only scope.
