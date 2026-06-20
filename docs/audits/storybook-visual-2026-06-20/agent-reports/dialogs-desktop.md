# Dialogs Desktop Storybook Visual Audit

Date: 2026-06-20
Scope: brutal-theme desktop pass only, viewport 1280x720.

## Capture Method

Used isolated headless Playwright screenshots only:

```bash
bunx playwright screenshot --wait-for-timeout=5000 --viewport-size=1280,720 \
  'http://localhost:6006/iframe.html?id=<story-id>&viewMode=story' \
  /tmp/<story-id>-wait.png
```

Initial captures without the explicit wait sometimes caught Storybook's loader, so final judgments used the settled `--wait-for-timeout=5000` captures. The Codex in-app browser was not used.

## Deferred Stories

None. All requested stories were brutal-theme desktop states and were auditable through isolated iframe captures. The play-driven stories settled without needing parent-browser or manual interactive follow-up.

## Confirmed Failures

None.

## Stories Audited

### `surfaces-archiverecovery--launcher`

Expected: resting launcher buttons with no overlay open.
Observed: launcher rendered as expected. No internal overlap, clipping, or unreadable text.

### `surfaces-archiverecovery--console`

Expected: archive console listing archived sessions and reserved group seats after the story play click.
Observed: console dialog rendered with readable header, search/filter controls, grouped archive row, and action buttons. No confirmed visual failure.

### `surfaces-archiverecovery--archive-preview`

Expected: archive dry-run preview dialog for Pulse.
Observed: preview dialog rendered with readable dry-run table, reason input, and footer actions. No confirmed visual failure.

### `surfaces-archiverecovery--resume-preview`

Expected: resume dry-run preview dialog for Pulse.
Observed: preview dialog rendered with readable dry-run table and footer actions. No confirmed visual failure.

### `agent-states-spawnagentdialog--default`

Expected: fully configured spawn dialog with two runtimes, model choices, two paths, and default name.
Observed: dialog rendered correctly. Long model metadata is intentionally ellipsized inside option cards; labels and controls remain readable.

### `agent-states-spawnagentdialog--no-launch-config`

Expected: no room-scoped paths or launch metadata, empty Path fieldset, tools default available.
Observed: empty Path section rendered as described by the story source. No visual breakage found.

### `agent-states-spawnagentdialog--runtime-unavailable`

Expected: Pi disabled as not installed, form falls back to Claude.
Observed: disabled Pi state and Claude fallback were visible and readable. No confirmed visual failure.

### `agent-states-spawnagentdialog--name-required-validation`

Expected: cleared name, submitted form, inline "Name is required" alert.
Observed: validation alert rendered clearly below the path choices with no overlap or unreadable text.

## Saved Failure Screenshots

None. No `dialogs-desktop--*.png` screenshots were saved because there were no confirmed failures.
